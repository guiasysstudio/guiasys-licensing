import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticatedRateLimitSubject,
  publicRateLimitSubject
} from "../src/rate-limit-subject.js";
import { rateLimitIngressPeer } from "../src/rate-limit-identity.js";
import { handleRequest } from "../src/index.js";

const PROJECT_ID = "prj_0123456789abcdefabcd";

function memoryServices() {
  const store = new Map();
  const read = path => {
    const data = store.get(path);
    return data ? { id: path.split("/").at(-1), ...structuredClone(data) } : null;
  };
  return {
    runtime: "firebase-functions-v2",
    store,
    async getDoc(path) { return read(path); },
    async listCollection() { return []; },
    async verifyIdToken(token) {
      const now = Math.floor(Date.now() / 1000);
      return {
        aud: "guiasys-licensing", iss: "https://securetoken.google.com/guiasys-licensing",
        sub: token, exp: now + 3600, iat: now - 20, auth_time: now - 20,
        email: `${token}@example.com`, email_verified: true,
        firebase: { sign_in_provider: "password" }
      };
    },
    async getAccountState(uid) {
      return { localId: uid, email: `${uid}@example.com`, emailVerified: true, disabled: false, validSince: "0" };
    },
    atomicClient() {
      return {
        async runTransaction(callback) {
          const writes = [];
          const tx = {
            async get(path) { return read(path); },
            async queryByField() { return []; },
            set(path, data) { writes.push(["set", path, structuredClone(data)]); },
            create(path, data) { writes.push(["create", path, structuredClone(data)]); },
            delete(path) { writes.push(["delete", path]); }
          };
          const result = await callback(tx);
          for (const [kind, path, data] of writes) {
            if (kind === "delete") store.delete(path);
            else store.set(path, data);
          }
          return result;
        }
      };
    },
    log() {}
  };
}

function env(services) {
  return { FIREBASE_PROJECT_ID: "guiasys-licensing", __services: services };
}

function limitDocs(store, bucket) {
  return [...store.entries()].filter(([key, val]) =>
    key.startsWith("rateLimits/") && val.bucket === bucket).map(([, val]) => val);
}

function trialRequest(deviceId, forwarded = "198.51.100.2, 192.0.2.33") {
  return new Request("https://licencas.guiasys.online/api/v1/trial/start", {
    method: "POST", headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwarded,
      "cf-connecting-ip": "198.51.100.155"
    },
    body: JSON.stringify({ projectId: PROJECT_ID, deviceId })
  });
}

test("INT-08.2: UID para quotas autenticadas não vem do corpo ou headers", () => {
  assert.equal(authenticatedRateLimitSubject({ uid: "uid-A" }), '["firebase-uid","uid-A"]');
  assert.equal(authenticatedRateLimitSubject({}), null);
  assert.equal(authenticatedRateLimitSubject({ uid: 123 }), null);
  assert.notEqual(authenticatedRateLimitSubject({ uid: "uid-A" }),
    authenticatedRateLimitSubject({ uid: "uid-B" }));
});

test("INT-08.2: recurso de trial ou licença é separado por dispositivo sem depender do CDN", () => {
  const a = { projectId: PROJECT_ID, deviceId: "stable-A", licenseKey: "GSS-AAA-BBB" };
  const b = { ...a, deviceId: "stable-B" };
  assert.notEqual(publicRateLimitSubject(a, "trial"), publicRateLimitSubject(b, "trial"));
  assert.notEqual(publicRateLimitSubject(a, "license"), publicRateLimitSubject(b, "license"));
  assert.equal(publicRateLimitSubject({ ...a, licenseKey: "" }, "license"), null);
  assert.equal(publicRateLimitSubject({ ...a, deviceId: "" }, "trial"), null);
  assert.equal(publicRateLimitSubject({ ...a, projectId: undefined }, "trial"), null);
  assert.equal(publicRateLimitSubject({ ...a, deviceId: "X".repeat(257) }, "trial"), null);
  assert.equal(publicRateLimitSubject(a, "unknown"), null);
});

test("INT-08.2: prefixo XFF e CF forjados não alteram o teto de ingress", () => {
  const h1 = new Headers({ "x-forwarded-for": "198.51.100.45,192.0.2.33" });
  const h2 = new Headers({
    "x-forwarded-for": "192.0.2.99, 198.51.100.9, 192.0.2.33",
    "cf-connecting-ip": "2001:db8::44"
  });
  assert.equal(rateLimitIngressPeer(h1), rateLimitIngressPeer(h2));
  assert.equal(rateLimitIngressPeer(h2), "192.0.2.33");
});

test("INT-08.2: clientes diferentes atrás do mesmo proxy não consomem quota fina do trial", async () => {
  const services = memoryServices();
  const e = env(services);
  const a = await handleRequest(trialRequest("device-A"), e);
  const b = await handleRequest(trialRequest("device-B", "forged, 192.0.2.33"), e);
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.equal(limitDocs(services.store, "trial-start-ingress-ceiling").length, 1);
  assert.equal(limitDocs(services.store, "trial-start-ingress-ceiling")[0].count, 2);
  assert.equal(limitDocs(services.store, "trial-start-burst").length, 2);
  assert.ok(limitDocs(services.store, "trial-start-burst").every(row => row.count === 1));
});

test("INT-08.2: 429 do trial é por recurso, não bloqueia outro dispositivo com mesmo proxy", async () => {
  const services = memoryServices();
  const e = env(services);
  for (let i = 0; i < 10; i++) {
    const response = await handleRequest(trialRequest("device-A",
      `198.51.100.${i + 20}, 192.0.2.33`), e);
    assert.equal(response.status, 404);
  }
  const blocked = await handleRequest(trialRequest("device-A"), e);
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error, "rate_limited");
  assert.ok(body.details.retryAfterSeconds >= 1);
  const independent = await handleRequest(trialRequest("device-B"), e);
  assert.equal(independent.status, 404);
});

test("INT-08.2: duas contas verificadas usam quotas próprias atrás do mesmo proxy", async () => {
  const services = memoryServices();
  const e = env(services);
  for (const uid of ["uid-A", "uid-B"]) {
    const response = await handleRequest(new Request(
      "https://licencas.guiasys.online/api/v1/customer/me", {
        headers: {
          authorization: `Bearer ${uid}`,
          "x-forwarded-for": "198.51.100.77, 192.0.2.33"
        }
      }
    ), e);
    assert.equal(response.status, 200, uid + ": " + await response.text());
  }
  const scoped = limitDocs(services.store, "customer-api");
  assert.equal(scoped.length, 2);
  assert.ok(scoped.every(row => row.count === 1));
  assert.equal(limitDocs(services.store, "customer-api-ingress-ceiling").length, 1);
  assert.equal(limitDocs(services.store, "customer-api-ingress-ceiling")[0].count, 2);
});


test("INT-08.2: contadores de rate limit têm TTL Firestore tipado e sem indexação", async () => {
  const { readFile } = await import("node:fs/promises");
  const indexes = JSON.parse(await readFile(
    new URL("../../firestore.indexes.json", import.meta.url), "utf8"
  ));
  const policy = indexes.fieldOverrides.find(item =>
    item.collectionGroup === "rateLimits" && item.fieldPath === "expireAt"
  );
  assert.deepEqual(policy, {
    collectionGroup: "rateLimits", fieldPath: "expireAt", ttl: true, indexes: []
  });

  const services = memoryServices();
  await handleRequest(trialRequest("ttl-device"), env(services));
  const docs = [...services.store.entries()]
    .filter(([key]) => key.startsWith("rateLimits/"))
    .map(([, val]) => val);
  assert.ok(docs.length >= 2);
  assert.ok(docs.every(doc => doc.expireAt instanceof Date));
  assert.ok(docs.every(doc => doc.expireAt.getTime() > Date.now() + 48 * 3600000));
  assert.ok(docs.every(doc => Object.keys(doc).every(key =>
    !["licenseKey", "deviceId", "firebaseUid"].includes(key))));
});


test("INT-08.2: licença por dispositivo tem quota independente atrás do mesmo CDN", async () => {
  const services = memoryServices();
  const e = env(services);
  function request(deviceId, spoof) {
    return new Request("https://licencas.guiasys.online/api/v1/license/activate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `${spoof}, 192.0.2.33`
      },
      body: JSON.stringify({
        projectId: PROJECT_ID, deviceId, licenseKey: "GSS-ABCDE-FGHIJ-KLMNO-PQRST"
      })
    });
  }
  const a = await handleRequest(request("DEVICE-A", "198.51.100.5"), e);
  const b = await handleRequest(request("DEVICE-B", "198.51.100.6"), e);
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.equal(limitDocs(services.store, "license-activate").length, 2);
  assert.equal(limitDocs(services.store, "license-activate-ingress-ceiling").length, 1);
});

test("INT-08.2: lookup CEP é limitado pelo UID verificado, não pela origem compartilhada", async () => {
  const services = memoryServices();
  const e = env(services);
  async function badCep(uid) {
    return handleRequest(new Request(
      "https://licencas.guiasys.online/api/v1/customer/address/cep", {
        method: "POST",
        headers: {
          authorization: `Bearer ${uid}`,
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.1, 192.0.2.33"
        },
        body: JSON.stringify({ postalCode: "INVALIDO" })
      }), e);
  }
  for (let i = 0; i < 30; i++) {
    const r = await badCep("uid-cep-A");
    assert.equal(r.status, 400);
  }
  const blocked = await badCep("uid-cep-A");
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, "rate_limited");
  const other = await badCep("uid-cep-B");
  assert.equal(other.status, 400);
  assert.equal(limitDocs(services.store, "cep-lookup").length, 2);
});
