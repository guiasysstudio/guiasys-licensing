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
const deployWorkflow = await readFile(new URL("../../.github/workflows/firebase-production-deploy.yml", import.meta.url), "utf8");

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

test("Hosting encaminha somente API/health para a Function v2 correta", () => {
  const rewrites = firebase.hosting.find(item => item.target === "admin").rewrites;
  assert.deepEqual(rewrites.map(item => item.source), ["/api/**", "/health"]);

  for (const rewrite of rewrites) {
    assert.equal(rewrite.function.functionId, "licensingApi");
    assert.equal(rewrite.function.region, "southamerica-east1");
    assert.equal("pinTag" in rewrite.function, false);
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
    item.key === "Cache-Control" && /must-revalidate/.test(item.value)
  ));

  for (const header of [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Strict-Transport-Security"
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
  const admin = firebase.hosting.find(item => item.target === "admin");
  for (const rewrite of admin.rewrites) {
    assert.equal("pinTag" in rewrite.function, false);
  }
});

test("deploy manual exige confirmação, WIF e smoke test", () => {
  assert.match(deployWorkflow, /workflow_dispatch:/);
  assert.match(deployWorkflow, /inputs\.confirm == 'DEPLOY'/);
  assert.match(deployWorkflow, /id-token:\s*write/);
  assert.match(deployWorkflow, /google-github-actions\/auth@v3/);
  assert.match(deployWorkflow, /GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(deployWorkflow, /GCP_DEPLOY_SERVICE_ACCOUNT/);
  assert.match(deployWorkflow, /--only functions:licensing/);
  assert.match(deployWorkflow, /--only hosting:admin/);
  assert.match(deployWorkflow, /guiasys-licensing-admin\.web\.app\/health/);
  assert.equal(deployWorkflow.includes("credentials_json"), false);
  assert.equal(deployWorkflow.includes("FIREBASE_SERVICE_ACCOUNT"), false);
});
