import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { handleRequest } from "../src/index.js";
import {
  DEFAULT_PAYMENT_SETTINGS,
  buildManualPixPresentation,
  buildPixPayload,
  pixCrc16,
  pixTxidForOrder
} from "../src/payments/manual-pix.js";

const PROJECT = "prj_cccccccccccccccccccc";
const PLAN = "plan_cccccccccccccccccccc";
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const clone = value => value == null ? value : structuredClone(value);
const docId = path => String(path).split("/").pop();

function services(initial = {}) {
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  let identity = { uid: "customer-c", email: "cliente@example.com", name: "Cliente Teste" };
  const seedProfile = ({ uid, email, name }) => {
    const accountId = `acct_${sha(uid).slice(0, 20)}`;
    if (!store.has(`customerAccounts/${accountId}`)) store.set(`customerAccounts/${accountId}`, {
      accountId, firebaseUid: uid, email, emailVerified: true, displayName: name,
      taxId: "52998224725", phone: "69999999999", postalCode: "76900000",
      street: "Rua Teste", number: "100", complement: "", neighborhood: "Centro",
      city: "Ji-Paraná", state: "RO", status: "active",
      createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z"
    });
  };
  seedProfile(identity);
  const read = path => store.has(path) ? { id: docId(path), ...clone(store.get(path)) } : null;
  return {
    store,
    setIdentity(uid, email, name = email) { identity = { uid, email, name }; seedProfile(identity); },
    runtime: "firebase-functions-v2",
    async verifyIdToken() {
      const now = Math.floor(Date.now() / 1000);
      return { aud: "guiasys-licensing", iss: "https://securetoken.google.com/guiasys-licensing", sub: identity.uid, exp: now + 3600, iat: now - 10, auth_time: now - 10, email: identity.email, email_verified: true, name: identity.name, firebase: { sign_in_provider: "password" } };
    },
    async getAccountState() { return { localId: identity.uid, email: identity.email, displayName: identity.name, emailVerified: true, disabled: false, validSince: "0" }; },
    async getDoc(path) { return read(path); },
    async setDoc(path, value) { store.set(path, clone(value)); },
    async listCollection(path) {
      const prefix = `${path}/`;
      return [...store.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
        .map(([key, value]) => ({ id: docId(key), ...clone(value) }));
    },
    atomicClient() {
      return { async runTransaction(operation) {
        const writes = [];
        const tx = {
          async get(path) { return read(path); },
          async queryByField() { return []; },
          set(path, value) { writes.push({ path, value: clone(value) }); },
          create(path, value) {
            if (store.has(path) || writes.some(item => item.path === path)) throw Object.assign(new Error("exists"), { status: 409, reason: "concurrency_conflict" });
            writes.push({ path, value: clone(value) });
          },
          delete(path) { writes.push({ path, remove: true }); }
        };
        const result = await operation(tx);
        for (const write of writes) write.remove ? store.delete(write.path) : store.set(write.path, write.value);
        return result;
      } };
    },
    log() {}
  };
}

function baseData() {
  return {
    [`projects/${PROJECT}`]: { name: "GuiaPlay", prefix: "GPL", status: "active", publicCatalog: true },
    [`projects/${PROJECT}/plans/${PLAN}`]: { name: "Plano lançamento", price: 50, priceCents: 5000, durationDays: 365, lifetime: false, deviceLimit: 2, startMode: "first_activation", active: true, publicCatalog: true }
  };
}

function environment(api, extra = {}) {
  return { FIREBASE_PROJECT_ID: "guiasys-licensing", ADMIN_FIREBASE_UID: "master", PAYMENT_PROVIDER: "manual_pix", PAGBANK_ENABLED: "false", __services: api, ...extra };
}

function request(path, method = "GET", body, authorization = "Bearer user") {
  return new Request(`https://licencas.guiasys.online${path}`, {
    method,
    headers: { Authorization: authorization, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

function parseTlv(payload) {
  const result = new Map();
  for (let offset = 0; offset < payload.length;) {
    const id = payload.slice(offset, offset + 2);
    const length = Number(payload.slice(offset + 2, offset + 4));
    const value = payload.slice(offset + 4, offset + 4 + length);
    assert.equal(value.length, length, `tamanho inválido no campo ${id}`);
    result.set(id, value);
    offset += 4 + length;
  }
  return result;
}

async function createOrder(api, idempotencyKey = "manual-order-001") {
  const response = await handleRequest(request("/api/v1/customer/orders", "POST", {
    idempotencyKey,
    items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }]
  }), environment(api));
  assert.equal(response.status, 201);
  return (await response.json()).order;
}

async function createPayment(api, order) {
  const response = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/payment`, "POST", {
    method: "pix",
    idempotencyKey: `pix-${order.orderId}`
  }), environment(api));
  assert.equal(response.status, 201);
  return (await response.json()).payment;
}

test("BR Code PIX de R$ 50,00 contém campos oficiais e CRC16 válido", () => {
  const txid = pixTxidForOrder("ord_cccccccccccccccccccc");
  const payload = buildPixPayload({
    pixKey: DEFAULT_PAYMENT_SETTINGS.pixKey,
    pixMerchantName: DEFAULT_PAYMENT_SETTINGS.pixMerchantName,
    pixMerchantCity: DEFAULT_PAYMENT_SETTINGS.pixMerchantCity,
    amountCents: 5000,
    txid
  });
  const root = parseTlv(payload);
  const merchant = parseTlv(root.get("26"));
  const additional = parseTlv(root.get("62"));
  assert.equal(root.get("00"), "01");
  assert.equal(merchant.get("00"), "br.gov.bcb.pix");
  assert.equal(merchant.get("01"), "821fee6e-dbdd-46ea-adfc-8afffc89d422");
  assert.equal(root.get("53"), "986");
  assert.equal(root.get("54"), "50.00");
  assert.equal(root.get("58"), "BR");
  assert.equal(root.get("59"), "ANDREW LINDOLFO");
  assert.equal(root.get("60"), "JI PARANA");
  assert.equal(additional.get("05"), txid);
  assert.equal(root.get("63"), pixCrc16(payload.slice(0, -4)));
});

test("TXID é determinístico, único por pedido e compatível com Pix", () => {
  const first = pixTxidForOrder("ord_one");
  assert.equal(first, pixTxidForOrder("ord_one"));
  assert.notEqual(first, pixTxidForOrder("ord_two"));
  assert.match(first, /^[A-Z0-9]{1,35}$/);
  assert.equal(first.length, 25);
});

test("QR Code recebe exatamente o mesmo Copia e Cola", async () => {
  let qrInput = "";
  const presentation = await buildManualPixPresentation({
    settings: DEFAULT_PAYMENT_SETTINGS,
    order: { orderId: "ord_qr", totalCents: 5000 },
    qrCodeFactory: async value => { qrInput = value; return "data:image/png;base64,dGVzdGU="; }
  });
  assert.equal(qrInput, presentation.pixCode);
  assert.match(presentation.pixQrCodeDataUrl, /^data:image\/png;base64,/);
});

test("configuração pública expõe somente dados necessários do PIX manual", async () => {
  const response = await handleRequest(request("/api/v1/payment-config"), environment(services()));
  assert.equal(response.status, 200);
  const payment = (await response.json()).payment;
  assert.equal(payment.paymentProvider, "manual_pix");
  assert.equal(payment.pixEnabled, true);
  assert.equal(payment.pixDisplayName, "GuiaSys");
  assert.equal(Object.hasOwn(payment, "updatedByAdminUid"), false);
});

test("pedidos usam preço do servidor e numeração sequencial transacional", async () => {
  const api = services(baseData());
  const first = await createOrder(api, "manual-order-number-1");
  const second = await createOrder(api, "manual-order-number-2");
  assert.equal(first.totalCents, 5000);
  assert.equal(first.orderNumber, "GS-000001");
  assert.equal(second.orderNumber, "GS-000002");
  assert.equal(first.paymentProvider, "manual_pix");
  assert.equal(first.paymentMethod, "pix");
  assert.match(first.pixTxid, /^[A-Z0-9]{1,35}$/);
});

test("PIX manual, payment_reported e confirmação admin são idempotentes", async () => {
  const api = services(baseData());
  const order = await createOrder(api);
  const payment = await createPayment(api, order);
  const replay = await createPayment(api, order);
  assert.equal(payment.paymentId, replay.paymentId);
  assert.equal(payment.pixCode, replay.pixCode);
  assert.match(payment.pixQrCodeDataUrl, /^data:image\/png;base64,/);

  const reported = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/payment-reported`, "POST", {}), environment(api));
  assert.equal(reported.status, 200);
  assert.equal((await reported.json()).order.status, "payment_reported");
  const reportReplay = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/payment-reported`, "POST", {}), environment(api));
  assert.equal((await reportReplay.json()).order.idempotentReplay, true);

  api.setIdentity("not-admin", "other@example.com");
  const denied = await handleRequest(request(`/api/v1/admin/orders/${order.orderId}/confirm-payment`, "POST", {}), environment(api));
  assert.equal(denied.status, 403);

  api.setIdentity("master", "admin@example.com", "Administrador");
  const confirmed = await handleRequest(request(`/api/v1/admin/orders/${order.orderId}/confirm-payment`, "POST", {}), environment(api));
  assert.equal(confirmed.status, 200);
  const fulfilled = (await confirmed.json()).order;
  assert.equal(fulfilled.status, "fulfilled");
  assert.equal(fulfilled.paymentStatus, "paid");
  assert.equal(fulfilled.fulfillmentStatus, "fulfilled");
  assert.equal(fulfilled.paidByAdminUid, "master");
  assert.equal(fulfilled.resultingLicenses.length, 1);

  const confirmationReplay = await handleRequest(request(`/api/v1/admin/orders/${order.orderId}/confirm-payment`, "POST", {}), environment(api));
  assert.equal((await confirmationReplay.json()).idempotentReplay, true);
  assert.equal([...api.store.keys()].filter(path => new RegExp(`^projects/${PROJECT}/licenses/`).test(path)).length, 1);
  const actions = [...api.store.entries()].filter(([path]) => path.startsWith("platformLogs/")).map(([, log]) => log.action);
  assert.equal(actions.filter(action => action === "payment_reported").length, 1);
  assert.equal(actions.filter(action => action === "payment_confirmed").length, 1);
  assert.equal(actions.filter(action => action === "license_issued").length, 1);
});

test("cliente não marca paid, pedido cancelado não reporta e outra conta não acessa", async () => {
  const api = services(baseData());
  const order = await createOrder(api, "manual-security-1");
  await createPayment(api, order);
  const invalid = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/payment-reported`, "POST", { paid: true }), environment(api));
  assert.equal(invalid.status, 400);

  api.setIdentity("customer-other", "other@example.com");
  const foreign = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}`), environment(api));
  assert.equal(foreign.status, 404);
  const foreignReport = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/payment-reported`, "POST", {}), environment(api));
  assert.equal(foreignReport.status, 404);

  api.setIdentity("customer-c", "cliente@example.com", "Cliente Teste");
  const another = await createOrder(api, "manual-security-2");
  await createPayment(api, another);
  const cancelled = await handleRequest(request(`/api/v1/customer/orders/${another.orderId}/cancel`, "POST"), environment(api));
  assert.equal(cancelled.status, 200);
  const reportCancelled = await handleRequest(request(`/api/v1/customer/orders/${another.orderId}/payment-reported`, "POST", {}), environment(api));
  assert.equal(reportCancelled.status, 409);
});

test("Minhas Compras retorna somente pedido e licença da própria conta", async () => {
  const api = services(baseData());
  const order = await createOrder(api, "manual-purchases-1");
  await createPayment(api, order);
  await handleRequest(request(`/api/v1/customer/orders/${order.orderId}/payment-reported`, "POST", {}), environment(api));
  api.setIdentity("master", "admin@example.com", "Administrador");
  await handleRequest(request(`/api/v1/admin/orders/${order.orderId}/confirm-payment`, "POST", {}), environment(api));

  api.setIdentity("customer-c", "cliente@example.com", "Cliente Teste");
  const orders = await handleRequest(request("/api/v1/customer/orders"), environment(api));
  const licenses = await handleRequest(request("/api/v1/customer/licenses"), environment(api));
  assert.deepEqual((await orders.json()).orders.map(item => item.orderId), [order.orderId]);
  assert.equal((await licenses.json()).licenses.length, 1);

  api.setIdentity("customer-other", "other@example.com");
  const otherOrders = await handleRequest(request("/api/v1/customer/orders"), environment(api));
  const otherLicenses = await handleRequest(request("/api/v1/customer/licenses"), environment(api));
  assert.deepEqual((await otherOrders.json()).orders, []);
  assert.deepEqual((await otherLicenses.json()).licenses, []);
});

test("PagBank congelado retorna erro controlado sem rede e sem token", async () => {
  const api = services();
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("rede não deveria ser chamada"); };
  try {
    const response = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/webhooks/pagbank", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }), environment(api));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "pagbank_disabled");
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("somente admin altera configuração financeira", async () => {
  const api = services();
  const payload = { ...DEFAULT_PAYMENT_SETTINGS, pixDisplayName: "GuiaSys Oficial" };
  const denied = await handleRequest(request("/api/v1/admin/payment-settings", "PATCH", payload), environment(api));
  assert.equal(denied.status, 403);
  api.setIdentity("master", "admin@example.com", "Administrador");
  const updated = await handleRequest(request("/api/v1/admin/payment-settings", "PATCH", payload), environment(api));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).settings.pixDisplayName, "GuiaSys Oficial");
  assert.equal(api.store.get("platformSettings/payments").updatedByAdminUid, "master");
});

test("frontends expõem checkout, Minhas Compras e confirmação administrativa", async () => {
  const [catalogHtml, catalogJs, catalogCss, adminJs] = await Promise.all([
    readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8"),
    readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8")
  ]);
  assert.match(catalogHtml, /href="\/carrinho"/);
  assert.match(catalogJs, /Pagamento via PIX/);
  assert.match(catalogJs, /Já efetuei o pagamento/);
  assert.match(catalogJs, /Compras e licenças/);
  assert.match(catalogJs, /payment-reported/);
  assert.match(catalogJs, /Continuar pagamento/);
  assert.match(catalogJs, /Chave copiada/);
  assert.match(catalogCss, /\.pix-grid/);
  assert.match(adminJs, /\/api\/v1\/admin\/payment-settings/);
  assert.match(adminJs, /CONFIRMAR PAGAMENTO E LIBERAR LICENÇA/);
  assert.match(adminJs, /AVISAR CLIENTE PELO WHATSAPP/);
});
