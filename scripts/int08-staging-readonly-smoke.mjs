// INT-08.4 READ-ONLY check of a deployed, isolated Firebase staging project.
// Does NOT use Auth credentials and does NOT submit POSTs, trials, licenses or orders.
const project = String(process.env.GUIASYS_STAGE_PROJECT_ID || "").trim();
const publicSite = String(process.env.GUIASYS_STAGE_PUBLIC_SITE || "").trim();
const adminSite = String(process.env.GUIASYS_STAGE_ADMIN_SITE || "").trim();
function ensure(ok, m) { if (!ok) throw Error("INT-08.4 STAGING BLOCKED: " + m); }
ensure(/^guiasys-licensing-(?:hml|staging|test)(?:-[a-z0-9]+)*$/.test(project),
  "Informe explicitamente o ID do projeto de homologação.");
ensure(publicSite === project && adminSite === project + "-admin",
  "Use exclusivamente os sites Hosting do projeto de homologação.");
const urls = { public: "https://" + publicSite + ".web.app",
  admin: "https://" + adminSite + ".web.app" };
async function get(base, rel) {
  const r = await fetch(base + rel, {
    method: "GET", redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  return { status: r.status, headers: r.headers,
    bytes: await r.text() };
}
const results = [];
for (const [label, base] of Object.entries(urls)) {
  const health = await get(base, "/health");
  ensure(health.status === 200, label + " health HTTP " + health.status);
  const data = JSON.parse(health.bytes);
  ensure(data.ok === true && data.protocolVersion === "GSL-v1" &&
    data.runtime === "firebase-functions-v2" &&
    data.firebaseProject === project,
  label + ": Function conectada ao projeto errado ou com protocolo inválido.");
  const home = await get(base, "/");
  ensure(home.status === 200 &&
    /text\/html/i.test(home.headers.get("content-type") || ""),
    label + ": HTML não publicado.");
  const js = await get(base, label === "admin"
    ? "/assets/js/app.js" : "/assets/catalog.js");
  ensure(js.status === 200, label + ": JS não publicado.");
  ensure(js.bytes.includes('"projectId":"' + project + '"'),
    label + ": browser Firebase SDK conectado a outro projeto.");
  ensure(!js.bytes.includes("AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00") &&
    !js.bytes.includes('"guiasys-licensing.firebasestorage.app"'),
    label + ": arquivos da produção detectados.");
  results.push({ label, url: base, health: health.status,
    firebaseProject: data.firebaseProject, html: home.status, js: js.status });
}
const extra = await get(urls.admin, "/assets/js/integration-contract-support.js");
ensure(extra.status === 200 &&
  extra.bytes.includes("normalizePublicSigningJwk"),
  "Módulo de contrato de integração não foi publicado no Admin de homologação.");
console.log(JSON.stringify({ result: "PASS_READ_ONLY", stage: project, checks: results }, null, 2));
