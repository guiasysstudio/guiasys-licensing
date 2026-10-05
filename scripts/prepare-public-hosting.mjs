import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const dist = path.join(root, ".hosting-public-dist");

const indexHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GuiaSys Licensing API</title>
</head>
<body>
  <main>
    <h1>GuiaSys Licensing API</h1>
    <p>Endpoint público do protocolo GSL-v1.</p>
  </main>
</body>
</html>
`;

const notFoundHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — GuiaSys Licensing API</title>
</head>
<body>
  <main>
    <h1>404</h1>
    <p>Recurso não encontrado.</p>
  </main>
</body>
</html>
`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeFile(path.join(dist, "index.html"), indexHtml, "utf8");
await writeFile(path.join(dist, "404.html"), notFoundHtml, "utf8");

console.log("Firebase Hosting public staging preparado como gateway mínimo da API GSL-v1.");
