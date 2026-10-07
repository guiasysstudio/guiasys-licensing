import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { handleRequest } from "../src/index.js";
import { validatePlanPayload, validateProjectPayload } from "../src/validation.js";

const PROJECT_A = "prj_aaaaaaaaaaaaaaaaaaaa";
const PROJECT_B = "prj_bbbbbbbbbbbbbbbbbbbb";
const PROJECT_HIDDEN = "prj_cccccccccccccccccccc";
const PROJECT_INACTIVE = "prj_dddddddddddddddddddd";

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
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  const read = path => {
    const value = store.get(path);
    return value == null ? null : { id: docId(path), ...clone(value) };
  };

  return {
    store,
    runtime: "firebase-functions-v2",
    async verifyIdToken() { throw new Error("Token não configurado."); },
    async getAccountState() { return null; },
    async getDoc(path) { return read(path); },
    async setDoc(path, value) {
      store.set(path, clone(value));
      return { id: docId(path), ...clone(value) };
    },
    async deleteDoc(path) { store.delete(path); },
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
            set(path, value) { writes.push({ type: "set", path, value: clone(value) }); },
            create(path, value) { writes.push({ type: "set", path, value: clone(value) }); },
            delete(path) { writes.push({ type: "delete", path }); }
          };
          const result = await operation(tx);
          for (const write of writes) {
            if (write.type === "delete") store.delete(write.path);
            else store.set(write.path, write.value);
          }
          return result;
        }
      };
    },
    log() {}
  };
}

function project(overrides = {}) {
  return {
    name: "Programa",
    slug: "programa",
    prefix: "PRG",
    description: "Descrição completa",
    shortDescription: "Descrição curta",
    imageUrl: "https://cdn.example.com/programa.png",
    status: "active",
    publicCatalog: true,
    featured: false,
    displayOrder: 0,
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    trialEnabled: true,
    trialDays: 14,
    signingPrivateJwk: { d: "nunca-vazar" },
    allowedOrigins: ["https://interno.example"],
    internalToken: "segredo",
    ...overrides
  };
}

function plan(overrides = {}) {
  return {
    name: "Mensal",
    description: "Oferta mensal",
    price: 29.9,
    durationDays: 30,
    lifetime: false,
    deviceLimit: 2,
    startMode: "first_activation",
    active: true,
    publicCatalog: true,
    displayOrder: 0,
    privateNote: "não publicar",
    ...overrides
  };
}

function envFor(services) {
  return { FIREBASE_PROJECT_ID: "guiasys-licensing", __services: services };
}

function firebaseToken(uid, email) {
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
    firebase: { sign_in_provider: "google.com" }
  };
}

function authenticatedEnv(services, uid, email) {
  const token = firebaseToken(uid, email);
  services.verifyIdToken = async () => clone(token);
  services.getAccountState = async () => ({
    localId: uid,
    email,
    emailVerified: true,
    disabled: false,
    validSince: "0"
  });
  return {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "outro-master",
    __services: services
  };
}

function adminRequest(path, method, body) {
  return new Request(`https://painel.licencas.guiasys.online${path}`, {
    method,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test("catálogo publica somente programas e planos elegíveis, ordenados e sanitizados", async () => {
  const services = memoryServices({
    [`projects/${PROJECT_A}`]: project({ name: "Zeta", displayOrder: 20, imageUrl: "javascript:alert(1)" }),
    [`projects/${PROJECT_B}`]: project({
      name: "Alfa",
      slug: "alfa",
      prefix: "ALF",
      displayOrder: 10,
      featured: true,
      integrationCode: "GSLI-BCDE-FGHJ-KLMN"
    }),
    [`projects/${PROJECT_HIDDEN}`]: project({ publicCatalog: false }),
    [`projects/${PROJECT_INACTIVE}`]: project({ status: "inactive" }),
    [`projects/${PROJECT_B}/plans/plan_zzzzzzzzzzzzzzzzzzzz`]: plan({ name: "Anual", price: 199.9, durationDays: 365, deviceLimit: 4, displayOrder: 20 }),
    [`projects/${PROJECT_B}/plans/plan_aaaaaaaaaaaaaaaaaaaa`]: plan({ name: "Vitalícia", price: 499, durationDays: 0, lifetime: true, deviceLimit: 5, displayOrder: 10 }),
    [`projects/${PROJECT_B}/plans/plan_hiddenhiddenhiddenhi`]: plan({ publicCatalog: false }),
    [`projects/${PROJECT_B}/plans/plan_inactiveinactivein`]: plan({ active: false }),
    [`projects/${PROJECT_A}/plans/plan_monthlymonthlymont`]: plan()
  });

  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/api/v1/catalog"),
    envFor(services)
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.catalog.protocolVersion, "GSL-v1");
  assert.deepEqual(body.catalog.projects.map(item => item.projectId), [PROJECT_B, PROJECT_A]);

  const alfa = body.catalog.projects[0];
  assert.equal(alfa.shortDescription, "Descrição curta");
  assert.equal(alfa.imageUrl, "https://cdn.example.com/programa.png");
  assert.equal(alfa.featured, true);
  assert.equal(body.catalog.projects[1].imageUrl, "");
  assert.deepEqual(alfa.plans.map(item => item.name), ["Vitalícia", "Anual"]);
  assert.deepEqual(alfa.plans[0], {
    id: "plan_aaaaaaaaaaaaaaaaaaaa",
    name: "Vitalícia",
    description: "Oferta mensal",
    commercialDescription: "Oferta mensal",
    termsVersion: "",
    price: 499,
    durationDays: 0,
    lifetime: true,
    deviceLimit: 5,
    startMode: "first_activation",
    catalogOrder: 10,
    displayOrder: 10
  });

  const serialized = JSON.stringify(body);
  for (const forbidden of ["signingPrivateJwk", "privateNote", "allowedOrigins", "internalToken", "nunca-vazar", "segredo"]) {
    assert.equal(serialized.includes(forbidden), false, `vazamento detectado: ${forbidden}`);
  }
});

test("catálogo vazio retorna lista estável", async () => {
  const services = memoryServices({
    [`projects/${PROJECT_HIDDEN}`]: project({ publicCatalog: false })
  });
  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/api/v1/catalog"),
    envFor(services)
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).catalog.projects, []);
});

test("novos campos comerciais possuem validação estrita", () => {
  const validProject = validateProjectPayload({
    name: "GuiaPlay",
    shortDescription: "Player multimídia",
    imageUrl: "https://cdn.example.com/logo.png",
    featured: true,
    displayOrder: 12
  });
  assert.equal(validProject.imageUrl, "https://cdn.example.com/logo.png");
  assert.equal(validProject.displayOrder, 12);
  assert.equal(validatePlanPayload({ name: "Anual", price: 99, durationDays: 365, displayOrder: 3 }).displayOrder, 3);

  for (const payload of [
    { name: "X", imageUrl: "http://example.com/logo.png" },
    { name: "X", imageUrl: "https://user:pass@example.com/logo.png" },
    { name: "X", featured: "true" },
    { name: "X", displayOrder: -1 }
  ]) assert.throws(() => validateProjectPayload(payload));

  assert.throws(() => validatePlanPayload({ name: "X", price: -0.01 }));
  assert.throws(() => validatePlanPayload({ name: "X", displayOrder: 1.5 }));
});

test("RBAC bloqueia alterações comerciais de programa e plano", async () => {
  const uid = "uid-catalog-reader";
  const email = "reader@example.com";
  const adminId = sha256(email);
  const services = memoryServices({
    [`adminUids/${sha256(uid)}`]: { adminId },
    [`admins/${adminId}`]: {
      email,
      status: "active",
      allProjects: true,
      projectIds: [],
      permissions: { manageProjectSettings: false, managePlans: false },
      firebaseUid: uid
    },
    [`projects/${PROJECT_A}`]: project(),
    [`projects/${PROJECT_A}/plans/plan_aaaaaaaaaaaaaaaaaaaa`]: plan()
  });
  const env = authenticatedEnv(services, uid, email);

  const projectResponse = await handleRequest(
    adminRequest(`/api/v1/admin/projects/${PROJECT_A}`, "PATCH", { featured: true }),
    env
  );
  assert.equal(projectResponse.status, 403);
  assert.equal((await projectResponse.json()).error, "permission_denied");

  const planResponse = await handleRequest(
    adminRequest(`/api/v1/admin/projects/${PROJECT_A}/plans/plan_aaaaaaaaaaaaaaaaaaaa`, "PATCH", { price: 1 }),
    env
  );
  assert.equal(planResponse.status, 403);
  assert.equal((await planResponse.json()).error, "permission_denied");
});

test("frontend público cobre carregamento, vazio, erro, CTA e renderização anti-XSS", async () => {
  const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8");

  assert.match(html, /id="app"[^>]*aria-live="polite"/);
  assert.match(html, /href="\/programas"/);
  assert.match(html, /href="\/carrinho"/);
  assert.match(app, /"\/conta\/perfil"/);
  assert.match(app, /fetch\("\/api\/v1\/catalog"/);
  assert.match(app, /function addToCart/);
  assert.match(app, /function renderProgram/);
  assert.match(app, /function renderCart/);
  assert.match(app, /function emptyState/);
  assert.match(app, /textContent/);
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(app), false);
  assert.match(app, /url\.protocol === "https:"/);
  assert.match(app, /!url\.username && !url\.password/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("preview comercial exige permissão de catálogo ou planos", async () => {
  const uid = "uid-catalog-preview-reader";
  const email = "preview-reader@example.com";
  const adminId = sha256(email);
  const services = memoryServices({
    [`adminUids/${sha256(uid)}`]: { adminId },
    [`admins/${adminId}`]: {
      email,
      status: "active",
      allProjects: true,
      projectIds: [],
      permissions: { manageProjectSettings: false, managePlans: false },
      firebaseUid: uid
    },
    [`projects/${PROJECT_A}`]: project()
  });
  const env = authenticatedEnv(services, uid, email);

  const response = await handleRequest(
    adminRequest(`/api/v1/admin/projects/${PROJECT_A}/catalog-preview`, "GET"),
    env
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "permission_denied");
});

test("preview administrativo reutiliza a projeção pública sem campos sensíveis", async () => {
  const services = memoryServices({
    [`projects/${PROJECT_A}`]: project(),
    [`projects/${PROJECT_A}/plans/plan_aaaaaaaaaaaaaaaaaaaa`]: plan()
  });
  const env = {
    ...envFor(services),
    ADMIN_FIREBASE_UID: "uid-master-test"
  };
  services.verifyIdToken = async () => firebaseToken("uid-master-test", "master@example.com");
  services.getAccountState = async () => ({
    localId: "uid-master-test",
    email: "master@example.com",
    emailVerified: true,
    disabled: false,
    validSince: "0"
  });

  const response = await handleRequest(
    adminRequest(`/api/v1/admin/projects/${PROJECT_A}/catalog-preview`, "GET"),
    env
  );
  assert.equal(response.status, 200);
  const preview = (await response.json()).preview;
  assert.equal(preview.published, true);
  assert.equal(preview.project.projectId, PROJECT_A);
  assert.equal(JSON.stringify(preview).includes("signingPrivateJwk"), false);
});
