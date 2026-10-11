import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { handleRequest } from "../src/index.js";

const PROJECT_ID = "prj_a145a145a145a145a145";
const CUSTOMER_ID = "cus_a145a145a145a145a145";
const LICENSE_ID = "lic_a145a145a145a145a145";
const LICENSE_KEY = "AGS-WGK3L-3U4ZR-495F2-99MF3";
const DEVICE_ID = "DEVICE-A145-PRIMARY";

const sha256 = value => createHash("sha256").update(String(value)).digest("hex");
const clone = value => value == null ? value : structuredClone(value);
const docId = path => String(path).split("/").pop();

function memoryServices(initial = {}) {
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  const operationalLogs = [];
  const read = path => store.has(path) ? { id: docId(path), ...clone(store.get(path)) } : null;

  return {
    store,
    operationalLogs,
    runtime: "firebase-functions-v2",
    async getDoc(path) { return read(path); },
    async setDoc(path, value) { store.set(path, clone(value)); return read(path); },
    async deleteDoc(path) { store.delete(path); },
    async listCollection(path) {
      const prefix = `${path}/`;
      return [...store.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
        .map(([key, value]) => ({ id: docId(key), ...clone(value) }));
    },
    async verifyIdToken() {
      const now = Math.floor(Date.now() / 1000);
      return {
        aud: "guiasys-licensing",
        iss: "https://securetoken.google.com/guiasys-licensing",
        sub: "uid-master-a145",
        exp: now + 3600,
        iat: now - 60,
        auth_time: now - 60,
        email: "master.a145@example.com",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" }
      };
    },
    async getAccountState(uid) {
      return {
        localId: uid,
        email: "master.a145@example.com",
        displayName: "Master A14.5",
        photoUrl: null,
        emailVerified: true,
        disabled: false,
        validSince: "0"
      };
    },
    atomicClient() {
      return {
        async runTransaction(operation) {
          const writes = [];
          const tx = {
            async get(path) { return read(path); },
            async queryByField(parent, collection, field, value) {
              const prefix = `${parent}/${collection}/`;
              return [...store.entries()]
                .filter(([path, record]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && record?.[field] === value)
                .map(([path, record]) => ({ id: docId(path), ...clone(record) }));
            },
            set(path, value) { writes.push({ path, value: clone(value) }); },
            create(path, value) {
              if (store.has(path) || writes.some(write => write.path === path)) {
                throw Object.assign(new Error("Documento já existe."), { status: 409, reason: "concurrency_conflict" });
              }
              writes.push({ path, value: clone(value) });
            },
            delete(path) { writes.push({ path, remove: true }); }
          };

          const result = await operation(tx);
          for (const write of writes) write.remove ? store.delete(write.path) : store.set(write.path, clone(write.value));
          return result;
        }
      };
    },
    log(level, event, details) { operationalLogs.push({ level, event, details }); }
  };
}

async function signingFixture() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  return {
    keyId: "sig_a145",
    algorithm: "ES256",
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z"
  };
}

async function fixture({ customerStatus = "active", licenseStatus = "active", withDevice = true } = {}) {
  const signing = await signingFixture();
  const deviceHash = sha256(DEVICE_ID);
  const activatedAt = licenseStatus === "pending" ? null : "2026-10-10T12:00:00.000Z";
  const expiresAt = licenseStatus === "pending" ? null : "2026-10-19T12:00:00.000Z";
  const initial = {
    [`projects/${PROJECT_ID}`]: {
      name: "AUDITORIA GSL",
      prefix: "AGS",
      status: "active",
      integrationCode: "GSLI-A145-A145-A145",
      allowedOrigins: [],
      offlineDays: 2,
      validationHours: 24,
      signingKeyId: signing.keyId,
      signingAlgorithm: "ES256",
      signingPublicJwk: signing.publicJwk,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    },
    [`projects/${PROJECT_ID}/internal/signing`]: signing,
    [`projects/${PROJECT_ID}/customers/${CUSTOMER_ID}`]: {
      name: "Cliente A14.5 STATUS",
      email: "cliente.a145.status@example.com",
      phone: "(69) 99999-9999",
      notes: "Auditoria funcional",
      status: customerStatus,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    },
    [`projects/${PROJECT_ID}/licenseKeys/${sha256(LICENSE_KEY)}`]: { licenseId: LICENSE_ID },
    [`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`]: {
      key: LICENSE_KEY,
      customerId: CUSTOMER_ID,
      customerName: "Cliente A14.5 STATUS",
      customerEmail: "cliente.a145.status@example.com",
      planId: "",
      planName: "Plano A14.5",
      durationDays: 9,
      renewalDaysTotal: 0,
      renewalCount: 0,
      lifetime: false,
      maxDevices: 1,
      startMode: "first_activation",
      status: licenseStatus,
      activatedAt,
      expiresAt,
      source: "admin",
      externalOrderId: "",
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-10T12:00:00.000Z"
    }
  };

  if (withDevice) {
    initial[`projects/${PROJECT_ID}/devices/${deviceHash}`] = {
      licenseId: LICENSE_ID,
      customerId: CUSTOMER_ID,
      deviceHash,
      name: "PC A14.5",
      platform: "Windows",
      appVersion: "1.0.0",
      active: true,
      firstActivatedAt: activatedAt,
      lastSeenAt: "2026-10-10T12:30:00.000Z",
      lastValidatedAt: "2026-10-10T12:30:00.000Z",
      validationCount: 4,
      validationRequestIds: ["req-before-a145"],
      deactivatedAt: null,
      updatedAt: "2026-10-10T12:30:00.000Z"
    };
  }

  const services = memoryServices(initial);
  const env = {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "uid-master-a145",
    __services: services
  };
  return { services, env, deviceHash, activatedAt, expiresAt };
}

function publicRequest(action, deviceId, requestId, appVersion = "2.0.0") {
  return new Request(`https://licencas.guiasys.online/api/v1/license/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      licenseKey: LICENSE_KEY,
      deviceId,
      deviceName: "PC Auditoria",
      platform: "Windows",
      appVersion,
      requestId
    })
  });
}

function adminRequest(path, method, body) {
  return new Request(`https://painel.licencas.guiasys.online${path}`, {
    method,
    headers: {
      Authorization: "Bearer test-a145",
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const storedAt = (services, collection, id) => services.store.get(`projects/${PROJECT_ID}/${collection}/${id}`);
const collectionSize = (services, collection) => [...services.store.keys()].filter(path => path.startsWith(`projects/${PROJECT_ID}/${collection}/`)).length;

async function patchCustomerStatus(env, status) {
  return await handleRequest(
    adminRequest(`/api/v1/admin/projects/${PROJECT_ID}/customers/${CUSTOMER_ID}`, "PATCH", { status }),
    env
  );
}

test("cliente inativo bloqueia validate sem entitlement, contador, lastSeen ou revalidate", async () => {
  const { services, env, deviceHash, activatedAt, expiresAt } = await fixture();

  const activeResponse = await handleRequest(publicRequest("validate", DEVICE_ID, "req-active-a145", "1.1.0"), env);
  assert.equal(activeResponse.status, 200);
  const activeBody = await activeResponse.json();
  assert.equal(activeBody.license.valid, true);
  assert.ok(activeBody.license.entitlement?.token);

  const activeLicense = clone(storedAt(services, "licenses", LICENSE_ID));
  const activeDevice = clone(storedAt(services, "devices", deviceHash));
  const inactivePatch = await patchCustomerStatus(env, "inactive");
  assert.equal(inactivePatch.status, 200);
  assert.equal((await inactivePatch.json()).item.status, "inactive");
  assert.deepEqual(storedAt(services, "licenses", LICENSE_ID), activeLicense, "PATCH do cliente não altera a licença");

  const activationsBefore = collectionSize(services, "activations");
  const logsBefore = collectionSize(services, "logs");
  const blocked = await handleRequest(publicRequest("validate", DEVICE_ID, "req-blocked-a145", "9.9.9"), env);
  assert.equal(blocked.status, 403);
  const blockedBody = await blocked.json();
  assert.deepEqual(Object.keys(blockedBody).sort(), ["error", "message", "ok"]);
  assert.equal(blockedBody.ok, false);
  assert.equal(blockedBody.error, "customer_inactive");
  assert.equal(blockedBody.message, "Cliente inativo. Esta licença está temporariamente indisponível.");
  assert.equal("entitlement" in blockedBody, false);
  assert.equal("license" in blockedBody, false);
  assert.deepEqual(storedAt(services, "devices", deviceHash), activeDevice);
  assert.deepEqual(storedAt(services, "licenses", LICENSE_ID), activeLicense);
  assert.equal(collectionSize(services, "activations"), activationsBefore);
  assert.equal(collectionSize(services, "logs"), logsBefore);

  const activePatch = await patchCustomerStatus(env, "active");
  assert.equal(activePatch.status, 200);
  assert.equal((await activePatch.json()).item.status, "active");
  const reactivated = await handleRequest(publicRequest("validate", DEVICE_ID, "req-reactivated-a145", "1.2.0"), env);
  assert.equal(reactivated.status, 200);
  const reactivatedBody = await reactivated.json();
  assert.equal(reactivatedBody.license.valid, true);
  assert.ok(reactivatedBody.license.entitlement?.token);

  const preserved = storedAt(services, "licenses", LICENSE_ID);
  assert.equal(preserved.activatedAt, activatedAt);
  assert.equal(preserved.expiresAt, expiresAt);
  assert.equal(preserved.durationDays, 9);
  assert.equal(preserved.maxDevices, 1);
  assert.equal(preserved.renewalCount, 0);
  assert.equal(preserved.renewalDaysTotal, 0);
  assert.equal(storedAt(services, "devices", deviceHash).licenseId, LICENSE_ID);
  assert.equal(storedAt(services, "devices", deviceHash).validationCount, activeDevice.validationCount + 1);
});

test("cliente inativo bloqueia first activation sem iniciar prazo ou criar documentos", async () => {
  const { services, env, deviceHash } = await fixture({ customerStatus: "inactive", licenseStatus: "pending", withDevice: false });
  const licenseBefore = clone(storedAt(services, "licenses", LICENSE_ID));

  const response = await handleRequest(publicRequest("activate", DEVICE_ID, "req-pending-blocked-a145"), env);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "customer_inactive");
  assert.equal("entitlement" in body, false);
  assert.deepEqual(storedAt(services, "licenses", LICENSE_ID), licenseBefore);
  assert.equal(storedAt(services, "licenses", LICENSE_ID).status, "pending");
  assert.equal(storedAt(services, "licenses", LICENSE_ID).activatedAt, null);
  assert.equal(storedAt(services, "licenses", LICENSE_ID).expiresAt, null);
  assert.equal(services.store.has(`projects/${PROJECT_ID}/devices/${deviceHash}`), false);
  assert.equal(collectionSize(services, "activations"), 0);
  assert.equal(collectionSize(services, "logs"), 0);
});

test("activate bloqueia cliente inativo com device existente ou novo, mas deactivate continua permitido", async () => {
  const { services, env, deviceHash } = await fixture({ customerStatus: "inactive" });
  const licenseBefore = clone(storedAt(services, "licenses", LICENSE_ID));
  const deviceBefore = clone(storedAt(services, "devices", deviceHash));

  for (const [deviceId, requestId] of [[DEVICE_ID, "req-same-device-a145"], ["DEVICE-A145-NEW", "req-new-device-a145"]]) {
    const response = await handleRequest(publicRequest("activate", deviceId, requestId), env);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "customer_inactive");
    assert.equal("entitlement" in body, false);
  }

  assert.deepEqual(storedAt(services, "licenses", LICENSE_ID), licenseBefore);
  assert.deepEqual(storedAt(services, "devices", deviceHash), deviceBefore);
  assert.equal(services.store.has(`projects/${PROJECT_ID}/devices/${sha256("DEVICE-A145-NEW")}`), false);
  assert.equal(collectionSize(services, "activations"), 0);

  const deactivate = await handleRequest(publicRequest("deactivate", DEVICE_ID, "req-deactivate-a145"), env);
  assert.equal(deactivate.status, 200);
  const deactivateBody = await deactivate.json();
  assert.equal(deactivateBody.result.deactivated, true);
  assert.equal("entitlement" in deactivateBody.result, false);
  assert.equal(storedAt(services, "devices", deviceHash).active, false);
  assert.deepEqual(storedAt(services, "licenses", LICENSE_ID), licenseBefore);
  assert.equal(collectionSize(services, "activations"), 1);
});

test("emissão administrativa para cliente inativo continua bloqueada", async () => {
  const { services, env } = await fixture({ customerStatus: "inactive" });
  const licensesBefore = collectionSize(services, "licenses");
  const response = await handleRequest(
    adminRequest(`/api/v1/admin/projects/${PROJECT_ID}/licenses`, "POST", {
      customerId: CUSTOMER_ID,
      planName: "Nova licença bloqueada",
      durationDays: 30,
      lifetime: false,
      maxDevices: 1,
      startMode: "first_activation"
    }),
    env
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "customer_inactive");
  assert.equal(collectionSize(services, "licenses"), licensesBefore);
});
