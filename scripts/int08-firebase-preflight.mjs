// INT-08 — Firebase production gate, GET-only. No license/trial writes.
// Usage: node scripts/int08-firebase-preflight.mjs [--pre|--post]
// --pre: baseline observation; divergence is expected if not yet deployed.
// --post: require deployed admin assets to match the exact local release.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.slice(2).includes("--post") ? "post" : "pre";
if (process.argv.slice(2).some(arg => !["--pre", "--post"].includes(arg)) ||
    process.argv.slice(2).includes("--pre") && process.argv.slice(2).includes("--post")) {
  console.error("Use somente --pre OU --post.");
  process.exit(2);
}

const adminUrl = String(process.env.GUIASYS_ADMIN_BASE ||
  "https://painel.licencas.guiasys.online").replace(/\/$/, "");
const publicUrl = String(process.env.GUIASYS_PUBLIC_BASE ||
  "https://licencas.guiasys.online").replace(/\/$/, "");
for (const base of [adminUrl, publicUrl]) {
  if (!/^https:\/\//.test(base)) throw new Error("A URL deve usar HTTPS.");
}

const report = {
  mode, timestamp: new Date().toISOString(), adminUrl, publicUrl,
  health: [], files: [], checks: [], warnings: [], blockers: []
};

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function request(url) {
  const response = await fetch(url, {
    method: "GET", redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer())
  };
}
function check(condition, message) {
  report.checks.push({ ok: Boolean(condition), description: message });
  if (!condition) report.blockers.push(message);
}

async function health(base, name) {
  try {
    const r = await request(base + "/health");
    const data = JSON.parse(r.bytes.toString("utf8"));
    report.health.push({
      name, status: r.status, ok: data.ok, protocolVersion: data.protocolVersion,
      runtime: data.runtime, apiVersion: data.version || null
    });
    check(r.status === 200 && data.ok === true &&
      data.protocolVersion === "GSL-v1" &&
      data.runtime === "firebase-functions-v2",
      name + ": GET /health deve retornar GSL-v1 de Functions v2");
  } catch (error) {
    check(false, name + ": GET /health falhou: " + String(error.message || error));
  }
}
async function staticFile(base, publicPath, localPath, requiredPost = true) {
  const local = await readFile(path.join(root, localPath));
  const localSha = digest(local);
  try {
    const r = await request(base + publicPath);
    const remoteSha = r.status === 200 ? digest(r.bytes) : null;
    const match = r.status === 200 && remoteSha === localSha;
    const result = {
      url: base + publicPath,
      status: r.status,
      contentType: r.headers.get("content-type") || "",
      localSha256: localSha, deployedSha256: remoteSha, matchesLocalRelease: match
    };
    report.files.push(result);
    if (mode === "post" && requiredPost) {
      check(match, "Arquivo publicado não corresponde ao release: " + publicPath);
    } else if (!match) {
      report.warnings.push("Diferença antes do deploy (esperada): " + publicPath);
    }
  } catch (error) {
    report.files.push({
      url: base + publicPath, localSha256: localSha,
      error: String(error.message || error), matchesLocalRelease: false
    });
    if (mode === "post" && requiredPost) {
      check(false, "Arquivo inacessível após deploy: " + publicPath);
    } else {
      report.warnings.push("Arquivo indisponível antes do deploy: " + publicPath);
    }
  }
}

await health(adminUrl, "Painel administrativo");
await health(publicUrl, "Site público");
for (const [url, label] of [[adminUrl, "Painel"], [publicUrl, "Público"]]) {
  try {
    const r = await request(url + "/");
    check(r.status === 200 && /text\/html/i.test(r.headers.get("content-type") || ""),
      label + ": HTML principal acessível por HTTPS");
    const xcto = (r.headers.get("x-content-type-options") || "").toLowerCase();
    check(xcto === "nosniff", label + ": header X-Content-Type-Options=nosniff");
  } catch (error) {
    check(false, label + ": HTML inacessível: " + String(error.message || error));
  }
}

// Validates exact browser-facing files of the candidate release.
// No request can create orders, trials, license activations or admin mutations.
await staticFile(adminUrl, "/assets/js/app.js", "assets/js/app.js");
await staticFile(adminUrl, "/assets/js/entitlement-verifier.js",
  "assets/js/entitlement-verifier.js");
await staticFile(adminUrl, "/assets/js/integration-contract-support.js",
  "assets/js/integration-contract-support.js");

// Public checkout code should not be deployed by an integration-only release.
// If it differs from the local baseline, record the evidence without changing it.
await staticFile(publicUrl, "/assets/catalog.js", "public/assets/catalog.js", false);

report.warnings.push(
  "Este GET-only smoke não comprova qual revisão Cloud Run/Functions está servindo a API."
);
report.warnings.push(
  "A cadeia X-Forwarded-For e falsos HTTP 429 exigem homologação com clientes reais e ambiente isolado."
);
report.warnings.push(
  "Não são executados POSTs: nenhuma licença ou trial é alterado."
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.blockers.length ? 1 : 0;
