const ADMIN_BASE = String(
  process.env.GUIASYS_ADMIN_BASE || "https://painel.licencas.guiasys.online"
).replace(/\/$/, "");
const PUBLIC_BASE = String(
  process.env.GUIASYS_PUBLIC_BASE || "https://licencas.guiasys.online"
).replace(/\/$/, "");

function fail(message) {
  console.error(`Production smoke failed: ${message}`);
  process.exit(1);
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    return await fetch(url, {
      ...options,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    fail(`${url}: ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function expectJson(url) {
  const response = await request(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);

  const type = response.headers.get("content-type") || "";
  if (!/application\/json/i.test(type)) {
    fail(`${url}: Content-Type inesperado: ${type || "(ausente)"}`);
  }

  try {
    return { response, body: await response.json() };
  } catch {
    fail(`${url}: resposta JSON inválida.`);
  }
}

const adminHome = await request(`${ADMIN_BASE}/`);
if (!adminHome.ok) fail(`painel: HTTP ${adminHome.status}`);

const html = await adminHome.text();
if (!/GuiaSys Licensing/i.test(html)) {
  fail("painel: HTML esperado não encontrado.");
}

const requiredHeaders = [
  ["x-content-type-options", value => value.toLowerCase() === "nosniff"],
  ["x-frame-options", value => value.toUpperCase() === "DENY"],
  ["strict-transport-security", value => /max-age=\d+/.test(value)],
  ["cross-origin-opener-policy", value => value === "same-origin-allow-popups"],
  ["content-security-policy", value =>
    /default-src 'self'/.test(value) &&
    /object-src 'none'/.test(value) &&
    /frame-ancestors 'none'/.test(value)
  ]
];

for (const [header, validate] of requiredHeaders) {
  const value = adminHome.headers.get(header) || "";
  if (!value || !validate(value)) {
    fail(`painel: header inválido ou ausente: ${header}`);
  }
}

const adminHealth = await expectJson(`${ADMIN_BASE}/health`);
for (const [field, expected] of Object.entries({
  ok: true,
  service: "guiasys-licensing-api",
  version: "2.0.1",
  protocolVersion: "GSL-v1",
  firebaseProject: "guiasys-licensing",
  runtime: "firebase-functions-v2",
  adminSdkConfigured: true,
  adminConfigured: true,
  offlineEntitlements: "ES256"
})) {
  if (adminHealth.body?.[field] !== expected) {
    fail(`painel /health: ${field} esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(adminHealth.body?.[field])}`);
  }
}

if (adminHealth.body?.serviceAccountConfigured !== false) {
  fail("painel /health: serviceAccountConfigured deve permanecer false.");
}

const publicHealth = await expectJson(`${PUBLIC_BASE}/health`);
if (
  publicHealth.body?.ok !== true ||
  publicHealth.body?.protocolVersion !== "GSL-v1" ||
  publicHealth.body?.runtime !== "firebase-functions-v2"
) {
  fail("domínio público /health não está encaminhando para o runtime Firebase esperado.");
}

const catalog = await expectJson(`${PUBLIC_BASE}/api/v1/catalog`);
if (
  catalog.body?.ok !== true ||
  catalog.body?.catalog?.protocolVersion !== "GSL-v1" ||
  !Array.isArray(catalog.body?.catalog?.projects)
) {
  fail("catálogo público não respeita o envelope da API nem o contrato GSL-v1.");
}

console.log("Production smoke OK.");
console.log(`Admin:  ${ADMIN_BASE}`);
console.log(`Public: ${PUBLIC_BASE}`);
console.log(`Catalog projects: ${catalog.body.catalog.projects.length}`);
