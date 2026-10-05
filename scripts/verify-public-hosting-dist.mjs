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
const expected = ["404.html", "index.html"];

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  fail(`allowlist inválida: ${files.join(", ") || "(vazia)"}`);
}

const index = await readFile(path.join(dist, "index.html"), "utf8");
if (!/GuiaSys Licensing API/.test(index) || !/GSL-v1/.test(index)) {
  fail("index público deve identificar a API e o protocolo GSL-v1.");
}
if (/<script\b|<iframe\b|<object\b|<embed\b/i.test(index)) {
  fail("gateway público não deve executar conteúdo ativo.");
}

console.log("Hosting public dist OK: gateway mínimo sem artefatos administrativos.");
