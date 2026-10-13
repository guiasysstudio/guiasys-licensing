import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedProject = "demo-guiasys-licensing";

function localHost(name) {
  const value = String(process.env[name] || "");
  assert.match(value, /^(?:127\.0\.0\.1|localhost):\d+$/, `${name} deve apontar para um emulador local.`);
  return value;
}

assert.equal(process.env.GCLOUD_PROJECT, expectedProject, "O projeto ficticio dos emuladores e obrigatorio.");
localHost("FIRESTORE_EMULATOR_HOST");
localHost("FIREBASE_AUTH_EMULATOR_HOST");
localHost("FIREBASE_STORAGE_EMULATOR_HOST");
localHost("FUNCTIONS_EMULATOR_HOST");

function parseLocalEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}

const localConfig = parseLocalEnv(await readFile(path.join(root, "worker/.env.local"), "utf8"));
const localSecrets = parseLocalEnv(await readFile(path.join(root, "worker/.secret.local"), "utf8"));
assert.equal(localConfig.PAYMENT_PROVIDER, "manual_pix", "Testes locais exigem PIX manual.");
assert.equal(localConfig.PAGBANK_ENABLED, "false", "PagBank deve permanecer desativado nos emuladores.");
assert.equal(localConfig.PAGBANK_SANDBOX_CHECKOUT_ENABLED, "false", "Checkout sandbox deve permanecer desativado.");
assert.match(localSecrets.ADMIN_FIREBASE_UID || "", /(?:demo|emulat|fake|local|test)/i,
  "ADMIN_FIREBASE_UID local deve ser inequivocamente ficticio.");

const scripts = [
  "test-c15-auth-emulator.mjs",
  "test-c15-rules-emulator.mjs",
  "test-firebase-rules.mjs",
  "test-c14c-emulator.mjs",
  "test-int08-e2e-emulator.mjs",
  "test-c15-functions-emulator.mjs"
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 60_000
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  assert.equal(result.status, 0, `${script} falhou nos emuladores isolados.`);
}

console.log(`INT-08 Emulator Suite: OK - ${scripts.length} verificacoes isoladas em ${expectedProject}.`);
