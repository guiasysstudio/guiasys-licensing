import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`Firebase config check failed: ${message}`);
  process.exit(1);
}

function readJson(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) fail(`${file} não existe.`);
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    fail(`${file} contém JSON inválido: ${error.message}`);
  }
}

function readText(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) fail(`${file} não existe.`);
  return fs.readFileSync(full, "utf8");
}

const rc = readJson(".firebaserc");
const config = readJson("firebase.json");
const indexes = readJson("firestore.indexes.json");
const firestoreRules = readText("firestore.rules");
const storageRules = readText("storage.rules");
const backendPackage = readJson("worker/package.json");
const firebaseEntry = readText("worker/src/firebase-entry.js");
const firebaseRuntime = readText("worker/src/firebase-runtime.js");
const frontendApp = readText("assets/js/app.js");
const prepareHosting = readText("scripts/prepare-hosting.mjs");
const verifyHostingDist = readText("scripts/verify-hosting-dist.mjs");

if (rc?.projects?.default !== "guiasys-licensing") {
  fail(".firebaserc deve apontar o projeto default para guiasys-licensing.");
}

if (config?.firestore?.rules !== "firestore.rules") {
  fail("firebase.json deve versionar firestore.rules.");
}

if (config?.firestore?.indexes !== "firestore.indexes.json") {
  fail("firebase.json deve versionar firestore.indexes.json.");
}

if (config?.storage?.rules !== "storage.rules") {
  fail("firebase.json deve versionar storage.rules.");
}

if (!Array.isArray(config?.hosting)) {
  fail("C11 exige configuração multi-site do Firebase Hosting.");
}

const adminHosting = config.hosting.find(item => item?.target === "admin");
if (!adminHosting) {
  fail("Hosting administrativo deve usar o target admin.");
}

if (adminHosting.public !== ".hosting-admin-dist") {
  fail("Hosting administrativo deve publicar somente .hosting-admin-dist.");
}

if (!Array.isArray(adminHosting.predeploy)) {
  fail("Hosting administrativo deve possuir gates de predeploy.");
}

const hostingTarget = rc?.targets?.["guiasys-licensing"]?.hosting?.admin;
if (!Array.isArray(hostingTarget) || hostingTarget.length !== 1 || hostingTarget[0] !== "guiasys-licensing-admin") {
  fail(".firebaserc deve mapear hosting:admin para guiasys-licensing-admin.");
}

const hostingPredeploy = adminHosting.predeploy.join("\n");
if (!/prepare-hosting\.mjs/.test(hostingPredeploy) || !/verify-hosting-dist\.mjs/.test(hostingPredeploy)) {
  fail("Hosting admin predeploy deve preparar e validar o staging do painel.");
}

const rewrites = Array.isArray(adminHosting.rewrites) ? adminHosting.rewrites : [];
for (const source of ["/api/**", "/health"]) {
  const rewrite = rewrites.find(item => item?.source === source);
  if (!rewrite) fail(`Rewrite obrigatório ausente: ${source}`);
  if (rewrite?.function?.functionId !== "licensingApi") {
    fail(`Rewrite ${source} deve apontar para licensingApi.`);
  }
  if (rewrite?.function?.region !== "southamerica-east1") {
    fail(`Rewrite ${source} deve declarar southamerica-east1.`);
  }
  if ("pinTag" in rewrite.function) {
    fail(`Rewrite ${source} não deve usar pinTag no C11.`);
  }
}

const hostingHeaders = Array.isArray(adminHosting.headers) ? adminHosting.headers : [];
const globalHeaders = hostingHeaders.find(item => item?.source === "**")?.headers || [];
const requiredSecurityHeaders = [
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "Strict-Transport-Security"
];
for (const header of requiredSecurityHeaders) {
  if (!globalHeaders.some(item => item?.key === header && String(item?.value || "").trim())) {
    fail(`Header de segurança ausente no Hosting: ${header}`);
  }
}

if (config?.emulators?.hosting?.port !== 5000) {
  fail("Emulador do Hosting deve usar a porta 5000.");
}

if (!/const API_BASE = window\.location\.origin;/.test(frontendApp)) {
  fail("Frontend deve usar o próprio origin como API base.");
}

if (/workers\.dev/.test(frontendApp)) {
  fail("Frontend não pode depender diretamente do domínio workers.dev.");
}

if (!/\.hosting-admin-dist/.test(prepareHosting) || !/index\.html/.test(prepareHosting) || !/assets/.test(prepareHosting)) {
  fail("Builder do Hosting admin deve preparar somente o painel em .hosting-admin-dist.");
}

if (!/arquivo fora da allowlist/.test(verifyHostingDist)) {
  fail("Validador do Hosting deve bloquear arquivos fora da allowlist.");
}

if (fs.existsSync(path.join(root, "CNAME"))) {
  fail("CNAME do GitHub Pages deve ser removido no C11.");
}

if (!config?.functions || typeof config.functions !== "object") {
  fail("C10 exige configuração versionada de Firebase Functions.");
}

if (config.functions.source !== "worker") {
  fail("Functions deve usar worker como diretório source durante a migração C10.");
}

if (config.functions.codebase !== "licensing") {
  fail("Functions deve usar o codebase licensing.");
}

if (config.functions.runtime !== "nodejs22") {
  fail("Functions deve usar runtime nodejs22.");
}

if (!Array.isArray(config.functions.predeploy)) {
  fail("Functions deve possuir gates de predeploy.");
}

const predeploy = config.functions.predeploy.join("\n");
if (!/npm.+install/.test(predeploy) || !/npm.+test/.test(predeploy) || !/npm.+run check/.test(predeploy)) {
  fail("Predeploy de Functions deve instalar dependências, testar e validar sintaxe.");
}

if (backendPackage?.engines?.node !== "22") {
  fail("worker/package.json deve declarar Node 22.");
}

if (backendPackage?.main !== "src/firebase-entry.js") {
  fail("worker/package.json deve apontar para src/firebase-entry.js.");
}

if (!backendPackage?.dependencies?.["firebase-admin"] || !backendPackage?.dependencies?.["firebase-functions"]) {
  fail("Backend deve depender de firebase-admin e firebase-functions.");
}

if (!/firebase-functions\/v2\/https/.test(firebaseEntry) || !/defineSecret\("ADMIN_FIREBASE_UID"\)/.test(firebaseEntry)) {
  fail("Entrypoint deve usar Functions v2 e Secret Manager.");
}

if (!/southamerica-east1/.test(firebaseEntry)) {
  fail("Entrypoint deve declarar a região southamerica-east1.");
}

if (!/firebase-admin\/auth/.test(firebaseRuntime) || !/firebase-admin\/firestore/.test(firebaseRuntime)) {
  fail("Runtime deve usar Firebase Admin SDK para Auth e Firestore.");
}

if (/FIREBASE_SERVICE_ACCOUNT_JSON/.test(firebaseEntry) || /FIREBASE_SERVICE_ACCOUNT_JSON/.test(firebaseRuntime)) {
  fail("Runtime Firebase não deve depender de FIREBASE_SERVICE_ACCOUNT_JSON.");
}

if (!Array.isArray(indexes.indexes) || !Array.isArray(indexes.fieldOverrides)) {
  fail("firestore.indexes.json possui estrutura inválida.");
}

const firestoreCompact = firestoreRules.replace(/\s+/g, " ");
const storageCompact = storageRules.replace(/\s+/g, " ");

if (!/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(firestoreCompact)) {
  fail("Firestore deve permanecer deny-all para clientes.");
}

if (!/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(storageCompact)) {
  fail("Storage deve permanecer deny-all para clientes.");
}

if (/allow\s+[^;]+:\s*if\s+true\s*;/.test(firestoreCompact)) {
  fail("Firestore contém regra allow ... if true.");
}

if (/allow\s+[^;]+:\s*if\s+true\s*;/.test(storageCompact)) {
  fail("Storage contém regra allow ... if true.");
}

console.log("Firebase foundation + Functions C10 + Hosting admin multi-site C11 config OK.");
