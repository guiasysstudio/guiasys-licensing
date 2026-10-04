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

if ("hosting" in config) {
  fail("Hosting ainda não deve ser configurado no C03.");
}

if ("functions" in config) {
  fail("Functions ainda não deve ser configurado no C03.");
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

console.log("Firebase foundation config OK.");
