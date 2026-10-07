import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const dist = path.join(root, ".hosting-public-dist");

function fail(message) {
  console.error(`Hosting public dist check failed: ${message}`);
  process.exit(1);
}

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    const info = await lstat(full);

    if (info.isSymbolicLink()) fail(`link simbólico não permitido: ${relative}`);
    if (info.isDirectory()) files.push(...await walk(full, relative));
    else if (info.isFile()) files.push(relative);
    else fail(`entrada não regular no staging: ${relative}`);
  }
  return files;
}

const files = (await walk(dist)).sort();
const expected = [
  "404.html",
  "assets/brand/README.md",
  "assets/brand/guiasys-licensing-lockup.svg",
  "assets/brand/guiasys-licensing-symbol.svg",
  "assets/brand/guiasys-licensing-wordmark.svg",
  "assets/catalog.css",
  "assets/catalog.js",
  "index.html"
];

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  fail(`arquivo fora da allowlist: ${files.join(", ") || "(vazia)"}`);
}

const index = await readFile(path.join(dist, "index.html"), "utf8");
const app = await readFile(path.join(dist, "assets/catalog.js"), "utf8");
if (!/GuiaSys Licensing/.test(index) || !/id="app"/.test(index)) {
  fail("index público deve identificar a loja e o shell SPA GuiaSys Licensing.");
}
if (!/fetch\("\/api\/v1\/catalog"/.test(app)) {
  fail("frontend público deve consumir GET /api/v1/catalog pelo mesmo origin.");
}
if (/innerHTML|insertAdjacentHTML|document\.write/.test(app)) {
  fail("renderização do catálogo deve evitar APIs de HTML inseguras.");
}
if (!/customer-storefront/.test(app) || /entitlement-verifier/.test(index + app)) {
  fail("artefatos administrativos não podem integrar o frontend público.");
}

console.log(`Hosting public dist OK: ${files.length} arquivos do catálogo permitidos.`);
