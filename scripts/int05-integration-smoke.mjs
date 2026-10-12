// INT-08.3: STAGING ONLY. POST /project/config can lazily write
// integration metadata for legacy projects. Never run against production,
// including its Firebase Hosting preview channels.
const apiBase = String(process.env.GUIASYS_INTEGRATION_API_BASE || "").replace(/\/$/, "");
const adminBase = String(process.env.GUIASYS_INTEGRATION_ADMIN_BASE || "").replace(/\/$/, "");
const integrationCode = String(process.env.GUIASYS_INTEGRATION_CODE || "").trim();
const expectedStageProject = String(process.env.GUIASYS_INTEGRATION_EXPECTED_PROJECT || "").trim();

function ensure(condition, message) {
  if (!condition) throw new Error("INT-05 smoke: " + message);
}
ensure(/^https:\/\//.test(apiBase) && /^https:\/\//.test(adminBase),
  "Informe explicitamente os dois endereços do ambiente isolado usando HTTPS.");
ensure(process.env.GUIASYS_INTEGRATION_STAGE_ACK === "ISOLATED_TEST_PROJECT",
  "Confirme explicitamente GUIASYS_INTEGRATION_STAGE_ACK=ISOLATED_TEST_PROJECT.");
ensure(/^guiasys-licensing-(?:hml|staging|test)(?:-[a-z0-9]+)*$/.test(expectedStageProject),
  "Informe GUIASYS_INTEGRATION_EXPECTED_PROJECT do Firebase de homologação.");
for (const base of [apiBase, adminBase]) {
  const hostname = new URL(base).hostname.toLowerCase();
  // Preview Hosting channels in the production Firebase project share the
  // production backend; do NOT treat them as an isolated staging project.
  ensure(
    !/^(?:painel\.)?licencas\.guiasys\.online$/.test(hostname) &&
    !/^guiasys-licensing(?:-admin)?(?:--[a-z0-9-]+)?\.(?:web\.app|firebaseapp\.com)$/.test(hostname) &&
    !hostname.startsWith("licensingapi-"),
    "Não use URLs, aliases ou canais de preview do projeto Firebase de produção."
  );
}
ensure(/^GSLI-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(integrationCode),
  "Informe GUIASYS_INTEGRATION_CODE de um projeto ativo, sem incluir a License Key.");

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000)
  });
  ensure(response.ok, url + ": HTTP " + response.status);
  return response;
}
async function json(url, options = {}) {
  const response = await request(url, options);
  ensure(/application\/json/.test(response.headers.get("content-type") || ""),
    "Content-Type JSON ausente em " + url);
  return await response.json();
}
const health = await json(apiBase + "/health");
ensure(health.ok === true && health.protocolVersion === "GSL-v1" &&
  health.runtime === "firebase-functions-v2",
  "Health não corresponde ao servidor GSL-v1 Firebase esperado.");
ensure(typeof health.firebaseProject === "string" &&
  health.firebaseProject !== "guiasys-licensing",
  "O projeto Firebase consultado deve ser ISOLADO de guiasys-licensing.");
ensure(health.firebaseProject === expectedStageProject,
  "A API está servindo um projeto diferente daquele autorizado para homologação.");
const adminHealth = await json(adminBase + "/health");
ensure(adminHealth.firebaseProject === health.firebaseProject,
  "Admin e API devem apontar para o MESMO projeto Firebase de homologação.");

const response = await json(apiBase + "/api/v1/project/config", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ integrationCode })
});
const project = response.project;
ensure(response.ok === true && project?.integrationCode === integrationCode,
  "Resposta de integração não corresponde ao produto consultado.");
ensure(project.protocolVersion === "GSL-v1", "Protocolo da configuração divergente.");
ensure(project.signing?.algorithm === "ES256" && project.signing?.keyId,
  "Algoritmo/keyId inválidos.");
const jwk = project.signing.publicJwk;
ensure(jwk && jwk.kty === "EC" && jwk.crv === "P-256" &&
  typeof jwk.x === "string" && typeof jwk.y === "string",
  "Chave pública P-256 incompleta.");
const allowed = ["kty", "crv", "x", "y", "ext", "key_ops"];
ensure(Object.keys(jwk).every(key => allowed.includes(key)),
  "JWK pública contém campos inesperados ou privados.");
ensure(!Object.hasOwn(jwk, "d"), "Material privado presente na JWK pública.");
const publicKey = await crypto.subtle.importKey(
  "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
);
ensure(publicKey.type === "public", "Chave pública não importável.");
ensure(Number.isInteger(project.trial?.validationHours) &&
  Number.isInteger(project.license?.validationHours),
  "Configurações dinâmicas ausentes.");
const endpoints = [
  "/api/v1/project/config",
  "/api/v1/trial/start",
  "/api/v1/trial/validate",
  "/api/v1/license/activate",
  "/api/v1/license/validate",
  "/api/v1/license/deactivate"
];
for (const path of endpoints) {
  const preflight = await fetch(apiBase + path, {
    method: "OPTIONS",
    redirect: "error",
    signal: AbortSignal.timeout(12_000)
  });
  ensure(preflight.status === 204, "Preflight incorreto em " + path);
}
const [moduleResponse, appResponse] = await Promise.all([
  request(adminBase + "/assets/js/integration-contract-support.js"),
  request(adminBase + "/assets/js/app.js")
]);
const [moduleText, appText] = await Promise.all([
  moduleResponse.text(), appResponse.text()
]);
ensure(moduleText.includes("normalizePublicSigningJwk") &&
  moduleText.includes("integrationResponseExamples"),
  "Módulo de contratos INT-03 não publicado no painel.");
ensure(appText.includes("integration-contract-support.js") &&
  appText.includes("Copiar integração completa"),
  "Painel não contém o gerador de integração atualizado.");

console.log("INT-05: smoke de integração APROVADO (sem operações de licença).");
console.log("Projeto:", project.name, "| Protocolo:", project.protocolVersion);
console.log("Assinatura:", project.signing.algorithm, "| Key ID:", project.signing.keyId);
console.log("Endpoints conferidos:", endpoints.length);
console.log("Nenhuma licença/trial foi ativada ou modificada.");
