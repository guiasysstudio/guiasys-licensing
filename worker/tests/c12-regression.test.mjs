import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { handleRequest } from "../src/index.js";

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
  assert.equal(
    services.store.get(`projects/${PROJECT_ID}/licenses/${LICENSE_ID}`).status,
    "suspended"
  );
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
