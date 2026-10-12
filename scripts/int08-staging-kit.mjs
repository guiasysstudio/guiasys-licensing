// INT-08.4: build a strictly isolated Firebase staging artifact. NO CLOUD CALLS.
// Running this tool never deploys, alters .firebaserc or touches production dist.
import { readFile, writeFile, copyFile, cp, mkdir, rm, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagingDir = path.join(root, ".int08-staging");
const marker = path.join(stagingDir, ".int08-generated");
const mode = process.argv[2] || "";
if (!["--check", "--build", "--verify"].includes(mode) || process.argv.length !== 3) {
  throw Error("Use: node scripts/int08-staging-kit.mjs --check|--build|--verify");
}
const production = "guiasys-licensing";
const project = String(process.env.GUIASYS_STAGE_PROJECT_ID || "").trim();
const publicSite = String(process.env.GUIASYS_STAGE_PUBLIC_SITE || "").trim();
const adminSite = String(process.env.GUIASYS_STAGE_ADMIN_SITE || "").trim();
const configFile = String(process.env.GUIASYS_STAGE_WEB_CONFIG_FILE || "").trim();

function ensure(ok, message) { if (!ok) throw Error("INT-08.4 BLOCKED: " + message); }
function validSite(value) {
  return /^[a-z][a-z0-9-]{3,62}$/.test(value) && !value.endsWith("-");
}
ensure(/^guiasys-licensing-(?:hml|staging|test)(?:-[a-z0-9]+)*$/.test(project),
  "Exige ID de projeto de homologação separado: guiasys-licensing-hml (ou -staging/-test).");
ensure(project !== production, "Projeto de produção proibido.");
ensure(validSite(publicSite) && validSite(adminSite) &&
  publicSite === project && adminSite === project + "-admin" &&
  publicSite !== adminSite,
  "Sites devem ser o padrão deste projeto: <stage-project> e <stage-project>-admin.");
ensure(Boolean(configFile), "Informe GUIASYS_STAGE_WEB_CONFIG_FILE fora do repositório.");
const configPath = path.resolve(configFile);
const sourceFolder = await realpath(root);
ensure(!configPath.startsWith(sourceFolder + path.sep) &&
  !configPath.startsWith(stagingDir + path.sep),
  "Web config de teste deve permanecer fora do repositório (e do artefato gerado).");
const webConfig = JSON.parse(await readFile(configPath, "utf8"));
for (const key of ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"]) {
  ensure(typeof webConfig[key] === "string" && webConfig[key].length > 3,
    "Configuração do Firebase Web de homologação incompleta: " + key);
}
ensure(webConfig.projectId === project, "Web config aponta para outro projeto.");
ensure(webConfig.authDomain === project + ".firebaseapp.com",
  "authDomain deve ser o do projeto isolado; não reutilize o Auth de produção.");
ensure([project + ".firebasestorage.app", project + ".appspot.com"]
  .includes(webConfig.storageBucket), "Storage bucket deve pertencer ao projeto isolado.");
ensure(webConfig.messagingSenderId !== "854287499951" &&
  webConfig.appId !== "1:854287499951:web:0369b194e7663a9d9c0a5a" &&
  webConfig.apiKey !== "AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00",
  "Firebase Web config reutiliza identificadores reais de produção.");
ensure(/^[0-9]+$/.test(webConfig.messagingSenderId) &&
  webConfig.appId.startsWith("1:" + webConfig.messagingSenderId + ":web:"),
  "messagingSenderId/appId são incompatíveis.");

const urls = {
  public: "https://" + publicSite + ".web.app",
  admin: "https://" + adminSite + ".web.app",
  auth: "https://" + webConfig.authDomain
};
const normalizedConfig = Object.fromEntries([
  "apiKey", "authDomain", "projectId", "storageBucket",
  "messagingSenderId", "appId"
].map(key => [key, webConfig[key]]));
const cfgHash = createHash("sha256")
  .update(JSON.stringify({ project, publicSite, adminSite, normalizedConfig }))
  .digest("hex");

async function assertGenerated() {
  const saved = JSON.parse(await readFile(marker, "utf8"));
  ensure(saved.project === project && saved.configHash === cfgHash,
    "Artefato compilado difere da configuração de homologação escolhida.");
  const generated = JSON.parse(await readFile(path.join(stagingDir, "firebase.json"), "utf8"));
  ensure(generated.functions.source === ".int08-staging/worker",
    "Functions do estágio devem usar cópia isolada, não worker/ de produção.");
  ensure(generated.hosting.length === 2 &&
    generated.hosting.some(x => x.site === publicSite) &&
    generated.hosting.some(x => x.site === adminSite) &&
    generated.hosting.every(x => !("target" in x)),
    "Sites compilados não estão isolados.");
  const publicJs = await readFile(path.join(stagingDir, "hosting-public/assets/catalog.js"), "utf8");
  const adminJs = await readFile(path.join(stagingDir, "hosting-admin/assets/js/app.js"), "utf8");
  const stageBackend = await readFile(path.join(stagingDir, "worker/src/index.js"), "utf8");
  for (const [name, text] of [["catalog",publicJs],["admin",adminJs]]) {
    ensure(text.includes('"projectId":"' + project + '"'), name + " não usa o Auth do estágio.");
    ensure(!text.includes("AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00") &&
      !text.includes('authDomain: "guiasys-licensing.firebaseapp.com"'),
      name + " ainda contém configuração do Firebase real.");
  }
  ensure(adminJs.includes("const PUBLIC_API_BASE = " + JSON.stringify(urls.public)),
    "Admin de teste enviaria chamadas à API pública de produção.");
  ensure(stageBackend.includes(JSON.stringify(urls.admin)) &&
    stageBackend.includes(JSON.stringify(urls.public)) &&
    !stageBackend.includes('"https://licencas.guiasys.online"'),
    "Backend deve aceitar somente origem do Hosting isolado.");
}
if (mode === "--check") {
  console.log("INT-08.4: configuração isolada válida; NENHUM arquivo gerado e NENHUM deploy.");
  process.exit(0);
}
if (mode === "--verify") {
  await assertGenerated();
  console.log("INT-08.4: artefatos locais isolados validados. NENHUM deploy.");
  process.exit(0);
}

try {
  await stat(stagingDir);
  // Never delete a directory unless this exact tool created it before.
  const previous = JSON.parse(await readFile(marker, "utf8"));
  ensure(previous?.project === project, "Pasta de staging já pertence a outro projeto.");
  await rm(stagingDir, { recursive: true, force: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(stagingDir, { recursive: true });
await mkdir(path.join(stagingDir, "hosting-admin"), { recursive: true });
await mkdir(path.join(stagingDir, "hosting-public"), { recursive: true });
await mkdir(path.join(stagingDir, "worker/src"), { recursive: true });
await cp(path.join(root, "assets"), path.join(stagingDir, "hosting-admin/assets"),
  { recursive: true });
await cp(path.join(root, "public/assets/brand"), path.join(stagingDir, "hosting-admin/assets/brand"),
  { recursive: true, force: true });
await cp(path.join(root, "public/assets"), path.join(stagingDir, "hosting-public/assets"),
  { recursive: true });
await cp(path.join(root, "worker/src"), path.join(stagingDir, "worker/src"),
  { recursive: true });
for (const [src, dest] of [
  ["index.html", "hosting-admin/index.html"],
  ["public/index.html", "hosting-public/index.html"],
  ["public/404.html", "hosting-public/404.html"],
  ["worker/package.json", "worker/package.json"]
]) await copyFile(path.join(root, src), path.join(stagingDir, dest));
try {
  await copyFile(path.join(root, "worker/package-lock.json"),
    path.join(stagingDir, "worker/package-lock.json"));
} catch (error) { if (error?.code !== "ENOENT") throw error; }

function replaceOne(text, needle, replacement, label) {
  ensure(text.split(needle).length === 2, "Marcador inesperado: " + label);
  return text.replace(needle, replacement);
}
function replaceConfig(text, label) {
  const expr = /const firebaseConfig = \{[\s\S]*?\};/g;
  const matches = [...text.matchAll(expr)];
  ensure(matches.length === 1, "firebaseConfig não é único em " + label);
  return text.replace(expr, "const firebaseConfig = " + JSON.stringify(normalizedConfig) + ";");
}
const adminJsPath = path.join(stagingDir, "hosting-admin/assets/js/app.js");
let adminJs = replaceConfig(await readFile(adminJsPath, "utf8"), "Admin");
adminJs = replaceOne(adminJs,
  'const PUBLIC_API_BASE = "https://licencas.guiasys.online";',
  "const PUBLIC_API_BASE = " + JSON.stringify(urls.public) + ";", "PUBLIC_API_BASE");
await writeFile(adminJsPath, adminJs, "utf8");

const catalogJsPath = path.join(stagingDir, "hosting-public/assets/catalog.js");
let catalogJs = replaceConfig(await readFile(catalogJsPath, "utf8"), "Catálogo");
catalogJs = replaceOne(catalogJs,
  '"guiasys-licensing.firebasestorage.app", "guiasys-licensing.appspot.com"',
  JSON.stringify(project + ".firebasestorage.app") + ", " +
    JSON.stringify(project + ".appspot.com"), "Storage público");
await writeFile(catalogJsPath, catalogJs, "utf8");

const backendPath = path.join(stagingDir, "worker/src/index.js");
let backendJs = await readFile(backendPath, "utf8");
const first = backendJs.indexOf("const ALLOWED_ORIGINS = [");
const last = backendJs.indexOf("];", first);
ensure(first >= 0 && last > first, "ALLOWED_ORIGINS ausente.");
const replacements = [
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5500",
  "http://localhost:5501",
  urls.public, urls.admin,
  "https://" + publicSite + ".firebaseapp.com",
  "https://" + adminSite + ".firebaseapp.com"
];
backendJs = backendJs.slice(0, first) +
  "const ALLOWED_ORIGINS = " + JSON.stringify(replacements, null, 2) + ";" +
  backendJs.slice(last + 2);
// Static image origins must also be isolated: otherwise sample projects could
// retain trusted production asset links while their data lives in staging.
const imageHostsBegin = backendJs.indexOf("const allowedHosts = new Set([");
const imageHostsEnd = backendJs.indexOf("]);", imageHostsBegin);
ensure(imageHostsBegin >= 0 && imageHostsEnd > imageHostsBegin,
  "Allowlist de URLs estáticas não encontrada.");
const imageHosts = [publicSite + ".web.app", adminSite + ".web.app",
  publicSite + ".firebaseapp.com", adminSite + ".firebaseapp.com"];
backendJs = backendJs.slice(0, imageHostsBegin) +
  "const allowedHosts = new Set(" + JSON.stringify(imageHosts) + ");" +
  backendJs.slice(imageHostsEnd + 3);
const originStart = backendJs.indexOf("function isInternalHostingOrigin(origin) {");
const originEnd = backendJs.indexOf("function assertProjectOrigin(", originStart);
ensure(originStart >= 0 && originEnd > originStart, "Regra de origens do projeto mudou.");
backendJs = backendJs.slice(0, originStart) +
  "function isInternalHostingOrigin(origin) {\n" +
  "  return !origin || ALLOWED_ORIGINS.includes(origin);\n" +
  "}\n\n" + backendJs.slice(originEnd);
await writeFile(backendPath, backendJs, "utf8");

const firebaseJson = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
firebaseJson.functions.source = ".int08-staging/worker";
// Staging predeploy never repackages the live source. Verify prepared content first.
firebaseJson.functions.predeploy = [
  "node scripts/int08-staging-kit.mjs --verify",
  "npm --prefix worker test",
  "npm --prefix worker run check"
];
for (const item of firebaseJson.hosting) {
  const isAdmin = item.target === "admin";
  ensure(isAdmin || item.target === "public", "Hosting target desconhecido.");
  item.site = isAdmin ? adminSite : publicSite;
  item.public = isAdmin ? ".int08-staging/hosting-admin" : ".int08-staging/hosting-public";
  delete item.target;
  item.predeploy = ["node scripts/int08-staging-kit.mjs --verify"];
  for (const rule of item.headers || []) {
    for (const header of rule.headers || []) {
      if (header.key === "Content-Security-Policy") {
        header.value = header.value.replaceAll(
          "https://guiasys-licensing.firebaseapp.com", urls.auth);
      }
    }
  }
}
await writeFile(path.join(stagingDir, "firebase.json"),
  JSON.stringify(firebaseJson, null, 2) + "\n");
await writeFile(marker, JSON.stringify({ project, configHash: cfgHash,
  sites: [publicSite, adminSite], builtAt: new Date().toISOString() }, null, 2));
await assertGenerated();
console.log("INT-08.4: build LOCAL de staging APROVADO; nenhum comando Firebase executado.");
console.log("Projeto:", project, "| Sites:", publicSite, "e", adminSite);
console.log("Config gerada em .int08-staging/firebase.json. NAO FAÇA DEPLOY sem gate externo.");
