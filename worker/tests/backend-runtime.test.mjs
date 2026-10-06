import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const firebaseJson = JSON.parse(
  await readFile(new URL("../../firebase.json", import.meta.url), "utf8")
);
const entry = await readFile(new URL("../src/firebase-entry.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/firebase-runtime.js", import.meta.url), "utf8");
const core = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("backend Firebase usa Node 22 e SDKs suportados", () => {
  assert.equal(packageJson.engines.node, "22");
  assert.equal(packageJson.main, "src/firebase-entry.js");
  assert.match(packageJson.dependencies["firebase-admin"], /^14\./);
  assert.match(packageJson.dependencies["firebase-functions"], /^7\./);
  assert.equal(packageJson.overrides?.uuid, "11.1.1");
});

test("firebase.json registra codebase Functions v2 no diretório do backend", () => {
  assert.equal(firebaseJson.functions.source, "worker");
  assert.equal(firebaseJson.functions.codebase, "licensing");
  assert.equal(firebaseJson.functions.runtime, "nodejs22");
  assert.ok(firebaseJson.functions.predeploy.some(command => command.includes("npm") && command.includes("install")));
  assert.ok(firebaseJson.functions.predeploy.some(command => command.includes("npm") && command.includes("test")));
  assert.ok(firebaseJson.functions.predeploy.some(command => command.includes("run check")));
  assert.equal(firebaseJson.emulators.functions.port, 5001);
});

test("entrypoint usa onRequest v2, região brasileira e Secret Manager", () => {
  assert.match(entry, /firebase-functions\/v2\/https/);
  assert.match(entry, /defineSecret\("ADMIN_FIREBASE_UID"\)/);
  assert.match(entry, /defineSecret\("PAGBANK_TOKEN"\)/);
  assert.match(entry, /defineSecret\("PAGBANK_SANDBOX_TOKEN"\)/);
  assert.match(entry, /defineString\("PAGBANK_SANDBOX_CHECKOUT_ENABLED",\s*\{\s*default:\s*"false"/s);
  assert.match(entry, /defineString\("PAGBANK_SANDBOX_TESTER_UIDS",\s*\{\s*default:\s*""/s);
  assert.match(entry, /region:\s*"southamerica-east1"/);
  assert.match(entry, /maxInstances:\s*20/);
  assert.match(entry, /secrets:\s*\[ADMIN_FIREBASE_UID, PAGBANK_TOKEN, PAGBANK_SANDBOX_TOKEN\]/);
  assert.match(entry, /PAGBANK_SANDBOX_CHECKOUT_ENABLED:\s*PAGBANK_SANDBOX_CHECKOUT_ENABLED\.value\(\)/);
  assert.match(entry, /PAGBANK_SANDBOX_TESTER_UIDS:\s*PAGBANK_SANDBOX_TESTER_UIDS\.value\(\)/);
  assert.match(entry, /invoker:\s*"public"/);
});

test("runtime Firebase usa Admin SDK e credenciais nativas", () => {
  assert.match(runtime, /from "firebase-admin\/app"/);
  assert.match(runtime, /from "firebase-admin\/auth"/);
  assert.match(runtime, /from "firebase-admin\/firestore"/);
  assert.match(runtime, /verifyIdToken\(idToken, true\)/);
  assert.match(runtime, /db\.runTransaction/);
  assert.match(runtime, /nativeTx\.create/);
  assert.equal(runtime.includes("FIREBASE_SERVICE_ACCOUNT_JSON"), false);
  assert.equal(entry.includes("FIREBASE_SERVICE_ACCOUNT_JSON"), false);
});

test("core preserva GSL-v1 e seleciona serviços Firebase sem remover rollback legado", () => {
  assert.match(core, /const PROTOCOL_VERSION = "GSL-v1"/);
  assert.match(core, /const API_VERSION = "2\.1\.0"/);
  assert.match(core, /env\.__services\?\.verifyIdToken/);
  assert.match(core, /env\.__services\?\.getDoc/);
  assert.match(core, /env\.__services\?\.atomicClient/);
  assert.match(core, /createFirestoreAtomicClient/);
});

test("todas as respostas recebem request id e logs estruturados", () => {
  assert.match(core, /headers\.set\("X-Request-Id", requestId\)/);
  assert.match(core, /"request\.completed"/);
  assert.match(core, /"request\.error"/);
  assert.match(core, /runtime: env\.__services\?\.runtime \|\| "cloudflare-worker"/);
});
