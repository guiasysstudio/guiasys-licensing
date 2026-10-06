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

async function expectAsset(base, path, contentType) {
  const response = await request(`${base}${path}`);
  if (!response.ok) fail(`${base}${path}: HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!contentType.test(type)) fail(`${base}${path}: Content-Type inesperado: ${type || "(ausente)"}`);
  return response.text();
}

const adminHome = await request(`${ADMIN_BASE}/`);
if (!adminHome.ok) fail(`painel: HTTP ${adminHome.status}`);

const html = await adminHome.text();
if (!/GuiaSys Licensing/i.test(html) || !/id="login-screen"/i.test(html)) {
  fail("painel: HTML esperado não encontrado.");
}

const [adminCss, adminJs, entitlementJs] = await Promise.all([
  expectAsset(ADMIN_BASE, "/assets/css/app.css", /text\/css/i),
  expectAsset(ADMIN_BASE, "/assets/js/app.js", /javascript/i),
  expectAsset(ADMIN_BASE, "/assets/js/entitlement-verifier.js", /javascript/i)
]);
if (!adminCss || !entitlementJs || !/Pedidos/i.test(adminJs) || !/Configurações/i.test(adminJs)) {
  fail("painel: assets ou módulos administrativos esperados não encontrados.");
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
  version: "2.1.0",
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

const unauthenticatedAdmin = await request(`${ADMIN_BASE}/api/v1/admin/me`);
if (unauthenticatedAdmin.status !== 401) {
  fail(`painel: rota administrativa sem autenticação retornou HTTP ${unauthenticatedAdmin.status}.`);
}

const publicHealth = await expectJson(`${PUBLIC_BASE}/health`);
if (
  publicHealth.body?.ok !== true ||
  publicHealth.body?.protocolVersion !== "GSL-v1" ||
  publicHealth.body?.runtime !== "firebase-functions-v2"
) {
  fail("domínio público /health não está encaminhando para o runtime Firebase esperado.");
}

const unauthenticatedCustomer = await request(`${PUBLIC_BASE}/api/v1/customer/orders`);
if (unauthenticatedCustomer.status !== 401) {
  fail(`site público: rota do cliente sem autenticação retornou HTTP ${unauthenticatedCustomer.status}.`);
}

const publicHome = await request(`${PUBLIC_BASE}/`);
if (!publicHome.ok) fail(`site público: HTTP ${publicHome.status}`);
const publicHtml = await publicHome.text();
const [publicCss, publicJs] = await Promise.all([
  expectAsset(PUBLIC_BASE, "/assets/catalog.css", /text\/css/i),
  expectAsset(PUBLIC_BASE, "/assets/catalog.js", /javascript/i)
]);
if (
  !publicCss ||
  !/id="catalog"/i.test(publicHtml) ||
  !/id="checkout"/i.test(publicHtml) ||
  !/id="pix-payment"/i.test(publicHtml) ||
  !/Minhas Compras/i.test(publicHtml) ||
  !/PIX manual/i.test(publicHtml)
) {
  fail("site público: home/checkout PIX esperados não encontrados.");
}
if (/pagbank|cartão|boleto/i.test(`${publicHtml}\n${publicJs}`)) {
  fail("site público: método de pagamento congelado apareceu no frontend.");
}

const catalog = await expectJson(`${PUBLIC_BASE}/api/v1/catalog`);
if (
  catalog.body?.ok !== true ||
  catalog.body?.catalog?.protocolVersion !== "GSL-v1" ||
  !Array.isArray(catalog.body?.catalog?.projects)
) {
  fail("catálogo público não respeita o envelope da API nem o contrato GSL-v1.");
}

const paymentConfig = await expectJson(`${PUBLIC_BASE}/api/v1/payment-config`);
if (
  paymentConfig.body?.ok !== true ||
  paymentConfig.body?.payment?.paymentProvider !== "manual_pix" ||
  paymentConfig.body?.payment?.pixEnabled !== true ||
  paymentConfig.body?.payment?.pixKeyType !== "EVP" ||
  paymentConfig.body?.payment?.manualConfirmationEnabled !== true
) {
  fail("configuração pública não está operando exclusivamente com PIX manual.");
}

const frozenWebhook = await request(`${PUBLIC_BASE}/api/v1/webhooks/pagbank`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});
const frozenWebhookBody = await frozenWebhook.json().catch(() => ({}));
if (frozenWebhook.status !== 404 || frozenWebhookBody?.error !== "pagbank_disabled") {
  fail("webhook PagBank não está congelado.");
}

console.log("Production smoke OK.");
console.log(`Admin:  ${ADMIN_BASE}`);
console.log(`Public: ${PUBLIC_BASE}`);
console.log(`Catalog projects: ${catalog.body.catalog.projects.length}`);
console.log("Payment provider: manual_pix; PagBank disabled.");
