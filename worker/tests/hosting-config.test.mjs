import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const firebase = JSON.parse(
  await readFile(new URL("../../firebase.json", import.meta.url), "utf8")
);
const rc = JSON.parse(
  await readFile(new URL("../../.firebaserc", import.meta.url), "utf8")
);
const app = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const prepare = await readFile(new URL("../../scripts/prepare-hosting.mjs", import.meta.url), "utf8");
const verify = await readFile(new URL("../../scripts/verify-hosting-dist.mjs", import.meta.url), "utf8");
const preparePublic = await readFile(new URL("../../scripts/prepare-public-hosting.mjs", import.meta.url), "utf8");
const verifyPublic = await readFile(new URL("../../scripts/verify-public-hosting-dist.mjs", import.meta.url), "utf8");

test("Hosting admin usa target próprio e staging allowlist", () => {
  assert.equal(Array.isArray(firebase.hosting), true);
  const admin = firebase.hosting.find(item => item.target === "admin");
  assert.ok(admin);
  assert.deepEqual(rc.targets["guiasys-licensing"].hosting.admin, ["guiasys-licensing-admin"]);
  assert.deepEqual(rc.targets["guiasys-licensing"].hosting.public, ["guiasys-licensing"]);
  assert.equal(admin.public, ".hosting-admin-dist");
  assert.ok(admin.predeploy.some(command => command.includes("prepare-hosting.mjs")));
  assert.ok(admin.predeploy.some(command => command.includes("verify-hosting-dist.mjs")));
  assert.match(prepare, /\.hosting-admin-dist/);
  assert.match(prepare, /\["index\.html", "index\.html"\]/);
  assert.match(prepare, /\["assets", "assets"\]/);
  assert.match(verify, /arquivo fora da allowlist/);
  assert.equal(existsSync(new URL("../../CNAME", import.meta.url)), false);
});

test("Hosting público usa target próprio com frontend de catálogo isolado", () => {
  const publicHosting = firebase.hosting.find(item => item.target === "public");
  assert.ok(publicHosting);
  assert.deepEqual(rc.targets["guiasys-licensing"].hosting.public, ["guiasys-licensing"]);
  assert.equal(publicHosting.public, ".hosting-public-dist");
  assert.ok(publicHosting.predeploy.some(command => command.includes("prepare-public-hosting.mjs")));
  assert.ok(publicHosting.predeploy.some(command => command.includes("verify-public-hosting-dist.mjs")));
  assert.match(preparePublic, /\.hosting-public-dist/);
  assert.match(preparePublic, /public\/index\.html/);
  assert.match(preparePublic, /public\/assets/);
  assert.match(verifyPublic, /arquivo fora da allowlist/);
  assert.match(verifyPublic, /innerHTML\|insertAdjacentHTML/);
});

test("Hosting admin e público encaminham somente API/health para a Function v2 correta", () => {
  for (const target of ["admin", "public"]) {
    const rewrites = firebase.hosting.find(item => item.target === target).rewrites;
    assert.deepEqual(rewrites.map(item => item.source), ["/api/**", "/health"]);

    for (const rewrite of rewrites) {
      assert.equal(rewrite.function.functionId, "licensingApi");
      assert.equal(rewrite.function.region, "southamerica-east1");
      assert.equal("pinTag" in rewrite.function, false);
    }
  }
});

test("Hosting aplica headers de cache e hardening", () => {
  const admin = firebase.hosting.find(item => item.target === "admin");
  const bySource = new Map(admin.headers.map(item => [item.source, item.headers]));
  const indexHeaders = bySource.get("/index.html") || [];
  const assetHeaders = bySource.get("/assets/**") || [];
  const globalHeaders = bySource.get("**") || [];

  assert.ok(indexHeaders.some(item =>
    item.key === "Cache-Control" && /no-store/.test(item.value)
  ));
  assert.ok(assetHeaders.some(item =>
    item.key === "Cache-Control" && item.value === "public, max-age=0, must-revalidate"
  ));

  for (const header of [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Strict-Transport-Security",
    "Content-Security-Policy"
  ]) {
    assert.ok(globalHeaders.some(item => item.key === header), `header ausente: ${header}`);
  }
});

test("origens administrativas incluem o novo Hosting e subdomínio do painel", () => {
  assert.match(backend, /https:\/\/painel\.licencas\.guiasys\.online/);
  assert.match(backend, /https:\/\/guiasys-licensing-admin\.web\.app/);
  assert.match(backend, /https:\/\/guiasys-licensing-admin\.firebaseapp\.com/);
});

test("frontend consome a API pelo mesmo origin do Hosting", () => {
  assert.match(app, /const API_BASE = window\.location\.origin;/);
  assert.equal(app.includes("workers.dev"), false);
  assert.equal(app.includes("GitHub Pages"), false);
  assert.equal(app.includes("Cloudflare Workers"), false);
  assert.match(app, /Firebase Hosting/);
  assert.match(app, /Firebase Functions v2/);
});

test("emulador Hosting usa porta conhecida para smoke local", () => {
  assert.equal(firebase.emulators.hosting.port, 5000);
});


test("Hosting não usa pinTag para evitar alteração de tráfego no Cloud Run", () => {
  for (const target of ["admin", "public"]) {
    const hosting = firebase.hosting.find(item => item.target === target);
    for (const rewrite of hosting.rewrites) {
      assert.equal("pinTag" in rewrite.function, false);
    }
  }
});


test("CSP permite Firebase Auth sem liberar execução arbitrária", () => {
  const admin = firebase.hosting.find(item => item.target === "admin");
  const globalHeaders = admin.headers.find(item => item.source === "**")?.headers || [];
  const csp = globalHeaders.find(item => item.key === "Content-Security-Policy")?.value || "";

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/www\.gstatic\.com https:\/\/apis\.google\.com/);
  assert.match(csp, /connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com/);
  assert.match(csp, /frame-src https:\/\/guiasys-licensing\.firebaseapp\.com https:\/\/accounts\.google\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(/script-src[^;]*'unsafe-inline'/.test(csp), false);
  assert.equal(/script-src[^;]*'unsafe-eval'/.test(csp), false);
});

test("CSP público permite somente assets locais, API same-origin e imagens HTTPS", () => {
  const publicHosting = firebase.hosting.find(item => item.target === "public");
  const globalHeaders = publicHosting.headers.find(item => item.source === "**")?.headers || [];
  const csp = globalHeaders.find(item => item.key === "Content-Security-Policy")?.value || "";

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /img-src 'self' data: https:/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(csp.includes("unsafe-inline"), false);
  assert.equal(csp.includes("unsafe-eval"), false);
});
