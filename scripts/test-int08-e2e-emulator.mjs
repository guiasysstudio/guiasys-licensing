import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWorker = createRequire(path.join(root, "worker/package.json"));
const { initializeApp } = await import(pathToFileURL(requireFromWorker.resolve("firebase-admin/app")));
const { getAuth } = await import(pathToFileURL(requireFromWorker.resolve("firebase-admin/auth")));
const { getFirestore } = await import(pathToFileURL(requireFromWorker.resolve("firebase-admin/firestore")));
const projectId = process.env.GCLOUD_PROJECT;
const functionHost = process.env.FUNCTIONS_EMULATOR_HOST;

assert.equal(projectId, "demo-guiasys-licensing", "E2E deve usar o projeto ficticio.");
for (const [name, host] of [
  ["FIRESTORE_EMULATOR_HOST", process.env.FIRESTORE_EMULATOR_HOST],
  ["FIREBASE_AUTH_EMULATOR_HOST", process.env.FIREBASE_AUTH_EMULATOR_HOST],
  ["FIREBASE_STORAGE_EMULATOR_HOST", process.env.FIREBASE_STORAGE_EMULATOR_HOST],
  ["FUNCTIONS_EMULATOR_HOST", functionHost]
]) {
  assert.match(host || "", /^(?:127\.0\.0\.1|localhost):\d+$/, `${name} deve apontar para um emulador local.`);
}

function parseLocalEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}

const secret = parseLocalEnv(await readFile(path.join(root, "worker/.secret.local"), "utf8"));
const adminUid = secret.ADMIN_FIREBASE_UID;
assert.match(adminUid || "", /(?:demo|emulat|fake|local|test)/i, "UID administrativo deve ser ficticio.");

const app = initializeApp({ projectId }, "int08-e2e");
const auth = getAuth(app);
const db = getFirestore(app);
const password = "Senha-INT08-123";
const customerA = "customer-int08-e2e-a";
const customerB = "customer-int08-e2e-b";
const project = "prj_33333333333333333333";
const plan = "plan_44444444444444444444";

await Promise.all([
  auth.createUser({ uid: customerA, email: "cliente.int08.a@example.com", password, emailVerified: true }),
  auth.createUser({ uid: customerB, email: "cliente.int08.b@example.com", password, emailVerified: true }),
  auth.createUser({ uid: adminUid, email: "admin.int08@example.com", password, emailVerified: true })
]);

await db.doc(`projects/${project}`).set({
  name: "Programa INT-08 E2E",
  prefix: "I08",
  status: "active",
  publicCatalog: true,
  slug: "programa-int08-e2e",
  tagline: "Catalogo ficticio do emulador"
});
await db.doc(`projects/${project}/plans/${plan}`).set({
  name: "Plano INT-08 E2E",
  price: 50,
  priceCents: 5000,
  durationDays: 365,
  lifetime: false,
  deviceLimit: 2,
  startMode: "first_activation",
  active: true,
  publicCatalog: true,
  publishedInCatalog: true,
  termsVersion: "2026-10"
});

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
async function login(email) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  assert.equal(response.status, 200, `Login local falhou para ${email}.`);
  return (await response.json()).idToken;
}

const [tokenA, tokenB, adminToken] = await Promise.all([
  login("cliente.int08.a@example.com"),
  login("cliente.int08.b@example.com"),
  login("admin.int08@example.com")
]);
const apiBase = `http://${functionHost}/${projectId}/southamerica-east1/licensingApi`;

async function api(token, route, method = "GET", body) {
  const response = await fetch(`${apiBase}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, data: await response.json().catch(() => ({})) };
}

const profile = await api(tokenA, "/api/v1/customer/me", "PATCH", {
  displayName: "Cliente INT-08 A",
  taxId: "529.982.247-25",
  phone: "(69) 99999-9999",
  postalCode: "76900-000",
  street: "Rua Emulator",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Ji-Parana",
  state: "RO"
});
assert.equal(profile.response.status, 200);
assert.equal(profile.data.account.profileComplete, true);

const orderBody = {
  idempotencyKey: "int08-e2e-order-001",
  items: [{ projectId: project, planId: plan, quantity: 1 }]
};
const created = await api(tokenA, "/api/v1/customer/orders", "POST", orderBody);
assert.equal(created.response.status, 201);
const order = created.data.order;
const orderReplay = await api(tokenA, "/api/v1/customer/orders", "POST", orderBody);
assert.equal(orderReplay.response.status, 201);
assert.equal(orderReplay.data.order.orderId, order.orderId);

const payment = await api(tokenA, `/api/v1/customer/orders/${order.orderId}/payment`, "POST", {
  method: "pix",
  idempotencyKey: `pix-${order.orderId}`
});
assert.equal(payment.response.status, 201);
assert.equal(payment.data.payment.paymentProvider, "manual_pix");

const reported = await api(tokenA, `/api/v1/customer/orders/${order.orderId}/payment-reported`, "POST", {});
assert.equal(reported.response.status, 200);
const foreign = await api(tokenB, `/api/v1/customer/orders/${order.orderId}`);
assert.equal(foreign.response.status, 404);

const confirmed = await api(adminToken, `/api/v1/admin/orders/${order.orderId}/confirm-payment`, "POST", {});
assert.equal(confirmed.response.status, 200);
assert.equal(confirmed.data.order.status, "fulfilled");
assert.equal(confirmed.data.order.resultingLicenses.length, 1);
const confirmationReplay = await api(adminToken, `/api/v1/admin/orders/${order.orderId}/confirm-payment`, "POST", {});
assert.equal(confirmationReplay.response.status, 200);
assert.equal(confirmationReplay.data.idempotentReplay, true);

const licenses = await api(tokenA, "/api/v1/customer/licenses");
assert.equal(licenses.response.status, 200);
assert.equal(licenses.data.licenses.length, 1);
assert.equal(licenses.data.licenses[0].orderId, order.orderId);

console.log("INT-08 E2E Emulator: OK - Auth -> Function v2 -> Firestore, PIX manual, RBAC, ownership e idempotencia.");
