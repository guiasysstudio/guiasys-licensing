import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");

test("simulador registra cada listener de trial uma única vez", () => {
  assert.equal(
    (source.match(/#trial-test-start"\)\.addEventListener\("click"/g) || []).length,
    1
  );
  assert.equal(
    (source.match(/#trial-test-validate"\)\.addEventListener\("click"/g) || []).length,
    1
  );
});

test("listeners de trial ficam fora do forEach das ações de licença", () => {
  const loopStart = source.indexOf("simulatorButtons.forEach(button =>");
  const loopEnd = source.indexOf("let trialBusy = false;", loopStart);
  const trialHandler = source.indexOf('document.querySelector("#trial-test-start").addEventListener');
  const trialView = source.indexOf("async function trialView()", loopStart);

  assert.ok(loopStart >= 0);
  assert.ok(loopEnd > loopStart);
  assert.ok(trialHandler > loopEnd);
  assert.ok(trialView > trialHandler);

  const loopRegion = source.slice(loopStart, loopEnd);
  assert.equal(loopRegion.includes("#trial-test-start"), false);
  assert.equal(loopRegion.includes("#trial-test-validate"), false);
});

test("simulador usa verificação completa do entitlement", () => {
  assert.match(source, /verifyEntitlementToken\(/);
  assert.match(source, /sha256HexText\(deviceId\)/);
  assert.match(source, /entitlementExpected\(project, type, deviceHash\)/);
});


test("runtime usa cache com TTL, geração e deduplicação de requests", () => {
  assert.match(source, /const CACHE_TTL_MS = 30_000/);
  assert.match(source, /const DASHBOARD_CACHE_TTL_MS = 15_000/);
  assert.match(source, /async function cachedLoad\(/);
  assert.match(source, /state\.inflight\.has\(key\)/);
  assert.match(source, /state\.cacheRequests\.get\(key\)/);
  assert.match(source, /state\.cacheGeneration/);
  assert.equal(source.includes("state.cache.has("), false);
});

test("todas as chamadas HTTP do painel passam pelo timeout centralizado", () => {
  assert.match(source, /async function fetchWithClientTimeout\(/);
  assert.equal((source.match(/\bfetch\(/g) || []).length, 1);
  assert.ok((source.match(/fetchWithClientTimeout\(/g) || []).length >= 6);
  assert.match(source, /const API_TIMEOUT_MS = 12_000/);
});

test("renderContent é serializado e não executa renderizações concorrentes", () => {
  assert.match(source, /async function performRender\(renderId\)/);
  assert.match(source, /state\.renderRunner/);
  assert.match(source, /while \(state\.renderCompleted < state\.renderRequested\)/);
  assert.match(source, /if \(renderId !== state\.renderRequested\) return/);
});

test("modal manager usa pilha, Escape, Tab e não remove backdrop globalmente", () => {
  assert.match(source, /const modalStack = \[\]/);
  assert.match(source, /function registerModal\(/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.equal(source.includes('document.querySelector(".modal-backdrop")?.remove()'), false);
  assert.equal(source.includes('classList.remove("modal-open")'), false);
});

test("bindings de inputs e plano são idempotentes", () => {
  assert.match(source, /maskPhoneBound/);
  assert.match(source, /maskIntegerBound/);
  assert.match(source, /maskPrefixBound/);
  assert.match(source, /maskSlugBound/);
  assert.match(source, /maskCurrencyBound/);
  assert.equal(source.includes('planSelect.addEventListener("change"'), false);
  assert.match(source, /planSelect\.onchange = sync/);
});

test("emissão de licença não carrega planos em duplicidade", () => {
  const functionStart = source.indexOf("function licenseFormHtml(customers, plans)");
  const functionEnd = source.indexOf("async function openLicenseCreate", functionStart);
  assert.ok(functionStart >= 0);
  assert.ok(functionEnd > functionStart);

  const functionSource = source.slice(functionStart, functionEnd);
  assert.equal(functionSource.includes('loadEntity("plans"'), false);
  assert.equal(functionSource.includes('loadEntity("customers"'), false);
});

test("projeto arquivado exige restauração explícita", () => {
  assert.match(source, /project\.status === "archived" \? "disabled" : ""/);
  assert.match(source, /class="btn btn-primary restore-project"/);
  assert.match(source, /Restaurar projeto/);
  assert.match(source, /body: JSON\.stringify\(\{ status: "active" \}\)/);
});

test("ações críticas usam lock de botão e erro comum", () => {
  assert.match(source, /async function runButtonAction\(/);
  assert.ok((source.match(/runButtonAction\(/g) || []).length >= 7);
  assert.match(source, /window\.addEventListener\("unhandledrejection"/);
});


test("frontend usa o próprio domínio como API base e não depende do Worker legado", () => {
  assert.match(source, /const API_BASE = window\.location\.origin;/);
  assert.equal(source.includes("workers.dev"), false);
  assert.equal(source.includes("GitHub Pages"), false);
  assert.equal(source.includes("Cloudflare Workers"), false);
});


test("autenticação do painel usa sessão, Google/e-mail e refresh controlado do ID token", () => {
  assert.match(source, /browserSessionPersistence/);
  assert.match(source, /signInWithPopup\(auth, provider\)/);
  assert.match(source, /signInWithEmailAndPassword\(/);
  assert.match(source, /onAuthStateChanged\(auth/);
  assert.match(source, /signOut\(auth\)/);
  assert.match(source, /getIdToken\(false\)/);
  assert.match(source, /response\.status === 401 && retry/);
  assert.match(source, /getIdToken\(true\)/);
  assert.match(source, /"Authorization": `Bearer \$\{token\}`/);
});

test("manageProjects possui ações de arquivar e restaurar fora das configurações do projeto", () => {
  assert.match(source, /const canLifecycle = hasPermission\("manageProjects"\)/);
  assert.match(source, /archive-project-card/);
  assert.match(source, /\.archive-project-card"\)\?\.addEventListener/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /restore-project/);
  assert.match(source, /JSON\.stringify\(\{ status: "active" \}\)/);
  assert.match(source, /hasPermission\("manageProjects"\)[\s\S]*?id="archive-project"/);
  assert.match(source, /#archive-project"\)\?\.addEventListener/);
});

test("texto publicado referencia API/backend e não chama o runtime principal de Worker", () => {
  assert.equal(source.includes("receberia do Worker"), false);
  assert.equal(source.includes("segredos do Worker"), false);
});


test("contrato de integração usa o domínio público e o painel mantém API administrativa same-origin", () => {
  assert.match(source, /const API_BASE = window\.location\.origin;/);
  assert.match(source, /const PUBLIC_API_BASE = "https:\/\/licencas\.guiasys\.online";/);
  assert.match(source, /apiBaseUrl: PUBLIC_API_BASE/);
  assert.match(source, /`API Base: \$\{PUBLIC_API_BASE\}`/);
  assert.match(source, /`\$\{API_BASE\}\/api\/v1\/admin\/me`/);
});
