import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const dist = path.join(root, ".hosting-dist");

function fail(message) {
  console.error(`Hosting dist check failed: ${message}`);
  process.exit(1);
}

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    const info = await lstat(full);

    if (info.isSymbolicLink()) {
      fail(`link simbólico não permitido: ${relative}`);
    }

    if (info.isDirectory()) {
      files.push(...await walk(full, relative));
    } else if (info.isFile()) {
      files.push(relative);
    } else {
      fail(`entrada não regular no staging: ${relative}`);
    }
  }

  return files;
}

const files = (await walk(dist)).sort();

if (!files.includes("index.html")) fail("index.html ausente.");
if (!files.includes("assets/css/app.css")) fail("assets/css/app.css ausente.");
if (!files.includes("assets/js/app.js")) fail("assets/js/app.js ausente.");
if (!files.includes("assets/js/entitlement-verifier.js")) {
  fail("assets/js/entitlement-verifier.js ausente.");
}

for (const file of files) {
  if (file === "index.html" || file.startsWith("assets/")) continue;
  fail(`arquivo fora da allowlist: ${file}`);
}

const forbidden = [
  "worker/",
  "docs/",
  "scripts/",
  "firebase.json",
  ".firebaserc",
  "firestore.rules",
  "storage.rules",
  "CNAME",
  "README.md",
  "CHANGELOG.md"
];

for (const item of forbidden) {
  if (files.some(file => file === item || file.startsWith(item))) {
    fail(`artefato interno foi incluído: ${item}`);
  }
}

const app = await readFile(path.join(dist, "assets/js/app.js"), "utf8");

if (!/const API_BASE = window\.location\.origin;/.test(app)) {
  fail("frontend deve usar window.location.origin como API base.");
}

if (/workers\.dev|Cloudflare Worker|GitHub Pages/.test(app)) {
  fail("frontend publicado ainda contém dependência operacional legada.");
}

console.log(`Hosting dist OK: ${files.length} arquivos públicos permitidos.`);
