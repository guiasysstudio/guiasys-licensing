import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { finalizePaidOrder, handleRequest } from "../src/index.js";
import { assertCents, moneyToCents, transitionOrderStatus, transitionPaymentStatus } from "../src/commerce-policy.js";
import { PagBankProvider } from "../src/payments/payment-provider.js";
import { createPaymentAttempt, recordPaymentEvent } from "../src/payments/payment-service.js";
import { validateOrderCreatePayload } from "../src/validation.js";

const PROJECT = "prj_aaaaaaaaaaaaaaaaaaaa";
const PLAN = "plan_aaaaaaaaaaaaaaaaaaaa";
const OTHER_PROJECT = "prj_bbbbbbbbbbbbbbbbbbbb";
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const clone = value => value == null ? value : structuredClone(value);
const docId = path => String(path).split("/").pop();

function services(initial = {}) {
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  let identity = { uid: "customer-a", email: "a@example.com" };
  const read = path => store.has(path) ? { id: docId(path), ...clone(store.get(path)) } : null;
  const api = {
    store,
    setIdentity(uid, email) { identity = { uid, email }; },
    runtime: "firebase-functions-v2",
    async verifyIdToken() {
      const now = Math.floor(Date.now() / 1000);
      return { aud: "guiasys-licensing", iss: "https://securetoken.google.com/guiasys-licensing", sub: identity.uid, exp: now + 3600, iat: now - 10, auth_time: now - 10, email: identity.email, email_verified: true, firebase: { sign_in_provider: "password" } };
    },
    async getAccountState() { return { localId: identity.uid, email: identity.email, displayName: identity.email, emailVerified: true, disabled: false, validSince: "0" }; },
    async getDoc(path) { return read(path); },
    async listCollection(path) { const prefix = `${path}/`; return [...store.entries()].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/")).map(([key, value]) => ({ id: docId(key), ...clone(value) })); },
    atomicClient() {
      return { async runTransaction(operation) {
        const writes = [];
        const tx = {
          async get(path) { return read(path); },
          async queryByField() { return []; },
          set(path, value) { writes.push({ path, value: clone(value), create: false }); },
          create(path, value) { if (store.has(path) || writes.some(item => item.path === path)) throw Object.assign(new Error("exists"), { status: 409, reason: "concurrency_conflict" }); writes.push({ path, value: clone(value), create: true }); },
          delete(path) { writes.push({ path, remove: true }); }
        };
        const result = await operation(tx);
        for (const write of writes) write.remove ? store.delete(write.path) : store.set(write.path, write.value);
        return result;
      } };
    },
    log() {}
  };
  return api;
}

function env(api) { return { FIREBASE_PROJECT_ID: "guiasys-licensing", ADMIN_FIREBASE_UID: "master", __services: api }; }
function request(path, method = "GET", body) {
  return new Request(`https://licencas.guiasys.online${path}`, { method, headers: { Authorization: "Bearer customer", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
function baseData() {
  return {
    [`projects/${PROJECT}`]: { name: "GuiaPlay", prefix: "GPL", status: "active", publicCatalog: true },
    [`projects/${PROJECT}/plans/${PLAN}`]: { name: "Anual", price: 29.9, priceCents: 2990, durationDays: 365, lifetime: false, deviceLimit: 2, startMode: "first_activation", active: true, publicCatalog: true }
  };
}

test("dinheiro e máquinas de estado comerciais são estritos", () => {
  assert.equal(moneyToCents(29.9), 2990);
  assert.equal(assertCents(2990), 2990);
  assert.equal(transitionOrderStatus("pending_payment", "payment_processing"), "payment_processing");
  assert.equal(transitionPaymentStatus("processing", "paid"), "paid");
  assert.throws(() => assertCents(29.9), /inteiro/);
  assert.throws(() => transitionOrderStatus("pending_payment", "fulfilled"), error => error.reason === "invalid_order_transition");
  assert.throws(() => transitionPaymentStatus("paid", "pending"), error => error.reason === "invalid_payment_transition");
});

test("payload de pedido aceita apenas IDs e quantidade com limites", () => {
  assert.equal(validateOrderCreatePayload({ idempotencyKey: "request-123", items: [{ projectId: PROJECT, planId: PLAN, quantity: 5 }] }).items[0].quantity, 5);
  for (const quantity of [-1, 0, 51]) assert.throws(() => validateOrderCreatePayload({ idempotencyKey: "request-123", items: [{ projectId: PROJECT, planId: PLAN, quantity }] }));
  assert.throws(() => validateOrderCreatePayload({ idempotencyKey: "request-123", items: [{ projectId: PROJECT, planId: PLAN }] }));
  assert.throws(() => validateOrderCreatePayload({ idempotencyKey: "request-123", totalCents: 1, items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }] }), error => error.details.fields.includes("totalCents"));
  assert.throws(() => validateOrderCreatePayload({ idempotencyKey: "request-123", items: Array.from({ length: 11 }, () => ({ projectId: PROJECT, planId: PLAN, quantity: 1 })) }));
});

test("pedido usa preço do Firestore, não emite key e repete idempotentemente", async () => {
  const data = baseData();
  delete data[`projects/${PROJECT}/plans/${PLAN}`].priceCents;
  const api = services(data);
  const body = { idempotencyKey: "order-request-001", items: [{ projectId: PROJECT, planId: PLAN, quantity: 5 }] };
  const first = await handleRequest(request("/api/v1/customer/orders", "POST", body), env(api));
  assert.equal(first.status, 201);
  const order = (await first.json()).order;
  assert.equal(order.totalCents, 14950);
  assert.equal(Number.isInteger(order.totalCents), true);
  assert.equal(api.store.get(`projects/${PROJECT}/plans/${PLAN}`).priceCents, 2990);
  assert.equal([...api.store.keys()].some(path => path.includes("/licenses/")), false);
  const replay = await handleRequest(request("/api/v1/customer/orders", "POST", body), env(api));
  assert.equal((await replay.json()).order.orderId, order.orderId);
  assert.equal([...api.store.keys()].filter(path => /^orders\//.test(path)).length, 1);
});

test("projeto ou plano oculto e planId inexistente não podem ser comprados", async () => {
  for (const variant of ["project", "plan", "missing"]) {
    const data = baseData();
    if (variant === "project") data[`projects/${PROJECT}`].publicCatalog = false;
    if (variant === "plan") data[`projects/${PROJECT}/plans/${PLAN}`].active = false;
    if (variant === "missing") delete data[`projects/${PROJECT}/plans/${PLAN}`];
    const response = await handleRequest(request("/api/v1/customer/orders", "POST", { idempotencyKey: `request-${variant}`, items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }] }), env(services(data)));
    assert.ok([404, 409].includes(response.status));
  }
});

test("conta A não consulta pedido da conta B", async () => {
  const api = services(baseData());
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", { idempotencyKey: "ownership-request", items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }] }), env(api));
  const orderId = (await created.json()).order.orderId;
  api.setIdentity("customer-b", "b@example.com");
  const response = await handleRequest(request(`/api/v1/customer/orders/${orderId}`), env(api));
  assert.equal(response.status, 404);
});

test("namespace do cliente limita CORS aos domínios autorizados", async () => {
  const api = services(baseData());
  const denied = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/customer/me", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env(api));
  const allowed = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/customer/me", { method: "OPTIONS", headers: { Origin: "https://licencas.guiasys.online" } }), env(api));
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://licencas.guiasys.online");
});

test("fulfillment pago gera exatamente cinco keys e replay não duplica", async () => {
  const api = services(baseData());
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", { idempotencyKey: "fulfillment-request", items: [{ projectId: PROJECT, planId: PLAN, quantity: 5 }] }), env(api));
  const order = (await created.json()).order;
  const context = { paymentId: "pay_aaaaaaaaaaaaaaaaaaaa", orderId: order.orderId, accountId: order.accountId, status: "paid", amountCents: 14950, currency: "BRL", provider: "pagbank", providerPaymentId: "future-reference", method: "pix" };
  const first = await finalizePaidOrder(env(api), order.orderId, context);
  assert.equal(first.order.resultingLicenses.length, 5);
  const licensePaths = [...api.store.keys()].filter(path => new RegExp(`^projects/${PROJECT}/licenses/`).test(path));
  assert.equal(licensePaths.length, 5);
  const replay = await finalizePaidOrder(env(api), order.orderId, context);
  assert.equal(replay.idempotentReplay, true);
  assert.equal([...api.store.keys()].filter(path => new RegExp(`^projects/${PROJECT}/licenses/`).test(path)).length, 5);
});

test("fulfillment com múltiplas linhas do mesmo projeto cria um único vínculo de customer", async () => {
  const api = services(baseData());
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", {
    idempotencyKey: "multi-line-same-project",
    items: [
      { projectId: PROJECT, planId: PLAN, quantity: 1 },
      { projectId: PROJECT, planId: PLAN, quantity: 1 }
    ]
  }), env(api));
  assert.equal(created.status, 201);
  const order = (await created.json()).order;
  const context = {
    paymentId: "pay_dddddddddddddddddddd",
    orderId: order.orderId,
    accountId: order.accountId,
    status: "paid",
    amountCents: 5980,
    currency: "BRL",
    provider: "pagbank",
    providerPaymentId: "future-multi-line",
    method: "pix"
  };
  const fulfilled = await finalizePaidOrder(env(api), order.orderId, context);
  assert.equal(fulfilled.order.resultingLicenses.length, 2);
  assert.equal([...api.store.keys()].filter(path => new RegExp(`^projects/${PROJECT}/customers/`).test(path)).length, 1);
  assert.equal([...api.store.keys()].filter(path => new RegExp(`^customerAccounts/${order.accountId}/projectCustomers/`).test(path)).length, 1);
});

test("replay de fulfillment rejeita pagamento conflitante depois de concluído", async () => {
  const api = services(baseData());
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", {
    idempotencyKey: "fulfilled-payment-conflict",
    items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }]
  }), env(api));
  const order = (await created.json()).order;
  const context = {
    paymentId: "pay_eeeeeeeeeeeeeeeeeeee",
    orderId: order.orderId,
    accountId: order.accountId,
    status: "paid",
    amountCents: 2990,
    currency: "BRL",
    provider: "pagbank",
    method: "pix"
  };
  await finalizePaidOrder(env(api), order.orderId, context);
  await assert.rejects(
    () => finalizePaidOrder(env(api), order.orderId, { ...context, paymentId: "pay_ffffffffffffffffffff" }),
    error => error.reason === "payment_conflict"
  );
});

test("fulfillment rejeita pagamento ausente ou com valor divergente", async () => {
  const api = services(baseData());
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", { idempotencyKey: "bad-payment-request", items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }] }), env(api));
  const order = (await created.json()).order;
  await assert.rejects(() => finalizePaidOrder(env(api), order.orderId, { paymentId: "pay_bbbbbbbbbbbbbbbbbbbb", status: "pending", amountCents: 2990, currency: "BRL" }), error => error.reason === "payment_not_paid");
  await assert.rejects(() => finalizePaidOrder(env(api), order.orderId, { paymentId: "pay_bbbbbbbbbbbbbbbbbbbb", status: "paid", amountCents: 1, currency: "BRL" }), error => error.reason === "payment_amount_mismatch");
});

test("cliente cancela somente o próprio pedido antes do pagamento", async () => {
  const api = services(baseData());
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", { idempotencyKey: "cancel-request", items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }] }), env(api));
  const order = (await created.json()).order;
  const cancelled = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/cancel`, "POST"), env(api));
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).order.status, "cancelled");
  const repeat = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/cancel`, "POST"), env(api));
  assert.equal(repeat.status, 409);
});

test("renovação preserva a key, ownership e não soma dias no replay", async () => {
  const api = services(baseData());
  const me = await handleRequest(request("/api/v1/customer/me"), env(api));
  const accountId = (await me.json()).account.accountId;
  const licenseId = "lic_aaaaaaaaaaaaaaaaaaaa";
  const originalExpiry = "2026-11-30T00:00:00.000Z";
  api.store.set(`projects/${PROJECT}/licenses/${licenseId}`, { key: "GPL-ABCDE-FGHIJ-KLMNO-PQRST", accountId, customerId: "cus_aaaaaaaaaaaaaaaaaaaa", planId: PLAN, planName: "Anual", durationDays: 365, renewalDaysTotal: 0, renewalCount: 0, lifetime: false, maxDevices: 2, startMode: "first_activation", status: "active", activatedAt: "2026-01-01T00:00:00.000Z", expiresAt: originalExpiry, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  api.store.set(`customerAccounts/${accountId}/licenses/${licenseId}`, { licenseId, projectId: PROJECT, accountId });
  const created = await handleRequest(request(`/api/v1/customer/licenses/${licenseId}/renewal-order`, "POST", { planId: PLAN, idempotencyKey: "renewal-request-001" }), env(api));
  assert.equal(created.status, 201);
  assert.equal(api.store.get(`projects/${PROJECT}/licenses/${licenseId}`).expiresAt, originalExpiry);
  const order = (await created.json()).order;
  const context = { paymentId: "pay_cccccccccccccccccccc", orderId: order.orderId, accountId, status: "paid", amountCents: 2990, currency: "BRL", provider: "pagbank", method: "future" };
  await finalizePaidOrder(env(api), order.orderId, context);
  const renewed = api.store.get(`projects/${PROJECT}/licenses/${licenseId}`);
  assert.equal(renewed.key, "GPL-ABCDE-FGHIJ-KLMNO-PQRST");
  assert.equal(renewed.renewalCount, 1);
  assert.equal(renewed.expiresAt, "2027-11-30T00:00:00.000Z");
  await finalizePaidOrder(env(api), order.orderId, context);
  assert.equal(api.store.get(`projects/${PROJECT}/licenses/${licenseId}`).renewalCount, 1);

  api.setIdentity("customer-b", "b@example.com");
  const otherLicenses = await handleRequest(request("/api/v1/customer/licenses"), env(api));
  assert.deepEqual((await otherLicenses.json()).licenses, []);
  const forbidden = await handleRequest(request(`/api/v1/customer/licenses/${licenseId}/renewal-order`, "POST", { planId: PLAN, idempotencyKey: "renewal-request-b" }), env(api));
  assert.equal(forbidden.status, 404);
});

test("tentativa e evento de pagamento são idempotentes e sem payload bruto", async () => {
  const api = services({ "orders/ord_aaaaaaaaaaaaaaaaaaaa": { orderId: "ord_aaaaaaaaaaaaaaaaaaaa", accountId: "acct_aaaaaaaaaaaaaaaaaaaa", status: "pending_payment", totalCents: 2990, currency: "BRL" } });
  const args = { atomicClient: api.atomicClient(), orderId: "ord_aaaaaaaaaaaaaaaaaaaa", accountId: "acct_aaaaaaaaaaaaaaaaaaaa", provider: "pagbank", idempotencyKey: "payment-request", hash: async value => sha(value), randomId: () => "pay_aaaaaaaaaaaaaaaaaaaa", now: () => "2026-10-05T12:00:00.000Z" };
  const first = await createPaymentAttempt(args); const replay = await createPaymentAttempt(args);
  assert.equal(first.payment.amountCents, 2990); assert.equal(replay.idempotentReplay, true);
  api.store.set("payments/pay_aaaaaaaaaaaaaaaaaaaa", { ...api.store.get("payments/pay_aaaaaaaaaaaaaaaaaaaa"), status: "processing" });
  const eventArgs = { atomicClient: api.atomicClient(), normalizedEvent: { provider: "pagbank", providerEventId: "event-1", paymentId: "pay_aaaaaaaaaaaaaaaaaaaa", orderId: "ord_aaaaaaaaaaaaaaaaaaaa", status: "paid", eventType: "payment.paid" }, hash: async value => sha(value), now: () => "2026-10-05T12:01:00.000Z" };
  const event = await recordPaymentEvent(eventArgs); const eventReplay = await recordPaymentEvent(eventArgs);
  assert.equal(event.payment.status, "paid"); assert.equal(eventReplay.idempotentReplay, true);
  assert.equal(JSON.stringify(event.event).includes("payload"), false);
});

test("RBAC comercial respeita o escopo de projetos em pedidos e pagamentos", async () => {
  const uid = "scoped-commerce-admin";
  const email = "scoped-admin@example.com";
  const adminId = sha(email);
  const allowedOrder = "ord_aaaaaaaaaaaaaaaaaaaa";
  const hiddenOrder = "ord_bbbbbbbbbbbbbbbbbbbb";
  const allowedPayment = "pay_aaaaaaaaaaaaaaaaaaaa";
  const hiddenPayment = "pay_bbbbbbbbbbbbbbbbbbbb";
  const api = services({
    [`adminUids/${sha(uid)}`]: { adminId },
    [`admins/${adminId}`]: {
      firebaseUid: uid,
      email,
      status: "active",
      allProjects: false,
      projectIds: [PROJECT],
      permissions: { viewOrders: true, viewPayments: true }
    },
    [`orders/${allowedOrder}`]: {
      orderId: allowedOrder,
      accountId: "acct_aaaaaaaaaaaaaaaaaaaa",
      totalCents: 2990,
      items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }],
      status: "pending_payment",
      createdAt: "2026-10-05T12:00:00.000Z"
    },
    [`orders/${hiddenOrder}`]: {
      orderId: hiddenOrder,
      accountId: "acct_bbbbbbbbbbbbbbbbbbbb",
      totalCents: 2990,
      items: [{ projectId: OTHER_PROJECT, planId: PLAN, quantity: 1 }],
      status: "pending_payment",
      createdAt: "2026-10-05T12:01:00.000Z"
    },
    [`payments/${allowedPayment}`]: {
      paymentId: allowedPayment,
      orderId: allowedOrder,
      accountId: "acct_aaaaaaaaaaaaaaaaaaaa",
      status: "pending",
      amountCents: 2990,
      currency: "BRL",
      createdAt: "2026-10-05T12:00:00.000Z"
    },
    [`payments/${hiddenPayment}`]: {
      paymentId: hiddenPayment,
      orderId: hiddenOrder,
      accountId: "acct_bbbbbbbbbbbbbbbbbbbb",
      status: "pending",
      amountCents: 2990,
      currency: "BRL",
      createdAt: "2026-10-05T12:01:00.000Z"
    }
  });
  api.setIdentity(uid, email);
  const adminEnv = env(api);

  const ordersResponse = await handleRequest(request("/api/v1/admin/orders"), adminEnv);
  assert.equal(ordersResponse.status, 200);
  assert.deepEqual((await ordersResponse.json()).orders.map(item => item.orderId), [allowedOrder]);

  const hiddenOrderResponse = await handleRequest(request(`/api/v1/admin/orders/${hiddenOrder}`), adminEnv);
  assert.equal(hiddenOrderResponse.status, 404);

  const paymentsResponse = await handleRequest(request("/api/v1/admin/payments"), adminEnv);
  assert.equal(paymentsResponse.status, 200);
  assert.deepEqual((await paymentsResponse.json()).payments.map(item => item.paymentId), [allowedPayment]);

  const hiddenPaymentResponse = await handleRequest(request(`/api/v1/admin/payments/${hiddenPayment}`), adminEnv);
  assert.equal(hiddenPaymentResponse.status, 404);
});

test("adapter PagBank permanece inerte e explicitamente não configurado", async () => {
  const provider = new PagBankProvider();
  await assert.rejects(() => provider.createPayment({}), error => error.reason === "payment_provider_not_configured");
  await assert.rejects(() => provider.verifyWebhook({}), error => error.reason === "payment_provider_not_configured");
});

test("RBAC comercial separa pedidos e pagamentos sem permitir mutação", async () => {
  const uid = "commerce-admin";
  const adminId = sha("admin@example.com");
  const api = services({
    [`adminUids/${sha(uid)}`]: { adminId },
    [`admins/${adminId}`]: { firebaseUid: uid, email: "admin@example.com", status: "active", allProjects: true, projectIds: [], permissions: { viewOrders: true, viewPayments: false } },
    "orders/ord_aaaaaaaaaaaaaaaaaaaa": { orderId: "ord_aaaaaaaaaaaaaaaaaaaa", accountId: "acct_aaaaaaaaaaaaaaaaaaaa", totalCents: 2990, items: [], status: "pending_payment" }
  });
  api.setIdentity(uid, "admin@example.com");
  const adminEnv = env(api);
  const orders = await handleRequest(request("/api/v1/admin/orders"), adminEnv);
  const payments = await handleRequest(request("/api/v1/admin/payments"), adminEnv);
  const mutation = await handleRequest(request("/api/v1/admin/orders", "POST", {}), adminEnv);
  assert.equal(orders.status, 200);
  assert.equal(payments.status, 403);
  assert.equal(mutation.status, 405);
});
