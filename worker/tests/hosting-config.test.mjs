import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const firebase = JSON.parse(
  await readFile(new URL("../../firebase.json", import.meta.url), "utf8")
);
const app = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");
const prepare = await readFile(new URL("../../scripts/prepare-hosting.mjs", import.meta.url), "utf8");
const verify = await readFile(new URL("../../scripts/verify-hosting-dist.mjs", import.meta.url), "utf8");

test("Hosting publica somente staging allowlist", () => {
  assert.equal(firebase.hosting.public, ".hosting-dist");
  assert.ok(firebase.hosting.predeploy.some(command => command.includes("prepare-hosting.mjs")));
  assert.ok(firebase.hosting.predeploy.some(command => command.includes("verify-hosting-dist.mjs")));
  assert.match(prepare, /\["index\.html", "index\.html"\]/);
  assert.match(prepare, /\["assets", "assets"\]/);
  assert.match(verify, /arquivo fora da allowlist/);
  assert.equal(existsSync(new URL("../../CNAME", import.meta.url)), false);
});

test("Hosting encaminha somente API/health para a Function v2 correta", () => {
  const rewrites = firebase.hosting.rewrites;
  assert.deepEqual(rewrites.map(item => item.source), ["/api/**", "/health"]);

  for (const rewrite of rewrites) {
    assert.equal(rewrite.function.functionId, "licensingApi");
    assert.equal(rewrite.function.region, "southamerica-east1");
    assert.equal(rewrite.function.pinTag, true);
  }
});

test("Hosting aplica headers de cache e hardening", () => {
  const bySource = new Map(firebase.hosting.headers.map(item => [item.source, item.headers]));
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
