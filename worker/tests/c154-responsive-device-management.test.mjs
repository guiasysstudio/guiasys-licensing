import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { handleRequest } from "../src/index.js";

const PROJECT = "prj_aaaaaaaaaaaaaaaaaaaa";
const LICENSE_A = "lic_aaaaaaaaaaaaaaaaaaaa";
const LICENSE_B = "lic_bbbbbbbbbbbbbbbbbbbb";
const CUSTOMER_A = "cus_aaaaaaaaaaaaaaaaaaaa";
const CUSTOMER_B = "cus_bbbbbbbbbbbbbbbbbbbb";
const DEVICE_A = createHash("sha256").update("DEVICE-A-C15.4").digest("hex");
const DEVICE_INACTIVE = createHash("sha256").update("DEVICE-INACTIVE-C15.4").digest("hex");
const DEVICE_OTHER_LICENSE = createHash("sha256").update("DEVICE-OTHER-LICENSE-C15.4").digest("hex");
const DEVICE_OTHER_CUSTOMER = createHash("sha256").update("DEVICE-OTHER-CUSTOMER-C15.4").digest("hex");
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const accountId = uid => `acct_${sha(uid).slice(0, 20)}`;
const clone = value => value == null ? value : structuredClone(value);
const docId = path => String(path).split("/").pop();

function profile(uid, email) {
  return {
    accountId: accountId(uid), firebaseUid: uid, email, emailVerified: true, displayName: email,
    taxId: "52998224725", phone: "69999999999", postalCode: "76900000",
    street: "Rua Teste", number: "100", complement: "", neighborhood: "Centro",
    city: "Ji-Paraná", state: "RO", status: "active",
    createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z"
  };
}

function fixture() {
  const accountA = profile("customer-a", "a@example.com");
  const accountB = profile("customer-b", "b@example.com");
  const initial = {
    [`customerAccounts/${accountA.accountId}`]: accountA,
    [`customerAccounts/${accountB.accountId}`]: accountB,
    [`customerAccounts/${accountA.accountId}/licenses/${LICENSE_A}`]: { licenseId: LICENSE_A, projectId: PROJECT, accountId: accountA.accountId },
    [`customerAccounts/${accountB.accountId}/licenses/${LICENSE_B}`]: { licenseId: LICENSE_B, projectId: PROJECT, accountId: accountB.accountId },
    [`projects/${PROJECT}`]: { name: "GuiaPlay", status: "active" },
    [`projects/${PROJECT}/licenses/${LICENSE_A}`]: {
      key: "GPL-AAAAA-BBBBB-CCCCC-DDDDD", accountId: accountA.accountId, customerId: CUSTOMER_A,
      planId: "plan_aaaaaaaaaaaaaaaaaaaa", planName: "Anual", status: "active", startMode: "first_activation",
      lifetime: false, maxDevices: 2, activatedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2027-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z"
    },
    [`projects/${PROJECT}/licenses/${LICENSE_B}`]: {
      key: "GPL-EEEEE-FFFFF-GGGGG-HHHHH", accountId: accountB.accountId, customerId: CUSTOMER_B,
      planId: "plan_bbbbbbbbbbbbbbbbbbbb", planName: "Mensal", status: "active", startMode: "immediate",
      lifetime: false, maxDevices: 1, createdAt: "2026-10-01T00:00:00.000Z"
    },
    [`projects/${PROJECT}/devices/${DEVICE_A}`]: {
      licenseId: LICENSE_A, customerId: CUSTOMER_A, deviceHash: DEVICE_A, name: "Notebook principal",
      platform: "Windows", active: true, firstActivatedAt: "2026-10-02T00:00:00.000Z",
      lastSeenAt: "2026-10-12T10:00:00.000Z", updatedAt: "2026-10-12T10:00:00.000Z"
    },
    [`projects/${PROJECT}/devices/${DEVICE_INACTIVE}`]: {
      licenseId: LICENSE_A, customerId: CUSTOMER_A, deviceHash: DEVICE_INACTIVE, name: "Notebook antigo",
      platform: "Windows", active: false, deactivatedAt: "2026-10-10T00:00:00.000Z"
    },
    [`projects/${PROJECT}/devices/${DEVICE_OTHER_LICENSE}`]: {
      licenseId: LICENSE_B, customerId: CUSTOMER_B, deviceHash: DEVICE_OTHER_LICENSE,
      name: "Dispositivo B", platform: "Linux", active: true
    },
    [`projects/${PROJECT}/devices/${DEVICE_OTHER_CUSTOMER}`]: {
      licenseId: LICENSE_A, customerId: CUSTOMER_B, deviceHash: DEVICE_OTHER_CUSTOMER,
      name: "Dispositivo inconsistente", platform: "Linux", active: true
    }
  };
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  let identity = { uid: "customer-a", email: "a@example.com" };
  const read = path => store.has(path) ? { id: docId(path), ...clone(store.get(path)) } : null;
  const list = path => {
    const prefix = `${path}/`;
    return [...store.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .map(([key, value]) => ({ id: docId(key), ...clone(value) }));
  };
  const services = {
    store,
    setIdentity(uid, email) { identity = { uid, email }; },
    runtime: "firebase-functions-v2",
    async verifyIdToken() {
      const now = Math.floor(Date.now() / 1000);
      return { aud: "guiasys-licensing", iss: "https://securetoken.google.com/guiasys-licensing", sub: identity.uid, exp: now + 3600, iat: now - 10, auth_time: now - 10, email: identity.email, email_verified: true, firebase: { sign_in_provider: "password" } };
    },
    async getAccountState() { return { localId: identity.uid, email: identity.email, displayName: identity.email, emailVerified: true, disabled: false, validSince: "0" }; },
    async getDoc(path) { return read(path); },
    async listCollection(path) { return list(path); },
    atomicClient() {
      return { async runTransaction(operation) {
        const writes = [];
        const tx = {
          async get(path) { return read(path); },
          async queryByField(base, collection, field, value) {
            return list(`${base}/${collection}`).filter(item => item[field] === value);
          },
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
  return { services, accountA, accountB };
}

function env(services) {
  return { FIREBASE_PROJECT_ID: "guiasys-licensing", ADMIN_FIREBASE_UID: "master", __services: services };
}

function request(path, method = "GET", body) {
  return new Request(`https://licencas.guiasys.online${path}`, {
    method,
    headers: { Authorization: "Bearer customer", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

function records(store, segment) {
  return [...store.entries()].filter(([path]) => path.includes(segment)).map(([, value]) => value);
}

test("listagem customer expõe somente devices ativos, próprios e com identificador visual mascarado", async () => {
  const { services } = fixture();
  const response = await handleRequest(request("/api/v1/customer/licenses"), env(services));
  assert.equal(response.status, 200);
  const licenses = (await response.json()).licenses;
  assert.equal(licenses.length, 1);
  assert.equal(licenses[0].projectName, "GuiaPlay");
  assert.equal(licenses[0].maxDevices, 2);
  assert.equal(licenses[0].devices.length, 1);
  assert.equal(licenses[0].devices[0].id, DEVICE_A);
  assert.equal(licenses[0].devices[0].maskedDeviceId, `••••••••${DEVICE_A.slice(-8)}`);
  assert.equal("deviceHash" in licenses[0].devices[0], false);
  assert.equal("customerId" in licenses[0].devices[0], false);
  assert.equal("mac" in licenses[0].devices[0], false);
});

test("cliente desativa device próprio, libera o slot e replay é idempotente", async () => {
  const { services, accountA } = fixture();
  const path = `/api/v1/customer/licenses/${LICENSE_A}/devices/${DEVICE_A}/deactivate`;
  const first = await handleRequest(request(path, "POST", { accountId: "acct_tampered", projectId: "prj_tampered" }), env(services));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).alreadyInactive, false);
  assert.equal(services.store.get(`projects/${PROJECT}/devices/${DEVICE_A}`).active, false);
  assert.equal(services.store.get(`projects/${PROJECT}/licenses/${LICENSE_A}`).maxDevices, 2);

  const activations = records(services.store, `/activations/`);
  const logs = records(services.store, `/logs/`);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].type, "deactivate");
  assert.equal(activations[0].source, "customer");
  assert.equal(activations[0].accountId, accountA.accountId);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "device.deactivated.customer");
  assert.equal(logs[0].actor, "customer-a");

  const replay = await handleRequest(request(path, "POST", {}), env(services));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).alreadyInactive, true);
  assert.equal(records(services.store, `/activations/`).length, 1);
  assert.equal(records(services.store, `/logs/`).length, 1);

  const listed = await handleRequest(request("/api/v1/customer/licenses"), env(services));
  assert.deepEqual((await listed.json()).licenses[0].devices, []);
});

test("ownership nega licença alheia, inexistente, device de outra licença e device de outro cliente", async () => {
  const { services } = fixture();
  services.setIdentity("customer-b", "b@example.com");
  const crossAccount = await handleRequest(request(`/api/v1/customer/licenses/${LICENSE_A}/devices/${DEVICE_A}/deactivate`, "POST", {}), env(services));
  assert.equal(crossAccount.status, 404);

  services.setIdentity("customer-a", "a@example.com");
  const missing = await handleRequest(request(`/api/v1/customer/licenses/lic_cccccccccccccccccccc/devices/${DEVICE_A}/deactivate`, "POST", {}), env(services));
  const wrongLicense = await handleRequest(request(`/api/v1/customer/licenses/${LICENSE_A}/devices/${DEVICE_OTHER_LICENSE}/deactivate`, "POST", {}), env(services));
  const wrongCustomer = await handleRequest(request(`/api/v1/customer/licenses/${LICENSE_A}/devices/${DEVICE_OTHER_CUSTOMER}/deactivate`, "POST", {}), env(services));
  assert.equal(missing.status, 404);
  assert.equal(wrongLicense.status, 404);
  assert.equal(wrongCustomer.status, 404);
  assert.equal(services.store.get(`projects/${PROJECT}/devices/${DEVICE_OTHER_LICENSE}`).active, true);
  assert.equal(services.store.get(`projects/${PROJECT}/devices/${DEVICE_OTHER_CUSTOMER}`).active, true);
});

test("portal renderiza licenças, estados, datas, devices e confirmação sem expor hash visualmente", async () => {
  const js = await readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8");
  assert.match(js, /pending:"Pendente", active:"Ativa", suspended:"Suspensa", expired:"Expirada", revoked:"Revogada"/);
  assert.match(js, /Validade inicia na primeira ativação/);
  assert.match(js, /Math\.max\(0, Math\.ceil/);
  assert.match(js, /Nenhum dispositivo vinculado/);
  assert.match(js, /device\.maskedDeviceId/);
  assert.equal(js.includes("device.deviceHash"), false);
  assert.match(js, /Desvincular este dispositivo\?/);
  assert.match(js, /dataset\.busy === "true"/);
  assert.match(js, /await renderPurchases\(\)/);
  assert.match(js, /showToast\(errorMessage\(error\)\)/);
  assert.match(js, /\/api\/v1\/customer\/licenses\/\$\{encodeURIComponent\(license\.licenseId \|\| license\.id\)\}\/devices/);
  assert.match(css, /\.license-key-value\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.device-card\{[^}]*min-width:0/);
  assert.match(css, /@media\(max-width:560px\)[^{]*\{[^}]*\.license-key-block\{grid-template-columns:1fr\}/);
  assert.match(css, /@media\(max-width:820px\),\(pointer:coarse\)[^{]*\{\.quantity button\{width:44px;height:44px\}/);
});
