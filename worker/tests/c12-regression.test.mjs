import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { handleRequest } from "../src/index.js";
import { verifyEntitlementToken } from "../../assets/js/entitlement-verifier.js";

const PROJECT_ID = "prj_0123456789abcdefabcd";
const PLAN_ID = "plan_0123456789abcdefabcd";
const LICENSE_ID = "lic_0123456789abcdefabcd";
const LICENSE_KEY = "GSS-ABCDE-FGHIJ-KLMNO-PQRST";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function docId(path) {
  return String(path).split("/").pop();
}

function memoryServices(initial = {}) {
  const store = new Map(
    Object.entries(initial).map(([path, value]) => [path, clone(value)])
  );

  function read(path) {
    const value = store.get(path);
    if (value == null) return null;
    return { id: docId(path), ...clone(value) };
  }

  return {
    store,

    runtime: "firebase-functions-v2",

    async verifyIdToken() {
      throw new Error("verifyIdToken não configurado para este teste.");
    },

    async getAccountState() {
      return null;
    },

    async getDoc(path) {
      return read(path);
    },

    async setDoc(path, value) {
      store.set(path, clone(value));
      return { id: docId(path), ...clone(value) };
    },

    async deleteDoc(path) {
      store.delete(path);
    },

    async listCollection(path) {
      const prefix = `${path}/`;
      const result = [];
      for (const [key, value] of store.entries()) {
        if (!key.startsWith(prefix)) continue;
        const tail = key.slice(prefix.length);
        if (!tail || tail.includes("/")) continue;
        result.push({ id: docId(key), ...clone(value) });
      }
      return result;
    },

    atomicClient() {
      return {
        async runTransaction(operation) {
          const writes = [];
          const tx = {
            async get(path) {
              return read(path);
            },
            async queryByField(parentPath, collectionId, fieldPath, value) {
              const prefix = `${parentPath}/${collectionId}/`;
              const result = [];
              for (const [key, item] of store.entries()) {
                if (!key.startsWith(prefix)) continue;
                const tail = key.slice(prefix.length);
                if (!tail || tail.includes("/")) continue;
                if (item?.[fieldPath] === value) {
                  result.push({ id: docId(key), ...clone(item) });
                }
              }
              return result;
            },
            set(path, value) {
              writes.push({ type: "set", path, value: clone(value) });
            },
            create(path, value) {
              if (store.has(path) || writes.some(write => write.path === path && write.type !== "delete")) {
                throw Object.assign(new Error("Documento já existe."), {
                  status: 409,
                  reason: "concurrency_conflict"
                });
              }
              writes.push({ type: "create", path, value: clone(value) });
            },
            delete(path) {
              writes.push({ type: "delete", path });
            }
          };

          const result = await operation(tx);
          for (const write of writes) {
            if (write.type === "delete") store.delete(write.path);
            else store.set(write.path, clone(write.value));
          }
          return result;
        }
      };
    },

    log() {}
  };
}

function firebaseToken({
  uid = "uid-master-test",
  email = "master@example.com",
  provider = "google.com"
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: "guiasys-licensing",
    iss: "https://securetoken.google.com/guiasys-licensing",
    sub: uid,
    exp: now + 3600,
    iat: now - 60,
    auth_time: now - 60,
    email,
    email_verified: true,
    firebase: { sign_in_provider: provider }
  };
}

function authenticatedEnv(services, token = firebaseToken(), adminUid = token.sub) {
  services.verifyIdToken = async () => clone(token);
  services.getAccountState = async uid => ({
    localId: uid,
    email: token.email,
    displayName: "Administrador",
    photoUrl: null,
    emailVerified: true,
    disabled: false,
    validSince: "0"
  });

  return {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: adminUid,
    __services: services
  };
}

function jsonRequest(path, method, body, token = "test-token") {
  return new Request(`https://painel.licencas.guiasys.online${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

test("validação preserva suspensão mesmo depois do expiresAt", async () => {
  const licenseLookup = sha256(LICENSE_KEY);
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      prefix: "GSS",
      status: "active",
      integrationCode: "GSLI-ABCD-EFGH-JKLM",
      allowedOrigins: []
    },
    [`projects/${PROJECT_ID}/licenseKeys/${licenseLookup}`]: {
      licenseId: LICENSE_ID
    },
    [`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`]: {
      key: LICENSE_KEY,
      customerId: "cus_0123456789abcdefabcd",
      customerName: "Cliente",
      customerEmail: "cliente@example.com",
      planName: "Mensal",
      durationDays: 30,
      renewalDaysTotal: 0,
      renewalCount: 0,
      lifetime: false,
      maxDevices: 1,
      startMode: "immediate",
      status: "suspended",
      activatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-31T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z"
    }
  });

  const response = await handleRequest(
    new Request("https://painel.licencas.guiasys.online/api/v1/license/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        licenseKey: LICENSE_KEY,
        deviceId: "DEVICE-C12-SUSPENDED"
      })
    }),
    {
      FIREBASE_PROJECT_ID: "guiasys-licensing",
      ADMIN_FIREBASE_UID: "uid-master-test",
      __services: services
    }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "suspended");
  assert.equal(body.message, "Licença suspensa.");
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`).status,
    "suspended"
  );
});

test("validação pública traduz os estados revoked e pending", async () => {
  const licenseLookup = sha256(LICENSE_KEY);

  for (const [status, message] of [
    ["revoked", "Licença revogada."],
    ["pending", "Licença pendente."]
  ]) {
    const services = memoryServices({
      [`projects/${PROJECT_ID}`]: {
        name: "Projeto Teste",
        prefix: "GSS",
        status: "active",
        integrationCode: "GSLI-ABCD-EFGH-JKLM",
        allowedOrigins: []
      },
      [`projects/${PROJECT_ID}/licenseKeys/${licenseLookup}`]: {
        licenseId: LICENSE_ID
      },
      [`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`]: {
        key: LICENSE_KEY,
        customerId: "cus_0123456789abcdefabcd",
        customerName: "Cliente",
        customerEmail: "cliente@example.com",
        planName: "Mensal",
        durationDays: 30,
        lifetime: false,
        maxDevices: 1,
        startMode: "first_activation",
        status,
        activatedAt: null,
        expiresAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    });

    const response = await handleRequest(
      new Request("https://painel.licencas.guiasys.online/api/v1/license/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_ID,
          licenseKey: LICENSE_KEY,
          deviceId: `DEVICE-C15-${status.toUpperCase()}`
        })
      }),
      {
        FIREBASE_PROJECT_ID: "guiasys-licensing",
        ADMIN_FIREBASE_UID: "uid-master-test",
        __services: services
      }
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, status);
    assert.equal(body.message, message);
  }
});

test("plano vitalício não pode virar temporário sem duração válida", async () => {
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      status: "active"
    },
    [`projects/${PROJECT_ID}/plans/${PLAN_ID}`]: {
      name: "Vitalício",
      price: 100,
      durationDays: 0,
      lifetime: true,
      deviceLimit: 1,
      startMode: "first_activation",
      active: true,
      publicCatalog: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  });
  const env = authenticatedEnv(services);

  const response = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}/plans/${PLAN_ID}`,
      "PATCH",
      { lifetime: false }
    ),
    env
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "invalid_plan_duration");
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}/plans/${PLAN_ID}`).lifetime,
    true
  );
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}/plans/${PLAN_ID}`).durationDays,
    0
  );
});

test("manageProjects restaura projeto arquivado sem conceder edição de configurações", async () => {
  const uid = "uid-lifecycle-admin";
  const email = "lifecycle@example.com";
  const adminId = sha256(email);
  const uidLookupId = sha256(uid);

  const initialProject = {
    name: "Projeto Arquivado",
    slug: "projeto-arquivado",
    prefix: "PRA",
    description: "",
    status: "archived",
    publicCatalog: false,
    allowedOrigins: [],
    trialEnabled: false,
    trialDays: 0,
    trialValidationHours: 24,
    trialOfflineHours: 24,
    offlineDays: 7,
    validationHours: 24,
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    signingKeyId: null,
    signingAlgorithm: "ES256",
    signingPublicJwk: null,
    archivedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2025-12-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const services = memoryServices({
    [`adminUids/${uidLookupId}`]: { adminId },
    [`admins/${adminId}`]: {
      name: "Lifecycle",
      email,
      status: "active",
      allProjects: true,
      projectIds: [],
      permissions: {
        manageProjects: true,
        manageProjectSettings: false
      },
      firebaseUid: uid,
      identityBoundAt: "2026-01-01T00:00:00.000Z"
    },
    [`projects/${PROJECT_ID}`]: initialProject
  });

  const token = firebaseToken({ uid, email });
  const env = authenticatedEnv(services, token, "different-master-uid");

  const restore = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}`,
      "PATCH",
      { status: "active" }
    ),
    env
  );

  assert.equal(restore.status, 200);
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}`).status,
    "active"
  );
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}`).archivedAt,
    null
  );

  const forbiddenEdit = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}`,
      "PATCH",
      { name: "Nome indevido" }
    ),
    env
  );

  assert.equal(forbiddenEdit.status, 403);
  const forbiddenBody = await forbiddenEdit.json();
  assert.equal(forbiddenBody.error, "permission_denied");
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}`).name,
    "Projeto Arquivado"
  );
});


test("trial não reinicia em dispositivo que já foi vinculado a licença paga", async () => {
  const deviceId = "DEVICE-C12-PAID-FIRST";
  const deviceHash = sha256(deviceId);
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  const started = new Date(Date.now() - 86400000).toISOString();

  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      prefix: "GSS",
      status: "active",
      integrationCode: "GSLI-ABCD-EFGH-JKLM",
      allowedOrigins: [],
      trialEnabled: true,
      trialDays: 7,
      trialValidationHours: 24,
      trialOfflineHours: 24,
      offlineDays: 7,
      validationHours: 24
    },
    [`projects/${PROJECT_ID}/devices/${deviceHash}`]: {
      licenseId: LICENSE_ID,
      active: false,
      deviceHash,
      updatedAt: started
    },
    [`projects/${PROJECT_ID}/trials/${deviceHash}`]: {
      deviceHash,
      status: "active",
      startedAt: started,
      expiresAt: future,
      durationDays: 7,
      validationHours: 24,
      offlineHours: 24,
      validationCount: 0,
      createdAt: started,
      updatedAt: started
    }
  });

  const response = await handleRequest(
    new Request("https://painel.licencas.guiasys.online/api/v1/trial/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        deviceId
      })
    }),
    {
      FIREBASE_PROJECT_ID: "guiasys-licensing",
      ADMIN_FIREBASE_UID: "uid-master-test",
      __services: services
    }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "trial_converted");
  assert.equal(body.details.licenseId, LICENSE_ID);

  const trial = services.store.get(`projects/${PROJECT_ID}/trials/${deviceHash}`);
  assert.equal(trial.status, "converted");
  assert.equal(trial.convertedLicenseId, LICENSE_ID);
  assert.ok(trial.convertedAt);
});


test("plano temporário rejeita duração zero na criação", async () => {
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      status: "active"
    }
  });
  const env = authenticatedEnv(services);

  const response = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}/plans`,
      "POST",
      {
        name: "Plano inválido",
        durationDays: 0,
        lifetime: false,
        deviceLimit: 1
      }
    ),
    env
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "invalid_plan_duration");

  const createdPlans = [...services.store.keys()]
    .filter(path => path.startsWith(`projects/${PROJECT_ID}/plans/`));
  assert.equal(createdPlans.length, 0);
});

test("emissão personalizada temporária não converte duração zero em fallback", async () => {
  const customerId = "cus_0123456789abcdefabcd";
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      prefix: "GSS",
      status: "active"
    },
    [`projects/${PROJECT_ID}/customers/${customerId}`]: {
      name: "Cliente",
      email: "cliente@example.com",
      status: "active"
    }
  });
  const env = authenticatedEnv(services);

  const response = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}/licenses`,
      "POST",
      {
        customerId,
        planName: "Temporária inválida",
        lifetime: false,
        durationDays: 0,
        maxDevices: 1,
        startMode: "first_activation"
      }
    ),
    env
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_request");
  assert.equal(
    [...services.store.keys()].filter(path => path.startsWith(`projects/${PROJECT_ID}/licenses/`)).length,
    0
  );
});


test("origem web não autorizada é recusada antes de qualquer migração do projeto", async () => {
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto legado",
      prefix: "GSS",
      status: "active",
      allowedOrigins: ["https://permitido.example"]
    }
  });

  const response = await handleRequest(
    new Request("https://painel.licencas.guiasys.online/api/v1/project/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://nao-autorizado.example"
      },
      body: JSON.stringify({ projectId: PROJECT_ID })
    }),
    {
      FIREBASE_PROJECT_ID: "guiasys-licensing",
      ADMIN_FIREBASE_UID: "uid-master-test",
      __services: services
    }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "origin_not_allowed");

  const project = services.store.get(`projects/${PROJECT_ID}`);
  assert.equal(project.integrationCode, undefined);
  assert.equal(
    services.store.has(`projects/${PROJECT_ID}/internal/signing`),
    false
  );
});


async function signingFixture() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const keyId = "sig_c12regression";
  const createdAt = new Date().toISOString();

  return {
    keyId,
    algorithm: "ES256",
    privateJwk,
    publicJwk,
    createdAt,
    updatedAt: createdAt
  };
}

test("plano vitalício emite licença pendente e ativa sem expiração", async () => {
  const signing = await signingFixture();
  const customerId = "cus_0123456789abcdefabcd";
  const project = {
    name: "Projeto Teste",
    slug: "projeto-teste",
    prefix: "GSS",
    status: "active",
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    publicCatalog: false,
    allowedOrigins: [],
    offlineDays: 7,
    validationHours: 24,
    signingKeyId: signing.keyId,
    signingAlgorithm: "ES256",
    signingPublicJwk: signing.publicJwk,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: project,
    [`projects/${PROJECT_ID}/internal/signing`]: signing,
    [`projects/${PROJECT_ID}/plans/${PLAN_ID}`]: {
      name: "Plano Auditoria Vitalício",
      durationDays: 0,
      lifetime: true,
      deviceLimit: 3,
      startMode: "first_activation",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    [`projects/${PROJECT_ID}/customers/${customerId}`]: {
      name: "Cliente Vitalício",
      email: "vitalicio@example.com",
      status: "active"
    }
  });
  const env = authenticatedEnv(services);

  const issueResponse = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}/licenses`,
      "POST",
      {
        customerId,
        planId: PLAN_ID,
        planName: "Plano Auditoria Vitalício",
        lifetime: true,
        durationDays: 0,
        maxDevices: 3,
        startMode: "first_activation"
      }
    ),
    env
  );

  assert.equal(issueResponse.status, 201);
  const issued = (await issueResponse.json()).license;
  assert.equal(issued.status, "pending");
  assert.equal(issued.lifetime, true);
  assert.equal(issued.durationDays, 0);
  assert.equal(issued.expiresAt, null);
  assert.equal(issued.activatedAt, null);
  assert.equal(issued.maxDevices, 3);

  const activateResponse = await handleRequest(
    new Request("https://painel.licencas.guiasys.online/api/v1/license/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        licenseKey: issued.key,
        deviceId: "DEVICE-C15-LIFETIME",
        requestId: "req-c15-lifetime-activate"
      })
    }),
    env
  );

  assert.equal(activateResponse.status, 200);
  const activated = (await activateResponse.json()).license;
  assert.equal(activated.status, "active");
  assert.equal(activated.lifetime, true);
  assert.equal(activated.durationDays, 0);
  assert.equal(activated.totalTermDays, 0);
  assert.equal(activated.expiresAt, null);
  assert.ok(activated.activatedAt);
  assert.equal(activated.maxDevices, 3);

  const stored = services.store.get(`projects/${PROJECT_ID}/licenses/${issued.id}`);
  assert.equal(stored.status, "active");
  assert.equal(stored.lifetime, true);
  assert.equal(stored.durationDays, 0);
  assert.equal(stored.expiresAt, null);
});

test("fluxo público ativa, valida idempotência, aplica limite, desativa e verifica entitlement", async () => {
  const signing = await signingFixture();
  const licenseLookup = sha256(LICENSE_KEY);
  const deviceId = "DEVICE-C12-LICENSE-01";
  const deviceHash = sha256(deviceId);

  const project = {
    name: "Projeto Teste",
    slug: "projeto-teste",
    prefix: "GSS",
    status: "active",
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    publicCatalog: false,
    allowedOrigins: [],
    trialEnabled: true,
    trialDays: 7,
    trialValidationHours: 24,
    trialOfflineHours: 24,
    offlineDays: 7,
    validationHours: 24,
    signingKeyId: signing.keyId,
    signingAlgorithm: "ES256",
    signingPublicJwk: signing.publicJwk,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: project,
    [`projects/${PROJECT_ID}/internal/signing`]: signing,
    [`projects/${PROJECT_ID}/licenseKeys/${licenseLookup}`]: {
      licenseId: LICENSE_ID
    },
    [`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`]: {
      key: LICENSE_KEY,
      customerId: "cus_0123456789abcdefabcd",
      customerName: "Cliente",
      customerEmail: "cliente@example.com",
      planId: "",
      planName: "Mensal",
      durationDays: 30,
      renewalDaysTotal: 0,
      renewalCount: 0,
      lifetime: false,
      maxDevices: 1,
      startMode: "first_activation",
      status: "pending",
      activatedAt: null,
      expiresAt: null,
      source: "admin",
      externalOrderId: "",
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    }
  });

  const env = {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "uid-master-test",
    __services: services
  };

  const publicRequest = (path, body) => new Request(
    `https://painel.licencas.guiasys.online${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        licenseKey: LICENSE_KEY,
        ...body
      })
    }
  );

  const activate = await handleRequest(
    publicRequest("/api/v1/license/activate", {
      deviceId,
      deviceName: "PC Principal",
      platform: "Windows",
      appVersion: "1.0.0",
      requestId: "req-c12-activate"
    }),
    env
  );

  assert.equal(activate.status, 200);
  const activatedBody = await activate.json();
  assert.equal(activatedBody.ok, true);
  assert.equal(activatedBody.license.status, "active");
  assert.equal(activatedBody.license.activationPerformed, true);
  assert.equal(activatedBody.license.activeDevices, 1);
  assert.ok(activatedBody.license.expiresAt);
  assert.ok(activatedBody.license.offlineUntil);
  assert.ok(activatedBody.license.entitlement?.token);

  const entitlementCheck = await verifyEntitlementToken(
    activatedBody.license.entitlement.token,
    signing.publicJwk,
    {
      protocolVersion: "GSL-v1",
      type: "license",
      projectId: PROJECT_ID,
      integrationCode: project.integrationCode,
      deviceHash,
      status: "active",
      keyId: signing.keyId
    }
  );
  assert.equal(entitlementCheck.valid, true);

  const secondDevice = await handleRequest(
    publicRequest("/api/v1/license/activate", {
      deviceId: "DEVICE-C12-LICENSE-02",
      requestId: "req-c12-second"
    }),
    env
  );
  assert.equal(secondDevice.status, 409);
  assert.equal((await secondDevice.json()).error, "device_limit");

  const firstValidation = await handleRequest(
    publicRequest("/api/v1/license/validate", {
      deviceId,
      appVersion: "1.0.1",
      requestId: "req-c12-validate"
    }),
    env
  );
  assert.equal(firstValidation.status, 200);
  const firstValidationBody = await firstValidation.json();
  assert.equal(firstValidationBody.license.validationCount, 1);
  assert.equal(firstValidationBody.license.revalidationReplay, false);

  const replayValidation = await handleRequest(
    publicRequest("/api/v1/license/validate", {
      deviceId,
      appVersion: "1.0.1",
      requestId: "req-c12-validate"
    }),
    env
  );
  assert.equal(replayValidation.status, 200);
  const replayBody = await replayValidation.json();
  assert.equal(replayBody.license.validationCount, 1);
  assert.equal(replayBody.license.revalidationReplay, true);

  const deactivate = await handleRequest(
    publicRequest("/api/v1/license/deactivate", {
      deviceId,
      requestId: "req-c12-deactivate"
    }),
    env
  );
  assert.equal(deactivate.status, 200);
  const deactivateBody = await deactivate.json();
  assert.equal(deactivateBody.result.deactivated, true);
  assert.equal(deactivateBody.result.alreadyInactive, false);

  const afterDeactivate = await handleRequest(
    publicRequest("/api/v1/license/validate", {
      deviceId,
      requestId: "req-c12-after-deactivate"
    }),
    env
  );
  assert.equal(afterDeactivate.status, 403);
  assert.equal((await afterDeactivate.json()).error, "device_not_authorized");

  assert.equal(
    services.store.get(`projects/${PROJECT_ID}/devices/${deviceHash}`).active,
    false
  );
});


test("fluxo de trial preserva período, revalida de forma idempotente e converte na licença paga", async () => {
  const signing = await signingFixture();
  const licenseLookup = sha256(LICENSE_KEY);
  const deviceId = "DEVICE-C12-TRIAL-01";
  const deviceHash = sha256(deviceId);

  const project = {
    name: "Projeto Trial",
    slug: "projeto-trial",
    prefix: "GSS",
    status: "active",
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    publicCatalog: false,
    allowedOrigins: [],
    trialEnabled: true,
    trialDays: 5,
    trialValidationHours: 12,
    trialOfflineHours: 6,
    offlineDays: 7,
    validationHours: 24,
    signingKeyId: signing.keyId,
    signingAlgorithm: "ES256",
    signingPublicJwk: signing.publicJwk,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: project,
    [`projects/${PROJECT_ID}/internal/signing`]: signing,
    [`projects/${PROJECT_ID}/licenseKeys/${licenseLookup}`]: {
      licenseId: LICENSE_ID
    },
    [`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`]: {
      key: LICENSE_KEY,
      customerId: "cus_0123456789abcdefabcd",
      customerName: "Cliente Trial",
      customerEmail: "trial@example.com",
      planId: "",
      planName: "Mensal",
      durationDays: 30,
      renewalDaysTotal: 0,
      renewalCount: 0,
      lifetime: false,
      maxDevices: 1,
      startMode: "first_activation",
      status: "pending",
      activatedAt: null,
      expiresAt: null,
      source: "admin",
      externalOrderId: "",
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    }
  });

  const env = {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "uid-master-test",
    __services: services
  };

  const trialRequest = (path, requestId) => new Request(
    `https://painel.licencas.guiasys.online${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        deviceId,
        deviceName: "PC Trial",
        platform: "Windows",
        appVersion: "1.0.0",
        requestId
      })
    }
  );

  const start = await handleRequest(
    trialRequest("/api/v1/trial/start", "req-c12-trial-start"),
    env
  );
  assert.equal(start.status, 200);
  const started = await start.json();
  assert.equal(started.trial.status, "active");
  assert.equal(started.trial.firstStart, true);
  assert.equal(started.trial.durationDays, 5);
  assert.equal(started.trial.validationHours, 12);
  assert.equal(started.trial.offlineHours, 6);
  const originalStartedAt = started.trial.startedAt;
  const originalExpiresAt = started.trial.expiresAt;

  const entitlementCheck = await verifyEntitlementToken(
    started.trial.entitlement.token,
    signing.publicJwk,
    {
      protocolVersion: "GSL-v1",
      type: "trial",
      projectId: PROJECT_ID,
      integrationCode: project.integrationCode,
      deviceHash,
      status: "active",
      keyId: signing.keyId
    }
  );
  assert.equal(entitlementCheck.valid, true);

  const startAgain = await handleRequest(
    trialRequest("/api/v1/trial/start", "req-c12-trial-start-again"),
    env
  );
  assert.equal(startAgain.status, 200);
  const repeated = await startAgain.json();
  assert.equal(repeated.trial.firstStart, false);
  assert.equal(repeated.trial.startedAt, originalStartedAt);
  assert.equal(repeated.trial.expiresAt, originalExpiresAt);

  const validate = await handleRequest(
    trialRequest("/api/v1/trial/validate", "req-c12-trial-validate"),
    env
  );
  assert.equal(validate.status, 200);
  const validated = await validate.json();
  assert.equal(validated.trial.validationCount, 1);
  assert.equal(validated.trial.revalidationReplay, false);

  const validateReplay = await handleRequest(
    trialRequest("/api/v1/trial/validate", "req-c12-trial-validate"),
    env
  );
  assert.equal(validateReplay.status, 200);
  const replayed = await validateReplay.json();
  assert.equal(replayed.trial.validationCount, 1);
  assert.equal(replayed.trial.revalidationReplay, true);

  const paidActivation = await handleRequest(
    new Request("https://painel.licencas.guiasys.online/api/v1/license/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        licenseKey: LICENSE_KEY,
        deviceId,
        deviceName: "PC Trial",
        platform: "Windows",
        appVersion: "1.0.1",
        requestId: "req-c12-paid-after-trial"
      })
    }),
    env
  );
  assert.equal(paidActivation.status, 200);

  const storedTrial = services.store.get(`projects/${PROJECT_ID}/trials/${deviceHash}`);
  assert.equal(storedTrial.status, "converted");
  assert.equal(storedTrial.convertedLicenseId, LICENSE_ID);

  const afterConversion = await handleRequest(
    trialRequest("/api/v1/trial/start", "req-c12-trial-after-paid"),
    env
  );
  assert.equal(afterConversion.status, 403);
  assert.equal((await afterConversion.json()).error, "trial_converted");
});


test("desativação administrativa também entra no histórico de ativações", async () => {
  const deviceHash = sha256("DEVICE-C12-ADMIN-DEACTIVATE");
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      status: "active"
    },
    [`projects/${PROJECT_ID}/devices/${deviceHash}`]: {
      licenseId: LICENSE_ID,
      customerId: "cus_0123456789abcdefabcd",
      deviceHash,
      active: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    }
  });
  const env = authenticatedEnv(services);

  const response = await handleRequest(
    jsonRequest(
      `/api/v1/admin/projects/${PROJECT_ID}/devices/${deviceHash}/deactivate`,
      "POST",
      {}
    ),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}/devices/${deviceHash}`).active,
    false
  );

  const activations = [...services.store.entries()]
    .filter(([path]) => path.startsWith(`projects/${PROJECT_ID}/activations/`))
    .map(([, value]) => value);

  assert.equal(activations.length, 1);
  assert.equal(activations[0].type, "deactivate");
  assert.equal(activations[0].source, "admin");
  assert.equal(activations[0].deviceHash, deviceHash);
});


test("emissão administrativa é idempotente para integrações de venda", async () => {
  const customerId = "cus_0123456789abcdefabcd";
  const services = memoryServices({
    [`projects/${PROJECT_ID}`]: {
      name: "Projeto Teste",
      prefix: "GSS",
      status: "active"
    },
    [`projects/${PROJECT_ID}/customers/${customerId}`]: {
      name: "Cliente",
      email: "cliente@example.com",
      status: "active"
    }
  });
  const env = authenticatedEnv(services);

  const path = `/api/v1/admin/projects/${PROJECT_ID}/licenses`;
  const payload = {
    customerId,
    planName: "Personalizada",
    durationDays: 30,
    maxDevices: 1,
    startMode: "first_activation",
    idempotencyKey: "order-c12-0001",
    source: "portal",
    externalOrderId: "pedido-0001"
  };

  const first = await handleRequest(jsonRequest(path, "POST", payload), env);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.license.idempotentReplay, false);

  const replay = await handleRequest(jsonRequest(path, "POST", payload), env);
  assert.equal(replay.status, 201);
  const replayBody = await replay.json();
  assert.equal(replayBody.license.idempotentReplay, true);
  assert.equal(replayBody.license.id, firstBody.license.id);
  assert.equal(replayBody.license.key, firstBody.license.key);

  const licensePaths = [...services.store.keys()]
    .filter(key => key.startsWith(`projects/${PROJECT_ID}/licenses/`));
  assert.equal(licensePaths.length, 1);

  const conflict = await handleRequest(
    jsonRequest(path, "POST", { ...payload, durationDays: 60 }),
    env
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "idempotency_conflict");
  assert.equal(
    [...services.store.keys()].filter(key => key.startsWith(`projects/${PROJECT_ID}/licenses/`)).length,
    1
  );
});
