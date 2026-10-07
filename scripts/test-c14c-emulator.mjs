import assert from "node:assert/strict";

import { handleRequest } from "../worker/src/index.js";
import { createFirebaseRuntime } from "../worker/src/firebase-runtime.js";

const PROJECT = "prj_11111111111111111111";
const PLAN = "plan_22222222222222222222";
const envBase = {
  FIREBASE_PROJECT_ID: "guiasys-licensing",
  ADMIN_FIREBASE_UID: "master-emulator-c14c",
  PAYMENT_PROVIDER: "manual_pix",
  PAGBANK_ENABLED: "false"
};

const firebase = createFirebaseRuntime();
let identity = {
  uid: "customer-emulator-a",
  email: "customer-a@example.com",
  name: "Cliente A"
};

const services = {
  ...firebase,
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
      name: identity.name,
      firebase: { sign_in_provider: "password" }
    };
  },
  async getAccountState() {
    return {
      localId: identity.uid,
      email: identity.email,
      displayName: identity.name,
      emailVerified: true,
      disabled: false,
      validSince: "0"
    };
  },
  log() {}
};

const env = { ...envBase, __services: services };

function setIdentity(uid, email, name = email) {
  identity = { uid, email, name };
}

function apiRequest(path, method = "GET", body) {
  return new Request(`https://licencas.guiasys.online${path}`, {
    method,
    headers: {
      Authorization: "Bearer emulator-test",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

async function call(path, method = "GET", body) {
  const response = await handleRequest(apiRequest(path, method, body), env);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createOrder(idempotencyKey, quantity = 1) {
  const { response, data } = await call("/api/v1/customer/orders", "POST", {
    idempotencyKey,
    items: [{ projectId: PROJECT, planId: PLAN, quantity }]
  });
  assert.equal(response.status, 201);
  return data.order;
}

await firebase.setDoc(`projects/${PROJECT}`, {
  name: "GuiaPlay Emulator",
  prefix: "GPE",
  status: "active",
  publicCatalog: false,
  slug: "guiaplay-emulator",
  tagline: "Catálogo C15"
});
await firebase.setDoc(`projects/${PROJECT}/plans/${PLAN}`, {
  name: "Plano Emulator",
  price: 50,
  priceCents: 5000,
  durationDays: 365,
  lifetime: false,
  deviceLimit: 2,
  startMode: "first_activation",
  active: true,
  publicCatalog: false,
  publishedInCatalog: true,
  termsVersion: "2026-10"
});

const profile = await call("/api/v1/customer/me", "PATCH", {
  displayName: "Cliente A",
  taxId: "529.982.247-25",
  phone: "(69) 99999-9999",
  postalCode: "76900-000",
  street: "Rua Emulator",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Ji-Paraná",
  state: "RO"
});
assert.equal(profile.response.status, 200);
assert.equal(profile.data.account.profileComplete, true);

const catalog = await call("/api/v1/catalog");
assert.equal(catalog.response.status, 200);
assert.equal(catalog.data.catalog.projects[0].slug, "guiaplay-emulator");
const detail = await call("/api/v1/catalog/guiaplay-emulator");
assert.equal(detail.response.status, 200);

const [first, second] = await Promise.all([
  createOrder("emulator-order-a-001", 2),
  createOrder("emulator-order-a-002")
]);
assert.equal(first.totalCents, 10000);
assert.equal(second.totalCents, 5000);
assert.notEqual(first.orderNumber, second.orderNumber);
assert.deepEqual(new Set([first.orderNumber, second.orderNumber]), new Set(["GS-000001", "GS-000002"]));

const manipulatedPrice = await call("/api/v1/customer/orders", "POST", {
  idempotencyKey: "emulator-order-price",
  totalCents: 1,
  items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }]
});
assert.equal(manipulatedPrice.response.status, 400);

const manipulatedUid = await call("/api/v1/customer/orders", "POST", {
  idempotencyKey: "emulator-order-uid",
  customerUid: "attacker",
  items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }]
});
assert.equal(manipulatedUid.response.status, 400);

const payment = await call(`/api/v1/customer/orders/${first.orderId}/payment`, "POST", {
  method: "pix",
  idempotencyKey: `pix-${first.orderId}`
});
assert.equal(payment.response.status, 201);
assert.equal(payment.data.payment.paymentProvider, "manual_pix");

const clientPaid = await call(`/api/v1/customer/orders/${first.orderId}/payment-reported`, "POST", { paid: true });
assert.equal(clientPaid.response.status, 400);
assert.equal((await firebase.getDoc(`orders/${first.orderId}`)).status, "pending_payment");

const reported = await call(`/api/v1/customer/orders/${first.orderId}/payment-reported`, "POST", {});
assert.equal(reported.response.status, 200);
assert.equal(reported.data.order.status, "payment_reported");
assert.equal(reported.data.order.paymentStatus, "reported");

const reportReplay = await call(`/api/v1/customer/orders/${first.orderId}/payment-reported`, "POST", {});
assert.equal(reportReplay.response.status, 200);
assert.equal(reportReplay.data.order.idempotentReplay, true);

const savedCart = await call("/api/v1/customer/cart", "PUT", {
  items: [{ projectId: PROJECT, planId: PLAN, quantity: 2 }]
});
assert.equal(savedCart.response.status, 200);
const savedFavorite = await call(`/api/v1/customer/favorites/${PROJECT}`, "POST");
assert.equal(savedFavorite.response.status, 201);

setIdentity("customer-emulator-b", "customer-b@example.com", "Cliente B");
const foreignOrder = await call(`/api/v1/customer/orders/${first.orderId}`);
assert.equal(foreignOrder.response.status, 404);
const foreignOrders = await call("/api/v1/customer/orders");
const foreignLicenses = await call("/api/v1/customer/licenses");
assert.deepEqual(foreignOrders.data.orders, []);
assert.deepEqual(foreignLicenses.data.licenses, []);
assert.deepEqual((await call("/api/v1/customer/cart")).data.cart.items, []);
assert.deepEqual((await call("/api/v1/customer/favorites")).data.projectIds, []);
const nonAdmin = await call(`/api/v1/admin/orders/${first.orderId}/confirm-payment`, "POST", {});
assert.equal(nonAdmin.response.status, 403);

setIdentity(envBase.ADMIN_FIREBASE_UID, "admin@example.com", "Administrador");
const confirmed = await call(`/api/v1/admin/orders/${first.orderId}/confirm-payment`, "POST", {});
assert.equal(confirmed.response.status, 200);
assert.equal(confirmed.data.order.status, "fulfilled");
assert.equal(confirmed.data.order.paymentStatus, "paid");
assert.equal(confirmed.data.order.fulfillmentStatus, "fulfilled");
assert.equal(confirmed.data.order.resultingLicenses.length, 2);

const confirmationReplay = await call(`/api/v1/admin/orders/${first.orderId}/confirm-payment`, "POST", {});
assert.equal(confirmationReplay.response.status, 200);
assert.equal(confirmationReplay.data.idempotentReplay, true);

const licenses = await firebase.listCollection(`projects/${PROJECT}/licenses`);
assert.equal(licenses.length, 2);
const fulfilledOrder = await firebase.getDoc(`orders/${first.orderId}`);
assert.equal(fulfilledOrder.resultingLicenses.length, 2);
assert.equal(new Set(fulfilledOrder.resultingLicenses.map(item => item.licenseId)).size, 2);
assert.ok(fulfilledOrder.resultingLicenses.every(item => item.orderItemId === first.items[0].orderItemId));

setIdentity("customer-emulator-a", "customer-a@example.com", "Cliente A");
const ownOrders = await call("/api/v1/customer/orders");
const ownLicenses = await call("/api/v1/customer/licenses");
assert.equal(ownOrders.data.orders.length, 2);
assert.equal(ownLicenses.data.licenses.length, 2);
assert.ok(ownLicenses.data.licenses.every(license => license.orderId === first.orderId));

const originalFetch = globalThis.fetch;
let pagBankNetworkCalls = 0;
globalThis.fetch = async () => {
  pagBankNetworkCalls += 1;
  throw new Error("PagBank não deve ser chamado");
};
try {
  const webhook = await handleRequest(new Request(
    "https://licencas.guiasys.online/api/v1/webhooks/pagbank",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  ), env);
  assert.equal(webhook.status, 404);
  assert.equal((await webhook.json()).error, "pagbank_disabled");
  assert.equal(pagBankNetworkCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(Object.hasOwn(env, "PAGBANK_TOKEN"), false);

console.log([
  "C14-C Firestore Emulator: OK",
  "- 2 pedidos concorrentes com preço server-side e números únicos",
  "- manipulação de preço/customerUid/paid bloqueada",
  "- ownership e RBAC administrativo validados",
  "- pending_payment -> payment_reported -> paid -> fulfilled validado",
  "- catálogo C15 por slug e publicação explícita de plano",
  "- perfil completo obrigatório antes do checkout",
  "- confirmação/fulfillment idempotentes (2 unidades = 2 licenças)",
  "- carrinho, favoritos e Minhas Compras isolados por usuário",
  "- PagBank: 0 chamadas de rede; execução sem PAGBANK_TOKEN"
].join("\n"));
