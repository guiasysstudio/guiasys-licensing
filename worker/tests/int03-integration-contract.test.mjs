import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  integrationResponseExamples,
  normalizePublicSigningJwk
} from "../../assets/js/integration-contract-support.js";

const source = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");
const start = source.indexOf("function integrationPlatformNotes(");
const end = source.indexOf("async function integrationView()", start);
assert.ok(start >= 0 && end > start, "Funções do gerador não encontradas");

const generator = Function(
  "PROTOCOL_VERSION", "PUBLIC_API_BASE",
  "normalizePublicSigningJwk", "integrationResponseExamples",
  `${source.slice(start, end)}; return { buildIntegrationConfig, buildIntegrationContract };`
)("GSL-v1", "https://licencas.guiasys.online",
  normalizePublicSigningJwk, integrationResponseExamples);

const project = {
  id: "prj_0123456789abcdefabcd",
  name: "GuiaPlay",
  prefix: "GPL",
  integrationCode: "GSLI-ABCD-EFGH-JKLM",
  signingAlgorithm: "ES256",
  signingKeyId: "sig_int03",
  signingPublicJwk: {
    kty: "EC", crv: "P-256", x: "exemploX", y: "exemploY",
    d: "SIMULACAO_PRIVADA_NAO_REPASSAR", p: null, q: null, n: null, e: null,
    ext: true, key_ops: ["verify"]
  },
  allowedOrigins: [],
  trialEnabled: true,
  trialDays: 7,
  trialValidationHours: 24,
  trialOfflineHours: 64,
  validationHours: 24,
  offlineDays: 15
};

test("INT-03: extrai somente campos públicos ES256 da JWK", () => {
  const jwk = normalizePublicSigningJwk(project.signingPublicJwk);
  assert.deepEqual(Object.keys(jwk), ["kty", "crv", "x", "y", "ext", "key_ops"]);
  assert.equal(jwk.d, undefined);
  assert.equal(jwk.p, undefined);
  assert.equal(jwk.q, undefined);
  assert.equal(normalizePublicSigningJwk(null), null);
  assert.equal(normalizePublicSigningJwk({ ...jwk, crv: "P-384" }), null);
});

test("INT-03: JSON copiado pelo painel não vaza material privado ou campos nulos da JWK", () => {
  const config = generator.buildIntegrationConfig(project);
  assert.equal(config.signing.keyId, project.signingKeyId);
  assert.deepEqual(Object.keys(config.signing.publicJwk), ["kty", "crv", "x", "y", "ext", "key_ops"]);
  assert.equal(config.signing.publicJwk.d, undefined);
  assert.equal(config.trial.offlineHours, 64);
  assert.equal(config.license.offlineDays, 15);
  assert.equal(config.endpoints.deactivate, "/api/v1/license/deactivate");
});

test("INT-03: todos os contratos citam os seis endpoints e o protocolo vigente", () => {
  for (const platform of ["universal", "dotnet", "web", "android", "ios", "flutter"]) {
    const contract = generator.buildIntegrationContract(project, platform);
    assert.ok(contract.includes("Protocolo: GSL-v1"), platform);
    assert.ok(contract.includes(project.integrationCode), platform);
    for (const path of Object.values(generator.buildIntegrationConfig(project).endpoints)) {
      assert.ok(contract.includes(path), `${platform}: endpoint ${path}`);
    }
    assert.ok(contract.includes("EXEMPLOS DE RESPOSTAS JSON"), platform);
    assert.ok(contract.includes("project_selector_mismatch"), platform);
    assert.ok(contract.includes("device_bound_to_other_license"), platform);
    assert.ok(contract.includes("HTTP 429"), platform);
    assert.ok(contract.includes("offlineUntil"), platform);
    assert.ok(contract.includes("rotação"), platform);
    assert.equal(contract.includes("SIMULACAO_PRIVADA_NAO_REPASSAR"), false, platform);
    assert.ok(contract.includes("NÃO SÃO DADOS OPERACIONAIS"), platform);
  }
});

test("INT-03: contrato Windows explica .NET 10, verificação criptográfica e armazenamento", () => {
  const dotnet = generator.buildIntegrationContract(project, "dotnet");
  assert.ok(dotnet.includes(".NET 10"));
  assert.ok(dotnet.includes("ECDsa"));
  assert.ok(dotnet.includes("P1363"));
  assert.ok(dotnet.includes("DPAPI/ProtectedData"));
  assert.ok(dotnet.includes("reinstalações"));
  const web = generator.buildIntegrationContract(project, "web");
  assert.ok(web.includes("LocalStorage/IndexedDB"));
  const flutter = generator.buildIntegrationContract(project, "flutter");
  assert.ok(flutter.includes("Keychain"));
  assert.ok(flutter.includes("Keystore"));
});

test("INT-03: exemplos ilustrativos preservam envelopes reais dos seis endpoints", () => {
  const examples = integrationResponseExamples(project, "GSL-v1");
  assert.match(examples, /NÃO SÃO DADOS OPERACIONAIS/);
  for (const key of ["project", "trial", "license", "result", "error", "retryAfterSeconds"]) {
    assert.ok(examples.includes(`"${key}"`), key);
  }
  assert.ok(examples.includes("HTTP 200 — /api/v1/license/deactivate"));
  assert.ok(examples.includes("HTTP 200 — /api/v1/trial/start"));
  assert.ok(examples.includes("HTTP 200 — /api/v1/trial/validate"));
  assert.ok(examples.includes("HTTP 200 — /api/v1/project/config"));
  assert.ok(examples.includes("HTTP 200 — /api/v1/license/activate"));
  assert.ok(examples.includes("HTTP 200 — /api/v1/license/validate"));
  assert.equal(examples.includes("SIMULACAO_PRIVADA_NAO_REPASSAR"), false);
  assert.ok(examples.includes("<HEADER.PAYLOAD.ASSINATURA_ES256>"));
});
