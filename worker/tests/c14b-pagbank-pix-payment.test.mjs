import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { handleRequest } from "../src/index.js";
import { PagBankProvider } from "../src/payments/payment-provider.js";
import {
  createPaymentAttempt,
  linkPaymentProviderResult
} from "../src/payments/payment-service.js";

const ORDER_ID = "ord_aaaaaaaaaaaaaaaaaaaa";
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const clone = value => value == null ? value : structuredClone(value);
const docId = path => String(path).split("/").pop();

function testServices({ uid, initial = {} }) {
  const identity = {
    uid,
    email: `${uid}@example.com`,
    displayName: "Cliente Sandbox"
  };
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  const read = path => store.has(path) ? { id: docId(path), ...clone(store.get(path)) } : null;
  return {
    identityUid: uid,
    store,
    runtime: "firebase-functions-v2",
    async verifyIdToken() {
      const now = Math.floor(Date.now() / 1000);
      return {
        aud: "guiasys-licensing",
        iss: "https://securetoken.google.com/guiasys-licensing",
        sub: identity.uid,
        exp: now + 3600,
        iat: now - 10,
        auth_time: now - 10,
        email: identity.email,
        email_verified: true,
        name: identity.displayName,
        firebase: { sign_in_provider: "password" }
      };
    },
    async getAccountState() {
      return {
        localId: identity.uid,
        email: identity.email,
        displayName: identity.displayName,
        emailVerified: true,
        disabled: false,
        validSince: "0"
      };
    },
    async getDoc(path) { return read(path); },
    async listCollection(path) {
      const prefix = `${path}/`;
      return [...store.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
        .map(([key, value]) => ({ id: docId(key), ...clone(value) }));
    },
    atomicClient() {
      return {
        async runTransaction(operation) {
          const writes = [];
          const tx = {
            async get(path) { return read(path); },
            async queryByField() { return []; },
            set(path, value) { writes.push({ path, value: clone(value) }); },
            create(path, value) {
              if (store.has(path) || writes.some(item => item.path === path)) {
                throw Object.assign(new Error("exists"), { status: 409, reason: "concurrency_conflict" });
              }
              writes.push({ path, value: clone(value) });
            },
            delete(path) { writes.push({ path, remove: true }); }
          };
          const result = await operation(tx);
          for (const write of writes) {
            if (write.remove) store.delete(write.path);
            else store.set(write.path, write.value);
          }
          return result;
        }
      };
    },
    log() {}
  };
}

function fixture({ uid, status = "pending_payment", ownerUid = uid, taxId = "12345678909" } = {}) {
  const accountId = `acct_${sha(ownerUid).slice(0, 20)}`;
  const email = `${ownerUid}@example.com`;
  const order = {
    orderId: ORDER_ID,
    accountId,
    firebaseUid: ownerUid,
    status,
    currency: "BRL",
    subtotalCents: 2990,
    totalCents: 2990,
    items: [{
      type: "new_license",
      projectId: "prj_aaaaaaaaaaaaaaaaaaaa",
      planId: "plan_aaaaaaaaaaaaaaaaaaaa",
      projectNameSnapshot: "GuiaPlay",
      planNameSnapshot: "Anual",
      unitPriceCents: 2990,
      quantity: 1,
      lineTotalCents: 2990
    }],
    provider: "pagbank",
    providerOrderId: "",
    paymentStatus: "pending",
    processingStatus: "pending",
    fulfillmentStatus: "pending",
    resultingLicenses: [],
    createdAt: "2026-10-06T12:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z"
  };
  return {
    accountId,
    initial: {
      [`customerAccounts/${accountId}`]: {
        accountId,
        firebaseUid: ownerUid,
        email,
        emailVerified: true,
        displayName: "Cliente Sandbox",
        phone: "11999999999",
        taxId,
        status: "active",
        createdAt: "2026-10-06T12:00:00.000Z",
        updatedAt: "2026-10-06T12:00:00.000Z"
      },
      [`customerAccounts/${accountId}/orders/${ORDER_ID}`]: {
        orderId: ORDER_ID,
        createdAt: order.createdAt
      },
      [`orders/${ORDER_ID}`]: order
    }
  };
}

function environment(api, suffix, {
  checkoutEnabled = "true",
  testerUids = api.identityUid,
  adminUid = "master"
} = {}) {
  return {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: adminUid,
    PAYMENT_PROVIDER: "pagbank",
    PAGBANK_ENABLED: "true",
    PAGBANK_TOKEN: `production-secret-${suffix}`,
    PAGBANK_SANDBOX_TOKEN: `sandbox-secret-${suffix}`,
    PAGBANK_SANDBOX_CHECKOUT_ENABLED: checkoutEnabled,
    PAGBANK_SANDBOX_TESTER_UIDS: testerUids,
    __services: api
  };
}

function paymentRequest(body, orderId = ORDER_ID) {
  return new Request(`https://licencas.guiasys.online/api/v1/customer/orders/${orderId}/payment`, {
    method: "POST",
    headers: {
      Authorization: "Bearer customer",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function cancelOrderRequest(orderId = ORDER_ID) {
  return new Request(`https://licencas.guiasys.online/api/v1/customer/orders/${orderId}/cancel`, {
    method: "POST",
    headers: { Authorization: "Bearer customer" }
  });
}

function adminReconcileRequest(paymentId, body = {}) {
  return new Request(`https://licencas.guiasys.online/api/v1/admin/payments/${paymentId}/reconcile`, {
    method: "POST",
    headers: {
      Authorization: "Bearer admin",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function pagBankResponse(paymentId, overrides = {}) {
  return {
    id: overrides.providerOrderId || "ORDE_12345678-1234-1234-1234-123456789012",
    reference_id: overrides.orderId || ORDER_ID,
    charges: [{
      id: overrides.providerChargeId || "CHAR_12345678-1234-1234-1234-123456789012",
      reference_id: overrides.paymentId || paymentId,
      status: overrides.status || "WAITING",
      ...(overrides.paidAt ? { paid_at: overrides.paidAt } : {}),
      amount: { value: overrides.amountCents ?? 2990, currency: overrides.currency || "BRL" },
      payment_method: {
        type: overrides.method || "PIX",
        pix: { expiration_date: "2026-10-06T15:00:00Z" }
      },
      qr_code: { id: "QRCO_123", text: "000201-pix-copia-e-cola" },
      links: [{
        rel: "QRCODE.PNG",
        href: "https://sandbox.api.pagseguro.com/qrcode/QRCO_123/png",
        media: "image/png",
        type: "GET"
      }]
    }]
  };
}

test("checkout Sandbox fica fechado por padrão e exige UID permitido no backend", async () => {
  const uid = "pix-gate";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch não deveria ser chamado");
  };

  try {
    const body = { method: "pix", idempotencyKey: "payment-gate-001" };
    const absentEnv = environment(api, "gate-absent", { testerUids: uid });
    delete absentEnv.PAGBANK_SANDBOX_CHECKOUT_ENABLED;
    const absent = await handleRequest(paymentRequest(body), absentEnv);
    assert.equal(absent.status, 403);
    assert.equal((await absent.json()).error, "sandbox_checkout_disabled");

    const disabled = await handleRequest(paymentRequest(body), environment(api, "gate-off", {
      checkoutEnabled: "false",
      testerUids: uid
    }));
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).error, "sandbox_checkout_disabled");

    const forbidden = await handleRequest(paymentRequest(body), environment(api, "gate-forbidden", {
      checkoutEnabled: "true",
      testerUids: "another-user"
    }));
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error, "sandbox_checkout_forbidden");
    assert.equal(calls, 0);
    assert.equal([...api.store.keys()].some(path => path.startsWith("payments/")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rota aceita somente PIX e não permite environment escolhido pelo cliente", async () => {
  const uid = "pix-validation";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "validation");

  const card = await handleRequest(paymentRequest({ method: "credit_card", idempotencyKey: "payment-validation-1" }), env);
  const environmentChoice = await handleRequest(paymentRequest({ method: "pix", idempotencyKey: "payment-validation-2", environment: "production" }), env);

  assert.equal(card.status, 400);
  assert.equal(environmentChoice.status, 400);
  assert.deepEqual((await environmentChoice.json()).details.fields, ["environment"]);
  assert.equal([...api.store.keys()].some(path => path.startsWith("payments/")), false);
});

test("rota rejeita pedido de outra conta e pedido em estado incompatível", async () => {
  const uid = "pix-requester";
  const foreign = fixture({ uid, ownerUid: "pix-owner" });
  const foreignApi = testServices({ uid, initial: foreign.initial });
  const foreignResponse = await handleRequest(
    paymentRequest({ method: "pix", idempotencyKey: "payment-foreign-order" }),
    environment(foreignApi, "foreign")
  );
  assert.equal(foreignResponse.status, 404);

  const invalid = fixture({ uid: "pix-invalid-state", status: "fulfilled" });
  const invalidApi = testServices({ uid: "pix-invalid-state", initial: invalid.initial });
  const invalidResponse = await handleRequest(
    paymentRequest({ method: "pix", idempotencyKey: "payment-invalid-state" }),
    environment(invalidApi, "invalid-state")
  );
  assert.equal(invalidResponse.status, 409);
  assert.equal((await invalidResponse.json()).error, "payment_not_allowed");
});

test("PIX Sandbox nasce localmente antes do POST e usa somente snapshots e cadastro", async () => {
  const uid = "pix-success";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "success");
  const originalFetch = globalThis.fetch;
  let postedPaymentId = "";
  let postCount = 0;

  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://sandbox.api.pagseguro.com/orders");
    assert.equal(init.method, "POST");
    assert.equal(Object.hasOwn(init.headers, "x-idempotency-key"), false);
    postCount += 1;
    const body = JSON.parse(init.body);
    postedPaymentId = body.charges[0].reference_id;
    const local = api.store.get(`payments/${postedPaymentId}`);
    assert.equal(local.submissionState, "submitting");
    assert.equal(local.providerEnvironment, "sandbox");
    assert.equal(body.reference_id, ORDER_ID);
    assert.equal(body.charges[0].reference_id, postedPaymentId);
    assert.deepEqual(body.charges[0].amount, { value: 2990, currency: "BRL" });
    assert.equal(body.charges[0].payment_method.type, "PIX");
    assert.deepEqual(body.customer, {
      name: "Cliente Sandbox",
      email: "pix-success@example.com",
      tax_id: "12345678909",
      phones: [{ country: "55", area: "11", number: "999999999", type: "MOBILE" }]
    });
    assert.deepEqual(body.items, [{
      reference_id: `${ORDER_ID}-1`,
      name: "GuiaPlay - Anual",
      quantity: 1,
      unit_amount: 2990
    }]);
    assert.equal("notification_urls" in body, false);
    return new Response(JSON.stringify(pagBankResponse(postedPaymentId)), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const response = await handleRequest(
      paymentRequest({ method: "pix", idempotencyKey: "payment-success-001" }),
      env
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.payment.paymentId, postedPaymentId);
    assert.equal(body.payment.status, "processing");
    assert.equal(body.payment.method, "pix");
    assert.equal(body.payment.providerOrderId, "ORDE_12345678-1234-1234-1234-123456789012");
    assert.equal(body.payment.providerChargeId, "CHAR_12345678-1234-1234-1234-123456789012");
    assert.equal(body.payment.pixCode, "000201-pix-copia-e-cola");
    assert.equal(body.payment.idempotentReplay, false);
    assert.equal(JSON.stringify(body).includes("sandbox-secret-success"), false);
    assert.equal(JSON.stringify(body).includes("firebaseUid"), false);
    assert.equal(postCount, 1);

    const stored = api.store.get(`payments/${postedPaymentId}`);
    assert.equal(stored.providerEnvironment, "sandbox");
    assert.equal(stored.providerPaymentId, stored.providerChargeId);
    assert.equal(stored.pixQrCodeId, "QRCO_123");
    assert.equal(stored.submissionState, "linked");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).status, "payment_processing");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).fulfillmentStatus, "pending");
    assert.equal([...api.store.keys()].some(path => path.includes("/licenses/")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("replay da mesma chave reutiliza payment, consulta o pedido e não repete POST", async () => {
  const uid = "pix-replay";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "replay");
  const originalFetch = globalThis.fetch;
  let paymentId = "";
  let posts = 0;
  let gets = 0;

  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      posts += 1;
      paymentId = JSON.parse(init.body).charges[0].reference_id;
    } else {
      gets += 1;
      assert.equal(String(url), "https://sandbox.api.pagseguro.com/orders/ORDE_12345678-1234-1234-1234-123456789012");
    }
    return new Response(JSON.stringify(pagBankResponse(paymentId)), {
      status: init.method === "POST" ? 201 : 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const body = { method: "pix", idempotencyKey: "payment-replay-001" };
    const first = await handleRequest(paymentRequest(body), env);
    const replay = await handleRequest(paymentRequest(body), env);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).payment.idempotentReplay, true);
    assert.equal(posts, 1);
    assert.equal(gets, 1);
    assert.equal([...api.store.keys()].filter(path => path.startsWith("payments/")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reserva atômica impede duas tentativas ativas com chaves diferentes", async () => {
  const uid = "pix-active-attempt";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  let sequence = 0;
  const base = {
    atomicClient: api.atomicClient(),
    orderId: ORDER_ID,
    accountId: data.accountId,
    provider: "pagbank",
    providerEnvironment: "sandbox",
    method: "pix",
    hash: async value => sha(value),
    randomId: () => `pay_${String(++sequence).padStart(20, "a")}`,
    now: () => "2026-10-06T12:30:00.000Z"
  };

  const first = await createPaymentAttempt({ ...base, idempotencyKey: "active-attempt-1" });
  const replay = await createPaymentAttempt({ ...base, idempotencyKey: "active-attempt-1" });
  await assert.rejects(
    () => createPaymentAttempt({ ...base, idempotencyKey: "active-attempt-2" }),
    error => error.reason === "active_payment_exists"
  );

  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.payment.paymentId, first.payment.paymentId);
  assert.equal(api.store.get(`orders/${ORDER_ID}`).activePaymentId, first.payment.paymentId);
  assert.equal([...api.store.keys()].filter(path => path.startsWith("payments/")).length, 1);
});

test("timeout após envio deixa estado incerto e replay não cria outra cobrança", async () => {
  const uid = "pix-timeout";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "timeout");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("connection lost after send");
  };

  try {
    const body = { method: "pix", idempotencyKey: "payment-timeout-001" };
    const first = await handleRequest(paymentRequest(body), env);
    assert.equal(first.status, 502);
    const [payment] = [...api.store.entries()].filter(([path]) => path.startsWith("payments/"));
    assert.equal(payment[1].submissionState, "unknown");
    assert.equal(payment[1].providerStatus, "UNKNOWN");

    const cancellation = await handleRequest(cancelOrderRequest(), env);
    assert.equal(cancellation.status, 409);
    assert.equal((await cancellation.json()).error, "order_not_cancellable");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).status, "payment_processing");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).activePaymentId, payment[1].paymentId);

    const replay = await handleRequest(paymentRequest(body), env);
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error, "payment_state_unknown");
    assert.equal(calls, 1);
    assert.equal([...api.store.keys()].filter(path => path.startsWith("payments/")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP 429 e 5xx mantêm tentativa incerta e bloqueiam nova cobrança", async t => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [429, 500, 502]) {
      await t.test(String(status), async () => {
        const uid = `pix-http-${status}`;
        const data = fixture({ uid });
        const api = testServices({ uid, initial: data.initial });
        let calls = 0;
        globalThis.fetch = async () => {
          calls += 1;
          return new Response(JSON.stringify({ error_code: `upstream-${status}`, detail: "ignored" }), {
            status,
            headers: { "Content-Type": "application/json" }
          });
        };

        const body = { method: "pix", idempotencyKey: `payment-http-${status}` };
        const first = await handleRequest(paymentRequest(body), environment(api, `http-${status}`));
        assert.equal(first.status, 502);
        const payment = [...api.store.entries()].find(([path]) => path.startsWith("payments/"))[1];
        assert.equal(payment.submissionState, "unknown");
        assert.equal(payment.lastProviderError.category, "uncertain");
        assert.equal(payment.lastProviderError.httpStatus, status);
        assert.equal(api.store.get(`orders/${ORDER_ID}`).activePaymentId, payment.paymentId);

        const differentKey = await handleRequest(paymentRequest({
          method: "pix",
          idempotencyKey: `payment-http-${status}-other`
        }), environment(api, `http-${status}`));
        assert.equal(differentKey.status, 409);
        assert.equal((await differentKey.json()).error, "payment_not_allowed");
        assert.equal(calls, 1);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejeição HTTP determinística libera nova tentativa", async () => {
  const uid = "pix-http-rejected";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error_code: "invalid_request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const paymentId = JSON.parse(init.body).charges[0].reference_id;
    return new Response(JSON.stringify(pagBankResponse(paymentId)), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const rejected = await handleRequest(paymentRequest({
      method: "pix",
      idempotencyKey: "payment-http-rejected-1"
    }), environment(api, "http-rejected"));
    assert.equal(rejected.status, 502);
    const failed = [...api.store.values()].find(value => value?.submissionState === "failed");
    assert.equal(failed.status, "failed");
    assert.equal(failed.lastProviderError.category, "definitive");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).status, "payment_failed");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).activePaymentId, "");

    const retry = await handleRequest(paymentRequest({
      method: "pix",
      idempotencyKey: "payment-http-rejected-2"
    }), environment(api, "http-rejected"));
    assert.equal(retry.status, 201);
    assert.equal(calls, 2);
    assert.equal([...api.store.keys()].filter(path => path.startsWith("payments/")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin reconcilia tentativa incerta por ORDE sem criar licença", async () => {
  const uid = "pix-reconcile-admin";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "reconcile", { adminUid: uid });
  const originalFetch = globalThis.fetch;
  let paymentId = "";
  let gets = 0;
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") throw new TypeError("connection lost after send");
    gets += 1;
    assert.equal(String(url), "https://sandbox.api.pagseguro.com/orders/ORDE_recovered-123");
    return new Response(JSON.stringify(pagBankResponse(paymentId, {
      providerOrderId: "ORDE_recovered-123",
      status: "PAID",
      paidAt: "2026-10-06T14:22:31-03:00"
    })), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const uncertain = await handleRequest(paymentRequest({
      method: "pix",
      idempotencyKey: "payment-reconcile-001"
    }), env);
    assert.equal(uncertain.status, 502);
    paymentId = [...api.store.values()].find(value => value?.submissionState === "unknown").paymentId;

    const injected = await handleRequest(adminReconcileRequest(paymentId, {
      providerOrderId: "ORDE_recovered-123",
      status: "PAID"
    }), env);
    assert.equal(injected.status, 400);
    assert.equal(gets, 0);

    const reconciled = await handleRequest(adminReconcileRequest(paymentId, {
      providerOrderId: "ORDE_recovered-123"
    }), env);
    assert.equal(reconciled.status, 200);
    const body = await reconciled.json();
    assert.equal(body.payment.status, "paid");
    assert.equal(body.payment.providerOrderId, "ORDE_recovered-123");
    assert.equal(body.payment.providerPaidAt, "2026-10-06T14:22:31-03:00");
    assert.equal(api.store.get(`payments/${paymentId}`).paidAt, "2026-10-06T14:22:31-03:00");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).status, "payment_processing");
    assert.equal([...api.store.keys()].some(path => path.includes("/licenses/")), false);
    assert.equal(gets, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tentativa incerta sem ORDE permanece bloqueada para recuperação manual", async () => {
  const uid = "pix-reconcile-missing";
  const data = fixture({ uid });
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "reconcile-missing", { adminUid: uid });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("connection lost after send"); };

  try {
    await handleRequest(paymentRequest({
      method: "pix",
      idempotencyKey: "payment-reconcile-missing"
    }), env);
    const payment = [...api.store.values()].find(value => value?.submissionState === "unknown");
    const response = await handleRequest(adminReconcileRequest(payment.paymentId), env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "provider_order_id_required");
    assert.equal(api.store.get(`payments/${payment.paymentId}`).submissionState, "unknown");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).activePaymentId, payment.paymentId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reconciliação admin rejeita ORDE cuja referência remota diverge", async () => {
  const uid = "pix-reconcile-mismatch";
  const data = fixture({ uid });
  const paymentId = `pay_${sha("mismatch").slice(0, 20)}`;
  data.initial[`orders/${ORDER_ID}`] = {
    ...data.initial[`orders/${ORDER_ID}`],
    status: "payment_processing",
    paymentId,
    activePaymentId: paymentId,
    paymentStatus: "processing",
    processingStatus: "processing"
  };
  data.initial[`payments/${paymentId}`] = {
    paymentId,
    orderId: ORDER_ID,
    accountId: data.accountId,
    provider: "pagbank",
    providerEnvironment: "sandbox",
    providerOrderId: "",
    providerChargeId: "",
    providerPaymentId: "",
    providerStatus: "UNKNOWN",
    submissionState: "unknown",
    status: "processing",
    amountCents: 2990,
    currency: "BRL",
    method: "pix"
  };
  const api = testServices({ uid, initial: data.initial });
  const env = environment(api, "reconcile-mismatch", { adminUid: uid });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(pagBankResponse(paymentId, {
    providerOrderId: "ORDE_wrong-reference",
    orderId: "ord_bbbbbbbbbbbbbbbbbbbb"
  })), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const response = await handleRequest(adminReconcileRequest(paymentId, {
      providerOrderId: "ORDE_wrong-reference"
    }), env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "payment_provider_order_mismatch");
    assert.equal(api.store.get(`payments/${paymentId}`).submissionState, "unknown");
    assert.equal(api.store.get(`payments/${paymentId}`).providerOrderId, "");
    assert.equal(api.store.get(`orders/${ORDER_ID}`).activePaymentId, paymentId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cadastro incompleto falha de forma controlada sem chamar PagBank", async () => {
  const uid = "pix-no-tax-id";
  const data = fixture({ uid, taxId: "" });
  const api = testServices({ uid, initial: data.initial });
  const response = await handleRequest(
    paymentRequest({ method: "pix", idempotencyKey: "payment-no-tax-id" }),
    environment(api, "no-tax-id")
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "payment_customer_incomplete");
  const payment = [...api.store.values()].find(value => value?.paymentId?.startsWith("pay_"));
  assert.equal(payment.submissionState, "ready");
});

test("CPF ou CNPJ com dígitos verificadores inválidos não chega ao PagBank", async () => {
  const uid = "pix-invalid-tax-id";
  const data = fixture({ uid, taxId: "11111111111" });
  const api = testServices({ uid, initial: data.initial });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected"); };
  try {
    const response = await handleRequest(
      paymentRequest({ method: "pix", idempotencyKey: "payment-invalid-tax-id" }),
      environment(api, "invalid-tax-id")
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "payment_customer_incomplete");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("vínculo transacional rejeita IDs PagBank conflitantes", async () => {
  const paymentId = "pay_aaaaaaaaaaaaaaaaaaaa";
  const accountId = "acct_aaaaaaaaaaaaaaaaaaaa";
  const api = testServices({
    uid: "pix-conflict",
    initial: {
      [`orders/${ORDER_ID}`]: {
        orderId: ORDER_ID,
        accountId,
        paymentId,
        status: "payment_processing",
        totalCents: 2990,
        currency: "BRL"
      },
      [`payments/${paymentId}`]: {
        paymentId,
        orderId: ORDER_ID,
        accountId,
        provider: "pagbank",
        providerEnvironment: "sandbox",
        providerOrderId: "ORDE_original",
        providerChargeId: "CHAR_original",
        providerPaymentId: "CHAR_original",
        status: "processing",
        amountCents: 2990,
        currency: "BRL"
      }
    }
  });

  await assert.rejects(
    () => linkPaymentProviderResult({
      atomicClient: api.atomicClient(),
      paymentId,
      orderId: ORDER_ID,
      accountId,
      provider: "pagbank",
      providerEnvironment: "sandbox",
      result: {
        orderId: ORDER_ID,
        paymentId,
        providerOrderId: "ORDE_different",
        providerChargeId: "CHAR_original",
        providerPaymentId: "CHAR_original",
        providerStatus: "WAITING",
        status: "processing",
        amountCents: 2990,
        currency: "BRL"
      },
      now: () => "2026-10-06T13:00:00.000Z"
    }),
    error => error.reason === "payment_provider_order_mismatch"
  );
});

test("reconciliação mapeia estados PagBank sem regressão nem fulfillment", async t => {
  const provider = new PagBankProvider({ environment: "sandbox", token: "test-token" });
  const cases = [
    { remote: "WAITING", payment: "processing", order: "payment_processing", expectedPayment: "processing", expectedOrder: "payment_processing", active: true },
    { remote: "PAID", payment: "processing", order: "payment_processing", expectedPayment: "paid", expectedOrder: "payment_processing", active: true, paidAt: "2026-10-06T14:22:31-03:00" },
    { remote: "DECLINED", payment: "processing", order: "payment_processing", expectedPayment: "failed", expectedOrder: "payment_failed", active: false },
    { remote: "CANCELED", payment: "processing", order: "payment_processing", expectedPayment: "cancelled", expectedOrder: "cancelled", active: false },
    { remote: "CANCELLED", payment: "processing", order: "payment_processing", expectedPayment: "cancelled", expectedOrder: "cancelled", active: false },
    { remote: "REFUNDED", payment: "paid", order: "paid", expectedPayment: "refunded", expectedOrder: "refunded", active: false },
    { remote: "FUTURE_PROVIDER_STATE", payment: "failed", order: "payment_failed", expectedPayment: "failed", expectedOrder: "payment_failed", active: false }
  ];

  for (const scenario of cases) {
    await t.test(scenario.remote, async () => {
      const paymentId = `pay_${sha(scenario.remote).slice(0, 20)}`;
      const accountId = `acct_${sha(`account-${scenario.remote}`).slice(0, 20)}`;
      const providerOrderId = "ORDE_status-test";
      const providerChargeId = "CHAR_status-test";
      const alreadyLinked = scenario.remote === "FUTURE_PROVIDER_STATE";
      const api = testServices({
        uid: `status-${scenario.remote}`,
        initial: {
          [`orders/${ORDER_ID}`]: {
            orderId: ORDER_ID,
            accountId,
            paymentId,
            activePaymentId: scenario.remote === "FUTURE_PROVIDER_STATE" ? "" : paymentId,
            status: scenario.order,
            paymentStatus: scenario.payment,
            processingStatus: scenario.order === "payment_processing" ? "processing" : "pending",
            fulfillmentStatus: "pending",
            providerOrderId: alreadyLinked ? providerOrderId : "",
            providerChargeId: alreadyLinked ? providerChargeId : "",
            totalCents: 2990,
            currency: "BRL"
          },
          [`payments/${paymentId}`]: {
            paymentId,
            orderId: ORDER_ID,
            accountId,
            provider: "pagbank",
            providerEnvironment: "sandbox",
            providerOrderId: alreadyLinked ? providerOrderId : "",
            providerChargeId: alreadyLinked ? providerChargeId : "",
            providerPaymentId: alreadyLinked ? providerChargeId : "",
            providerStatus: "",
            submissionState: alreadyLinked ? "linked" : "submitting",
            status: scenario.payment,
            amountCents: 2990,
            currency: "BRL",
            method: "pix"
          }
        }
      });
      const normalized = provider.normalizePayment(pagBankResponse(paymentId, {
        providerOrderId,
        providerChargeId,
        status: scenario.remote,
        paidAt: scenario.paidAt
      }), { orderId: ORDER_ID, paymentId });

      const linked = await linkPaymentProviderResult({
        atomicClient: api.atomicClient(),
        paymentId,
        orderId: ORDER_ID,
        accountId,
        provider: "pagbank",
        providerEnvironment: "sandbox",
        result: normalized,
        now: () => "2026-10-06T18:00:00.000Z"
      });

      assert.equal(linked.payment.status, scenario.expectedPayment);
      assert.equal(linked.order.status, scenario.expectedOrder);
      assert.equal(linked.order.activePaymentId, scenario.active ? paymentId : "");
      assert.equal(linked.payment.providerStatus, scenario.remote);
      if (scenario.paidAt) {
        assert.equal(linked.payment.providerPaidAt, scenario.paidAt);
        assert.equal(linked.payment.paidAt, scenario.paidAt);
      }
      assert.equal([...api.store.keys()].some(path => path.includes("/licenses/")), false);
    });
  }
});
