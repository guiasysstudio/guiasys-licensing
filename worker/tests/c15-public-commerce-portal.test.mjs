import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { finalizePaidOrder, handleRequest, lookupBrazilianPostalCode } from "../src/index.js";
import {
  isValidCpf,
  validateCartPayload,
  validateCustomerProfilePayload,
  validateMediaPayload
} from "../src/validation.js";

const PROJECT = "prj_c15c15c15c15c15c15c1";
const PLAN = "plan_c15c15c15c15c15c15c1";
const PROJECT_2 = "prj_d15d15d15d15d15d15d1";
const PLAN_2 = "plan_d15d15d15d15d15d15d1";
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const clone = value => value == null ? value : structuredClone(value);
const docId = path => String(path).split("/").pop();

function projectData() {
  return {
    [`projects/${PROJECT}`]: {
      name: "Programa C15", slug: "programa-c15", prefix: "C15", status: "active",
      publicCatalog: false, featured: true, featuredOrder: 2, catalogOrder: 3,
      tagline: "Operação simples", shortDescription: "Resumo público",
      fullDescription: "Descrição comercial completa.",
      features: ["Recurso um"], requirements: ["Windows 10"],
      logoUrl: "https://cdn.example.com/logo.png",
      integrationCode: "GSLI-C15C-C15C-C15C"
    },
    [`projects/${PROJECT}/plans/${PLAN}`]: {
      name: "Anual", description: "Técnica", commercialDescription: "Oferta anual",
      termsVersion: "2026-10", price: 50, priceCents: 5000, durationDays: 365,
      lifetime: false, deviceLimit: 2, startMode: "first_activation",
      active: true, publicCatalog: false, publishedInCatalog: true, catalogOrder: 1
    }
  };
}

function services(initial = {}) {
  const store = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  let identity = { uid: "customer-c15-a", email: "a.c15@example.com", name: "Cliente C15" };
  const uploads = [];
  const read = path => store.has(path) ? { id: docId(path), ...clone(store.get(path)) } : null;
  return {
    store,
    uploads,
    setIdentity(uid, email, name = email) { identity = { uid, email, name }; },
    runtime: "firebase-functions-v2",
    async verifyIdToken() {
      const now = Math.floor(Date.now() / 1000);
      return {
        aud: "guiasys-licensing", iss: "https://securetoken.google.com/guiasys-licensing",
        sub: identity.uid, exp: now + 3600, iat: now - 5, auth_time: now - 5,
        email: identity.email, email_verified: true, name: identity.name,
        picture: "https://lh3.googleusercontent.com/external-avatar",
        firebase: { sign_in_provider: "password" }
      };
    },
    async getAccountState() {
      return { localId: identity.uid, email: identity.email, displayName: identity.name, photoUrl: "https://lh3.googleusercontent.com/external-avatar", emailVerified: true, disabled: false, validSince: "0" };
    },
    async getDoc(path) { return read(path); },
    async setDoc(path, value) { store.set(path, clone(value)); return read(path); },
    async deleteDoc(path) { store.delete(path); },
    async listCollection(path) {
      const prefix = `${path}/`;
      return [...store.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
        .map(([key, value]) => ({ id: docId(key), ...clone(value) }));
    },
    async uploadStorageObject(path, value) {
      uploads.push({ path, ...value });
      return { path, url: `https://firebasestorage.googleapis.com/v0/b/guiasys-licensing.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=test` };
    },
    async downloadRemoteImage(url, options) {
      uploads.push({ importedFrom: url, options });
      return {
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: "image/png",
        extension: "png"
      };
    },
    async deleteStorageObject(path) { uploads.push({ deleted: path }); },
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
              if (store.has(path) || writes.some(item => item.path === path)) throw Object.assign(new Error("exists"), { status: 409, reason: "concurrency_conflict" });
              writes.push({ path, value: clone(value) });
            },
            delete(path) { writes.push({ path, remove: true }); }
          };
          const result = await operation(tx);
          for (const write of writes) write.remove ? store.delete(write.path) : store.set(write.path, write.value);
          return result;
        }
      };
    },
    log() {}
  };
}

function environment(api) {
  return {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "master-c15",
    PAYMENT_PROVIDER: "manual_pix",
    PAGBANK_ENABLED: "false",
    __services: api
  };
}

function request(path, method = "GET", body) {
  return new Request(`https://licencas.guiasys.online${path}`, {
    method,
    headers: { Authorization: "Bearer c15", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

async function completeProfile(api) {
  const response = await handleRequest(request("/api/v1/customer/me", "PATCH", {
    displayName: "Nome editado C15", taxId: "529.982.247-25", phone: "(69) 99999-9999",
    postalCode: "76900-000", street: "Rua Teste", number: "100",
    complement: "", neighborhood: "Centro", city: "Ji-Paraná", state: "ro"
  }), environment(api));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).account.profileComplete, true);
  const persisted = await handleRequest(request("/api/v1/customer/me"), environment(api));
  assert.equal((await persisted.json()).account.displayName, "Nome editado C15");
}

test("catálogo ignora booleano legado do projeto e usa publicação explícita do plano", async () => {
  const api = services({
    ...projectData(),
    [`projects/${PROJECT_2}`]: {
      name: "Primeiro destaque", slug: "primeiro-destaque", prefix: "PDT",
      status: "active", publicCatalog: false, featured: true, featuredOrder: 1, catalogOrder: 1
    },
    [`projects/${PROJECT_2}/plans/${PLAN_2}`]: {
      name: "Plano", priceCents: 1000, durationDays: 30, lifetime: false,
      deviceLimit: 1, active: true, publishedInCatalog: true, catalogOrder: 1
    }
  });
  const response = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/catalog"), environment(api));
  assert.equal(response.status, 200);
  const catalog = (await response.json()).catalog;
  assert.equal(catalog.projects.length, 2);
  assert.deepEqual(catalog.projects.map(item => item.slug), ["primeiro-destaque", "programa-c15"]);
  assert.equal(catalog.projects[1].plans[0].commercialDescription, "Oferta anual");
  assert.equal(catalog.projects[1].plans[0].termsVersion, "2026-10");
  assert.equal(catalog.projects[1].logoUrl, "", "catálogo não expõe URL externa legada");

  api.store.set(`projects/${PROJECT}/plans/${PLAN}`, { ...api.store.get(`projects/${PROJECT}/plans/${PLAN}`), publishedInCatalog: false, publicCatalog: true });
  const hidden = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/catalog"), environment(api));
  assert.deepEqual((await hidden.json()).catalog.projects.map(item => item.slug), ["primeiro-destaque"]);
});

test("detalhe público usa slug estável e recusa ID na URL", async () => {
  const api = services(projectData());
  const detail = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/catalog/programa-c15"), environment(api));
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).project.projectId, PROJECT);
  const byId = await handleRequest(new Request(`https://licencas.guiasys.online/api/v1/catalog/${PROJECT}`), environment(api));
  assert.equal(byId.status, 404);
});

test("perfil incompleto bloqueia checkout e valida CPF, telefone, CEP e UF", async () => {
  const api = services(projectData());
  const blocked = await handleRequest(request("/api/v1/customer/orders", "POST", {
    idempotencyKey: "c15-incomplete-profile",
    items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }]
  }), environment(api));
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error, "profile_incomplete");
  await completeProfile(api);
  const created = await handleRequest(request("/api/v1/customer/orders", "POST", {
    idempotencyKey: "c15-complete-profile",
    items: [{ projectId: PROJECT, planId: PLAN, quantity: 1 }]
  }), environment(api));
  assert.equal(created.status, 201);
  const order = (await created.json()).order;
  assert.equal(order.items[0].purchasedTermsVersionSnapshot, "2026-10");
  api.store.set(`projects/${PROJECT}/plans/${PLAN}`, { ...api.store.get(`projects/${PROJECT}/plans/${PLAN}`), price: 60, priceCents: 6000 });
  const historical = await handleRequest(request(`/api/v1/customer/orders/${order.orderId}`), environment(api));
  assert.equal((await historical.json()).order.totalCents, 5000);
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.throws(() => validateCustomerProfilePayload({ taxId: "111.111.111-11" }), error => error.reason === "invalid_cpf");
});

test("consulta de CEP valida entrada, sanitiza resposta e trata inexistente", async () => {
  const found = await lookupBrazilianPostalCode("76900-000", async url => {
    assert.equal(url, "https://viacep.com.br/ws/76900000/json/");
    return new Response(JSON.stringify({
      cep: "76900-000", logradouro: "Rua Exemplo", bairro: "Centro",
      localidade: "Ji-Paraná", uf: "RO"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(found, {
    postalCode: "76900000", street: "Rua Exemplo", neighborhood: "Centro", city: "Ji-Paraná", state: "RO"
  });
  await assert.rejects(
    () => lookupBrazilianPostalCode("123", async () => new Response("{}")),
    error => error.reason === "invalid_postal_code"
  );
  await assert.rejects(
    () => lookupBrazilianPostalCode("76900999", async () => new Response(JSON.stringify({ erro: true }), { status: 200 })),
    error => error.reason === "postal_code_not_found"
  );
});

test("carrinho e favoritos persistem apenas IDs/quantidade e ficam isolados por conta", async () => {
  const api = services(projectData());
  const cart = { items: [{ projectId: PROJECT, planId: PLAN, quantity: 2 }] };
  assert.deepEqual(validateCartPayload(cart), cart);
  assert.equal((await handleRequest(request("/api/v1/customer/cart", "PUT", cart), environment(api))).status, 200);
  assert.equal((await handleRequest(request(`/api/v1/customer/favorites/${PROJECT}`, "POST"), environment(api))).status, 201);
  api.setIdentity("customer-c15-b", "b.c15@example.com", "Cliente B");
  const otherCart = await handleRequest(request("/api/v1/customer/cart"), environment(api));
  const otherFavorites = await handleRequest(request("/api/v1/customer/favorites"), environment(api));
  assert.deepEqual((await otherCart.json()).cart.items, []);
  assert.deepEqual((await otherFavorites.json()).projectIds, []);
});

test("quantidade dois gera duas licenças rastreáveis e replay não duplica", async () => {
  const api = services(projectData());
  await completeProfile(api);
  const createdResponse = await handleRequest(request("/api/v1/customer/orders", "POST", {
    idempotencyKey: "c15-two-licenses",
    items: [{ projectId: PROJECT, planId: PLAN, quantity: 2 }]
  }), environment(api));
  const order = (await createdResponse.json()).order;
  const result = await finalizePaidOrder(environment(api), order.orderId, {
    paymentId: "pay_c15c15c15c15c15c15c1",
    orderId: order.orderId, accountId: order.accountId, status: "paid",
    amountCents: 10000, currency: "BRL", provider: "manual_pix", method: "pix"
  });
  assert.equal(result.order.resultingLicenses.length, 2);
  assert.equal(new Set(result.order.resultingLicenses.map(item => item.licenseId)).size, 2);
  for (const item of result.order.resultingLicenses) {
    assert.equal(item.orderItemId, order.items[0].orderItemId);
    assert.equal(item.customerUid, "customer-c15-a");
    assert.equal(item.planId, PLAN);
  }
  const replay = await finalizePaidOrder(environment(api), order.orderId, {
    paymentId: "pay_c15c15c15c15c15c15c1",
    orderId: order.orderId, accountId: order.accountId, status: "paid",
    amountCents: 10000, currency: "BRL", provider: "manual_pix", method: "pix"
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal([...api.store.keys()].filter(path => path.startsWith(`projects/${PROJECT}/licenses/`)).length, 2);
});

test("upload valida MIME, extensão, assinatura e exige autenticação", async () => {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  assert.equal(validateMediaPayload({ fileName: "avatar.png", contentType: "image/png", dataBase64: png }).contentType, "image/png");
  assert.throws(() => validateMediaPayload({ fileName: "avatar.jpg", contentType: "image/png", dataBase64: png }), error => error.reason === "invalid_media_type");
  const api = services(projectData());
  const denied = await handleRequest(new Request("https://licencas.guiasys.online/api/v1/customer/me/photo", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: "avatar.png", contentType: "image/png", dataBase64: png })
  }), environment(api));
  assert.equal(denied.status, 401);
  const uploaded = await handleRequest(request("/api/v1/customer/me/photo", "POST", {
    fileName: "avatar.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(uploaded.status, 200);
  assert.match(api.uploads.find(item => item.path)?.path, /^profiles\/customer-c15-a\/avatar-/);
  assert.match((await uploaded.json()).account.photoUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
  const replacement = await handleRequest(request("/api/v1/customer/me/photo", "POST", {
    fileName: "avatar.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(replacement.status, 200);
  assert.equal(api.uploads.filter(item => item.deleted).length, 1, "a troca remove a foto anterior depois de persistir");
  const removed = await handleRequest(request("/api/v1/customer/me/photo", "DELETE"), environment(api));
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).account.photoUrl, "");
  assert.equal(api.uploads.filter(item => item.deleted).length, 2);
});

test("avatar externo do Google não é persistido nem exposto", async () => {
  const api = services(projectData());
  const response = await handleRequest(request("/api/v1/customer/me"), environment(api));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).account.photoUrl, "");
  const stored = [...api.store.values()].find(value => value?.firebaseUid === "customer-c15-a");
  assert.equal(stored.photoUrl, "");
  assert.equal(stored.photoStoragePath, "");
});

test("admin autorizado envia mídia comercial e slug duplicado é recusado", async () => {
  const api = services(projectData());
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  const upload = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "logo", fileName: "logo.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(upload.status, 201);
  assert.match((await upload.json()).project.logoUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
  const replacement = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "logo", fileName: "logo.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(replacement.status, 201);
  assert.equal(api.uploads.filter(item => item.deleted).length, 1);
  for (const kind of ["icon", "banner"]) {
    const first = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
      kind, fileName: `${kind}.png`, contentType: "image/png", dataBase64: png
    }), environment(api));
    assert.equal(first.status, 201);
    const second = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
      kind, fileName: `${kind}.png`, contentType: "image/png", dataBase64: png
    }), environment(api));
    assert.equal(second.status, 201);
  }
  assert.equal(api.uploads.filter(item => item.deleted).length, 3, "logo, ícone e banner antigos são removidos");

  const screenshot = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "screen.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(screenshot.status, 201);
  const screenshotPath = (await screenshot.json()).upload.path;
  const removedScreenshot = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    screenshots: []
  }), environment(api));
  assert.equal(removedScreenshot.status, 200);
  assert.equal(api.uploads.some(item => item.deleted === screenshotPath), true);

  const imported = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    logoUrl: "https://images.example.com/new-logo.png",
    iconUrl: "https://images.example.com/new-icon.png",
    bannerUrl: "https://images.example.com/new-banner.png",
    screenshots: ["https://images.example.com/screen-1.png"]
  }), environment(api));
  assert.equal(imported.status, 200);
  const importedProject = (await imported.json()).project;
  assert.match(importedProject.logoUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
  assert.match(importedProject.iconUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
  assert.match(importedProject.bannerUrl, /^https:\/\/firebasestorage\.googleapis\.com/);
  assert.match(importedProject.screenshots[0], /^https:\/\/firebasestorage\.googleapis\.com/);
  assert.equal(api.uploads.some(item => item.importedFrom === "https://images.example.com/new-logo.png"), true);
  assert.equal(api.uploads.some(item => item.importedFrom === "https://images.example.com/new-icon.png"), true);
  assert.equal(api.uploads.some(item => item.importedFrom === "https://images.example.com/new-banner.png"), true);
  assert.equal(api.uploads.some(item => item.importedFrom === "https://images.example.com/screen-1.png"), true);

  const stored = api.store.get(`projects/${PROJECT}`);
  const fullScreenshots = Array.from({ length: 12 }, (_, index) => `https://firebasestorage.googleapis.com/v0/b/guiasys-licensing.firebasestorage.app/o/${encodeURIComponent(`commerce/projects/${PROJECT}/screenshot/shot-${index}.png`)}?alt=media&token=test`);
  stored.screenshots = fullScreenshots;
  stored.screenshotStoragePaths = Array.from({ length: 12 }, (_, index) => `commerce/projects/${PROJECT}/screenshot/shot-${index}.png`);
  const uploadCountBeforeLimit = api.uploads.filter(item => item.path).length;
  const limited = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "screen.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(limited.status, 409);
  assert.equal(api.uploads.filter(item => item.path).length, uploadCountBeforeLimit);

  const duplicate = await handleRequest(request("/api/v1/admin/projects", "POST", {
    name: "Outro programa", slug: "programa-c15", prefix: "OUT"
  }), environment(api));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "project_slug_exists");
});

test("falha ao obter URL oficial não persiste referência de mídia no Firestore", async () => {
  const api = services(projectData());
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const before = clone(api.store.get(`projects/${PROJECT}`));
  api.uploadStorageObject = async () => {
    throw Object.assign(new Error("Falha ao gravar a mídia no Storage."), {
      status: 502,
      reason: "upstream_error"
    });
  };

  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  const response = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "logo", fileName: "logo.png", contentType: "image/png", dataBase64: png
  }), environment(api));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "upstream_error");
  assert.deepEqual(api.store.get(`projects/${PROJECT}`), before);
});

test("salvar após upload direto preserva URL e path gerenciados sem duplicar objetos", async () => {
  const api = services(projectData());
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");

  const logoResponse = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "logo", fileName: "logo.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(logoResponse.status, 201);
  const logoUpload = (await logoResponse.json()).upload;
  const uploadsAfterLogo = api.uploads.filter(item => item.path).length;
  const importsAfterLogo = api.uploads.filter(item => item.importedFrom).length;
  const deletesAfterLogo = api.uploads.filter(item => item.deleted).length;

  const logoPatch = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    logoUrl: logoUpload.url
  }), environment(api));
  assert.equal(logoPatch.status, 200);
  let stored = api.store.get(`projects/${PROJECT}`);
  assert.equal(stored.logoUrl, logoUpload.url);
  assert.equal(stored.logoStoragePath, logoUpload.path);
  assert.equal(api.uploads.filter(item => item.path).length, uploadsAfterLogo);
  assert.equal(api.uploads.filter(item => item.importedFrom).length, importsAfterLogo);
  assert.equal(api.uploads.filter(item => item.deleted).length, deletesAfterLogo);

  const screenshotResponse = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "screen.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(screenshotResponse.status, 201);
  const screenshotBody = await screenshotResponse.json();
  const screenshotUpload = screenshotBody.upload;
  const uploadsAfterScreenshot = api.uploads.filter(item => item.path).length;
  const importsAfterScreenshot = api.uploads.filter(item => item.importedFrom).length;
  const deletesAfterScreenshot = api.uploads.filter(item => item.deleted).length;

  const screenshotPatch = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    screenshots: screenshotBody.project.screenshots
  }), environment(api));
  assert.equal(screenshotPatch.status, 200);
  stored = api.store.get(`projects/${PROJECT}`);
  assert.deepEqual(stored.screenshots, [screenshotUpload.url]);
  assert.deepEqual(stored.screenshotStoragePaths, [screenshotUpload.path]);
  assert.equal(api.uploads.filter(item => item.path).length, uploadsAfterScreenshot);
  assert.equal(api.uploads.filter(item => item.importedFrom).length, importsAfterScreenshot);
  assert.equal(api.uploads.filter(item => item.deleted).length, deletesAfterScreenshot);
});

test("upload de screenshot preenche lacunas de projeto legado sem deslocar paths", async () => {
  const legacyWithoutPaths = projectData();
  legacyWithoutPaths[`projects/${PROJECT}`].screenshots = [
    "https://legacy.example.com/one.png",
    "https://legacy.example.com/two.png"
  ];
  const api = services(legacyWithoutPaths);
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  const response = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "new-screen.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  assert.equal(response.status, 201);
  const uploadedPath = (await response.json()).upload.path;
  const stored = api.store.get(`projects/${PROJECT}`);
  assert.equal(stored.screenshots.length, 3);
  assert.equal(stored.screenshotStoragePaths.length, 3);
  assert.deepEqual(stored.screenshotStoragePaths, ["", "", uploadedPath]);
});

test("upload preserva associação por índice quando screenshotStoragePaths legado é menor", async () => {
  const firstPath = `commerce/projects/${PROJECT}/screenshot/first.png`;
  const legacyShortPaths = projectData();
  legacyShortPaths[`projects/${PROJECT}`].screenshots = [
    `https://firebasestorage.googleapis.com/v0/b/guiasys-licensing.firebasestorage.app/o/${encodeURIComponent(firstPath)}?alt=media&token=test`,
    "https://legacy.example.com/two.png",
    "https://legacy.example.com/three.png"
  ];
  legacyShortPaths[`projects/${PROJECT}`].screenshotStoragePaths = [firstPath];
  const api = services(legacyShortPaths);
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  const response = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "new-screen.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  const uploadedPath = (await response.json()).upload.path;
  const stored = api.store.get(`projects/${PROJECT}`);
  assert.deepEqual(stored.screenshotStoragePaths, [firstPath, "", "", uploadedPath]);
  assert.equal(stored.screenshots.length, stored.screenshotStoragePaths.length);
});

test("remoções, reordenação e novo upload mantêm screenshots alinhados e limpam somente órfãos", async () => {
  const middlePath = `commerce/projects/${PROJECT}/screenshot/middle.png`;
  const lastPath = `commerce/projects/${PROJECT}/screenshot/last.png`;
  const middleUrl = `https://firebasestorage.googleapis.com/v0/b/guiasys-licensing.firebasestorage.app/o/${encodeURIComponent(middlePath)}?alt=media&token=test`;
  const lastUrl = `https://firebasestorage.googleapis.com/v0/b/guiasys-licensing.firebasestorage.app/o/${encodeURIComponent(lastPath)}?alt=media&token=test`;
  const legacyUrl = "https://legacy.example.com/legacy.png";
  const initial = projectData();
  initial[`projects/${PROJECT}`].screenshots = [legacyUrl, middleUrl, lastUrl];
  initial[`projects/${PROJECT}`].screenshotStoragePaths = ["", middlePath, lastPath];
  const api = services(initial);
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const originalDelete = api.deleteStorageObject.bind(api);
  api.deleteStorageObject = async path => {
    const persisted = api.store.get(`projects/${PROJECT}`);
    assert.equal((persisted.screenshotStoragePaths || []).includes(path), false, "a limpeza ocorre somente depois da persistência");
    await originalDelete(path);
  };

  const withoutMiddle = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    screenshots: [legacyUrl, lastUrl]
  }), environment(api));
  assert.equal(withoutMiddle.status, 200);
  let stored = api.store.get(`projects/${PROJECT}`);
  const importedLegacyPath = stored.screenshotStoragePaths[0];
  assert.equal(stored.screenshots.length, stored.screenshotStoragePaths.length);
  assert.equal(stored.screenshotStoragePaths[1], lastPath);
  assert.equal(api.uploads.some(item => item.deleted === middlePath), true, "screenshot Firebase removido do meio é limpo");
  assert.equal(api.uploads.some(item => item.deleted === lastPath), false, "screenshot ainda usado não é limpo");

  const withoutLegacy = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    screenshots: [lastUrl]
  }), environment(api));
  assert.equal(withoutLegacy.status, 200);
  stored = api.store.get(`projects/${PROJECT}`);
  assert.deepEqual(stored.screenshotStoragePaths, [lastPath]);
  assert.equal(api.uploads.some(item => item.deleted === importedLegacyPath), true, "screenshot legado importado é limpo quando removido");

  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  const firstUpload = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "after-removal.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  const firstUploadBody = await firstUpload.json();
  stored = api.store.get(`projects/${PROJECT}`);
  assert.deepEqual(stored.screenshotStoragePaths, [lastPath, firstUploadBody.upload.path]);

  const reordered = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    screenshots: [firstUploadBody.upload.url, lastUrl]
  }), environment(api));
  assert.equal(reordered.status, 200);
  const secondUpload = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}/media`, "POST", {
    kind: "screenshot", fileName: "after-edit.png", contentType: "image/png", dataBase64: png
  }), environment(api));
  const secondUploadBody = await secondUpload.json();
  stored = api.store.get(`projects/${PROJECT}`);
  assert.deepEqual(stored.screenshotStoragePaths, [firstUploadBody.upload.path, lastPath, secondUploadBody.upload.path]);
  assert.equal(stored.screenshots.length, stored.screenshotStoragePaths.length);
});

test("path compartilhado por screenshots não é excluído enquanto continuar referenciado", async () => {
  const sharedPath = `commerce/projects/${PROJECT}/screenshot/shared.png`;
  const sharedUrl = `https://firebasestorage.googleapis.com/v0/b/guiasys-licensing.firebasestorage.app/o/${encodeURIComponent(sharedPath)}?alt=media&token=test`;
  const initial = projectData();
  initial[`projects/${PROJECT}`].screenshots = [sharedUrl, sharedUrl];
  initial[`projects/${PROJECT}`].screenshotStoragePaths = [sharedPath, sharedPath];
  const api = services(initial);
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const response = await handleRequest(request(`/api/v1/admin/projects/${PROJECT}`, "PATCH", {
    screenshots: [sharedUrl]
  }), environment(api));
  assert.equal(response.status, 200);
  const stored = api.store.get(`projects/${PROJECT}`);
  assert.deepEqual(stored.screenshotStoragePaths, [sharedPath]);
  assert.equal(api.uploads.some(item => item.deleted === sharedPath), false);
});

test("novo projeto é persistido antes de receber logo, ícone, banner e screenshot locais", async () => {
  const api = services(projectData());
  api.setIdentity("master-c15", "master.c15@example.com", "Master C15");
  const createdResponse = await handleRequest(request("/api/v1/admin/projects", "POST", {
    name: "Projeto com mídia local", slug: "projeto-com-midia-local", prefix: "PML",
    screenshots: ["https://images.example.com/imported-before-files.png"]
  }), environment(api));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).project;
  assert.ok(api.store.has(`projects/${created.id}`));
  assert.notEqual(api.store.get(`projects/${created.id}`).screenshots[0], "https://images.example.com/imported-before-files.png");

  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString("base64");
  for (const kind of ["logo", "icon", "banner", "screenshot"]) {
    const response = await handleRequest(request(`/api/v1/admin/projects/${created.id}/media`, "POST", {
      kind, fileName: `${kind}.png`, contentType: "image/png", dataBase64: png
    }), environment(api));
    assert.equal(response.status, 201);
    assert.match((await response.json()).upload.path, new RegExp(`^commerce/projects/${created.id}/${kind}/`));
  }
  const stored = api.store.get(`projects/${created.id}`);
  assert.match(stored.logoStoragePath, new RegExp(`^commerce/projects/${created.id}/logo/`));
  assert.match(stored.iconStoragePath, new RegExp(`^commerce/projects/${created.id}/icon/`));
  assert.match(stored.bannerStoragePath, new RegExp(`^commerce/projects/${created.id}/banner/`));
  assert.equal(stored.screenshots.length, 2);
  assert.equal(stored.screenshots.length, stored.screenshotStoragePaths.length);
  assert.equal(stored.screenshots.some(url => url.startsWith("https://images.example.com/")), false);
});

test("portal SPA contém rotas, carrinho sem navegação automática, PIX manual e assets oficiais", async () => {
  const [html, js, css, firebase, firestoreRules, storageRules, symbol, lockup, wordmark] = await Promise.all([
    readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8"),
    readFile(new URL("../../firebase.json", import.meta.url), "utf8"),
    readFile(new URL("../../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../../storage.rules", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/brand/guiasys-licensing-symbol.svg", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/brand/guiasys-licensing-lockup.svg", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/brand/guiasys-licensing-wordmark.svg", import.meta.url), "utf8")
  ]);
  for (const route of ["/programas", "/carrinho", "/entrar", "/cadastro", "/recuperar-senha", "/conta/perfil", "/conta/favoritos", "/conta/compras"]) {
    assert.match(html + js, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(js, /Adicionar ao carrinho/);
  assert.match(js, /Comprar agora/);
  assert.match(js, /showToast\(\`\$\{label\} adicionado ao carrinho/);
  assert.match(js, /function buyNow\([\s\S]{0,360}navigate\("\/carrinho"\)/);
  assert.doesNotMatch(js, /Comprar agora"[\s\S]{0,180}addToCart\([\s\S]{0,180}navigate\("\/carrinho"\)/);
  assert.match(js, /function openPixModal\(/);
  assert.match(js, /el\("section", "pix-modal"\)/);
  assert.match(js, /formatCpf\(/);
  assert.match(js, /formatPhone\(/);
  assert.match(js, /formatCep\(/);
  assert.match(js, /Reenviar confirmação/);
  assert.match(js, /state\.user\.reload\(\)/);
  assert.match(js, /api\("\/api\/v1\/customer\/address\/cep",\s*\{/);
  assert.doesNotMatch(js, /customer\/address\/cep\/\$\{cep\}/);
  assert.match(js, /safeNextPath\(/);
  assert.match(js, /CHECKOUT_KEY/);
  assert.match(js, /state\.favorites = favorites\.projectIds \|\| \[\]/);
  assert.doesNotMatch(js, /Imagem comercial não cadastrada\./);
  assert.match(js, /window\.open\("about:blank", "_blank"\)/);
  assert.match(js, /whatsappWindow\.location\.replace\(payment\.whatsappUrl\)/);
  assert.match(js, /cart-count"\)\.hidden = count === 0/);
  assert.match(js, /sendPasswordResetEmail/);
  assert.match(js, /signInWithPopup\(auth, googleProvider\)/);
  assert.match(js, /Criar conta com Google/);
  assert.match(html, /account-dropdown/);
  assert.match(js, /project\.additionalInfo/);
  assert.match(js, /featuredItems\.slice\(0, 6\)/);
  assert.match(js, /PAYMENT_PROVIDER|Pagamento via PIX|payment-reported/);
  assert.match(html, /guiasys-licensing-lockup\.svg/);
  assert.match(html, /guiasys-licensing-symbol\.svg/);
  assert.match(js, /guiasys-licensing-lockup\.svg/);
  assert.match(html, /class="footer-brand"/);
  assert.match(js, /"auth-lockup"/);
  assert.doesNotMatch(html + js, /identidade oficial pendente|SVG aguardando fornecimento/);
  for (const svg of [symbol, lockup, wordmark]) {
    assert.match(svg, /<svg\b/);
    assert.match(svg, /viewBox="[^"]+"/);
  }
  assert.equal(/#[0-9a-f]{0,2}(?:00ff00|008000|00aa00)/i.test(css), false);
  for (const color of ["#0c171f", "#13212b", "#f2a900", "#b97d00", "#ffb800", "#fff2cc", "#fffaef", "#101820", "#6d747e", "#e4d3a6", "#ffffff"]) {
    assert.match(css.toLowerCase(), new RegExp(color));
  }
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.toast\{[^}]*pointer-events:none/);
  assert.match(css, /\.license-row\{[^}]*flex-wrap:wrap/);
  assert.match(firebase, /"source": "\*\*"\s*,\s*"destination": "\/index\.html"/);
  assert.match(firestoreRules, /allow read, write: if false/);
  assert.match(storageRules, /allow read, write: if false/);
  assert.equal(/PAGBANK_TOKEN/.test(js), false);
});
