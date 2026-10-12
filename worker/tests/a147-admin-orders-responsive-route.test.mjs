import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../../assets/css/app.css", import.meta.url), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `seção não encontrada: ${start}`);
  return source.slice(from, to);
}

const routeRuntimeSource = [
  section(appSource, "function hasPermission(", "function canCreateProjects("),
  section(appSource, "function selectedProject(", "function showScreen(")
].join("\n");

const globalItems = [
  ["dashboard", "dashboard", "Dashboard", "viewDashboard"],
  ["projects", "projects", "Projetos", null],
  ["orders", "plans", "Pedidos", "viewOrders"],
  ["payments", "logs", "Pagamentos", "viewPayments"],
  ["administrators", "users", "Administradores", "master"],
  ["platform-settings", "settings", "Configurações", "managePlatformSettings"]
];

const projectItems = [
  ["project-dashboard", "dashboard", "Dashboard", "viewDashboard"],
  ["customers", "users", "Clientes", "manageCustomers"],
  ["licenses", "key", "Licenças", "manageLicenses"]
];

const PROJECT_A = "prj_81313d3d1ff64a029fb9";
const PROJECT_B = "prj_5034d1b9902a424b8d61";

function administrator(overrides = {}) {
  return {
    master: false,
    allProjects: false,
    projectIds: [PROJECT_A],
    permissions: {
      viewDashboard: true,
      viewOrders: true,
      viewPayments: true,
      manageCustomers: true,
      manageLicenses: false,
      managePlatformSettings: false
    },
    ...overrides
  };
}

function createRouteRuntime({ admin = administrator(), projects, selectedProjectId = "", route = "dashboard" } = {}) {
  const storage = new Map();
  const state = {
    administrator: admin,
    projects: projects || [{ id: PROJECT_A, status: "active" }],
    selectedProjectId,
    route
  };
  const sessionStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  const projectSwitcher = {
    value: "",
    options: [
      { value: "" },
      ...state.projects.filter(project => project.status !== "archived").map(project => ({ value: project.id }))
    ]
  };

  const runtime = Function(
    "state",
    "globalItems",
    "projectItems",
    "sessionStorage",
    "SELECTED_PROJECT_STORAGE_KEY",
    "SELECTED_ROUTE_STORAGE_KEY",
    "el",
    `${routeRuntimeSource}; return {
      routeAllowed,
      routeKind,
      setRoute,
      restoreSelectedRoute,
      setSelectedProject,
      restoreSelectedProject,
      defaultGlobalRoute,
      defaultProjectRoute
    };`
  )(
    state,
    globalItems,
    projectItems,
    sessionStorage,
    "gsl:selected-project",
    "gsl:selected-route",
    { projectSwitcher }
  );

  return { ...runtime, state, storage, projectSwitcher };
}

test("tooltip fechado não cria caixa geométrica e aberto recebe clamp real na viewport", () => {
  const tooltipCss = section(cssSource, ".help-tip {", ".money-input {");
  const tooltipRuntime = section(appSource, "let activeHelpTip", "function fieldTitle(");
  assert.equal(tooltipCss.includes(".help-tip::after"), false);
  assert.match(tooltipCss, /\.help-tooltip\s*\{[^}]*position:\s*fixed/s);
  assert.match(tooltipCss, /max-width:\s*min\(320px,\s*calc\(100vw - 16px\)\)/);
  assert.match(tooltipCss, /max-height:\s*calc\(100dvh - 16px\)/);
  assert.match(tooltipRuntime, /helpTooltipElement\.hidden = true/);
  assert.match(tooltipRuntime, /Math\.min\(Math\.max\(centeredLeft, gutter\), maxLeft\)/);
  assert.match(tooltipRuntime, /window\.innerHeight - tooltipRect\.height - gutter/);
  assert.match(tooltipRuntime, /pointerover/);
  assert.match(tooltipRuntime, /focusin/);
  assert.equal(/body\s*\{[^}]*overflow-x:\s*hidden/s.test(tooltipCss), false);
});

test("alvos compactos crescem apenas em viewport pequena ou pointer coarse", () => {
  const compactRules = section(cssSource, ".btn-sm {", ".badge-success {");
  assert.match(compactRules, /\.btn-sm\s*\{[^}]*min-height:\s*36px/s);
  assert.match(compactRules, /@media \(max-width: 820px\), \(pointer: coarse\)[\s\S]*?\.btn-sm\s*\{[^}]*min-height:\s*44px/s);
});

test("table-scroll contém tabelas largas localmente e continua acessível", () => {
  const rules = section(cssSource, ".table-card {", ".key-button {");
  assert.match(rules, /\.table-card\s*{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(rules, /\.table-scroll\s*{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*hidden/s);
  assert.match(rules, /overscroll-behavior-inline:\s*contain/);
  assert.match(rules, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(rules, /\.table-scroll\s*>\s*table\s*{[^}]*width:\s*max-content[^}]*min-width:\s*100%/s);
  assert.equal(/\.table-scroll[^}]*display:\s*none/s.test(cssSource), false);
  assert.equal(/\.table-scroll[\s\S]*?th[^}]*display:\s*none/.test(rules), false);
  assert.ok((appSource.match(/class="table-scroll" tabindex="0" role="region"/g) || []).length >= 4);
});

test("modal separa rolagem vertical da rolagem horizontal das tabelas", () => {
  const modalRules = section(cssSource, ".modal-card {", ".toast-host {");
  assert.match(modalRules, /\.modal-card\s*{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*display:\s*flex[^}]*overflow:\s*hidden/s);
  assert.match(modalRules, /\.modal-wide\s*{[^}]*width:\s*min\(820px,\s*100%\)[^}]*max-width:\s*100%/s);
  assert.match(modalRules, /\.modal-form\s*{[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(modalRules, /\.modal-body\s*{[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*?\.modal-backdrop\s*{[^}]*padding:\s*12px/);
  assert.match(cssSource, /\.toolbar-actions\s*{[^}]*display:\s*flex/s);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*?\.toolbar-actions\s*{[^}]*flex-direction:\s*column/s);
});

test("Gerar licença e Novo administrador herdam a correção estrutural do modal largo", () => {
  const licenseModal = section(appSource, "async function openLicenseCreate(", "function showGeneratedLicense(");
  const administratorModal = section(appSource, "function openAdmin(", "async function administratorsView(");
  const sharedModal = section(appSource, "function openModal(", "function confirmAction(");

  assert.match(licenseModal, /title:\s*"Gerar licença"[\s\S]*?wide:\s*true/);
  assert.match(administratorModal, /title:\s*admin\s*\?\s*"Editar administrador"\s*:\s*"Novo administrador"[\s\S]*?wide:\s*true/);
  assert.match(sharedModal, /class="modal-card \$\{wide \? "modal-wide" : ""\}"/);
  assert.match(sharedModal, /class="modal-form"/);
  assert.match(sharedModal, /class="modal-body"/);
});

test("setter central persiste Pedidos e Pagamentos", () => {
  const runtime = createRouteRuntime();
  runtime.setRoute("orders");
  assert.equal(runtime.state.route, "orders");
  assert.equal(runtime.storage.get("gsl:selected-route"), "orders");

  runtime.setRoute("payments");
  assert.equal(runtime.state.route, "payments");
  assert.equal(runtime.storage.get("gsl:selected-route"), "payments");
  assert.equal((appSource.match(/state\.route\s*=(?!=)/g) || []).length, 1, "somente o setter pode atribuir route diretamente");
});

test("reload restaura rota global conhecida e autorizada", () => {
  const runtime = createRouteRuntime();
  runtime.storage.set("gsl:selected-route", "orders");
  runtime.restoreSelectedRoute();
  assert.equal(runtime.state.route, "orders");

  const render = section(appSource, "async function performRender(", "async function renderContent(");
  assert.match(render, /orders:\s*ordersView/);
  assert.match(render, /const route = state\.route;\s*await \(routes\[route\] \|\| projectsView\)\(\);/);
});

test("rota global sem permissão e rota desconhecida usam fallback seguro", () => {
  const denied = createRouteRuntime({ admin: administrator({ permissions: { viewDashboard: true, viewOrders: false } }) });
  denied.storage.set("gsl:selected-route", "orders");
  denied.restoreSelectedRoute();
  assert.equal(denied.state.route, "dashboard");
  assert.equal(denied.storage.get("gsl:selected-route"), "dashboard");

  const unknown = createRouteRuntime();
  unknown.storage.set("gsl:selected-route", "firebase-console");
  unknown.restoreSelectedRoute();
  assert.equal(unknown.state.route, "dashboard");
  assert.equal(unknown.routeAllowed("firebase-console"), false);
});

test("rota global restaura sem projeto selecionado", () => {
  const runtime = createRouteRuntime({ selectedProjectId: "" });
  runtime.storage.set("gsl:selected-route", "payments");
  runtime.restoreSelectedRoute();
  assert.equal(runtime.state.route, "payments");
});

test("rota de projeto restaura somente com projeto e permissão vigentes", () => {
  const valid = createRouteRuntime({ selectedProjectId: PROJECT_A });
  valid.storage.set("gsl:selected-route", "customers");
  valid.restoreSelectedRoute();
  assert.equal(valid.state.route, "customers");

  const noSelection = createRouteRuntime({ selectedProjectId: "" });
  noSelection.storage.set("gsl:selected-route", "customers");
  noSelection.restoreSelectedRoute();
  assert.equal(noSelection.state.route, "dashboard");

  const removed = createRouteRuntime({ projects: [{ id: PROJECT_B, status: "active" }], selectedProjectId: PROJECT_A });
  removed.storage.set("gsl:selected-route", "customers");
  removed.restoreSelectedRoute();
  assert.equal(removed.state.route, "dashboard");

  const revoked = createRouteRuntime({
    admin: administrator({ permissions: { viewDashboard: true, manageCustomers: false } }),
    selectedProjectId: PROJECT_A
  });
  revoked.storage.set("gsl:selected-route", "customers");
  revoked.restoreSelectedRoute();
  assert.equal(revoked.state.route, "project-dashboard");
  assert.equal(revoked.storage.get("gsl:selected-route"), "project-dashboard");
});

test("projeto armazenado só restaura quando existe, está ativo e continua no escopo", () => {
  const valid = createRouteRuntime();
  valid.storage.set("gsl:selected-project", PROJECT_A);
  valid.restoreSelectedProject();
  assert.equal(valid.state.selectedProjectId, PROJECT_A);
  assert.equal(valid.projectSwitcher.value, PROJECT_A);

  const revoked = createRouteRuntime({ admin: administrator({ projectIds: [PROJECT_B] }) });
  revoked.storage.set("gsl:selected-project", PROJECT_A);
  revoked.restoreSelectedProject();
  assert.equal(revoked.state.selectedProjectId, "");
  assert.equal(revoked.projectSwitcher.value, "");
  assert.equal(revoked.storage.has("gsl:selected-project"), false);

  const archived = createRouteRuntime({ projects: [{ id: PROJECT_A, status: "archived" }] });
  archived.storage.set("gsl:selected-project", PROJECT_A);
  archived.restoreSelectedProject();
  assert.equal(archived.state.selectedProjectId, "");
  assert.equal(archived.projectSwitcher.value, "");
});

test("setter central mantém estado, storage e select visual sincronizados", () => {
  const runtime = createRouteRuntime();
  runtime.setSelectedProject(PROJECT_A);
  assert.equal(runtime.state.selectedProjectId, PROJECT_A);
  assert.equal(runtime.storage.get("gsl:selected-project"), PROJECT_A);
  assert.equal(runtime.projectSwitcher.value, PROJECT_A);

  runtime.setSelectedProject("");
  assert.equal(runtime.state.selectedProjectId, "");
  assert.equal(runtime.storage.has("gsl:selected-project"), false);
  assert.equal(runtime.projectSwitcher.value, "");

  const renderSwitcher = section(appSource, "function renderProjectSwitcher(", "function renderUser(");
  assert.match(renderSwitcher, /syncProjectSwitcherSelection\(\)/);
});

test("logout e encerramento administrativo limpam rota e projeto persistidos", () => {
  const resetSource = section(appSource, "function resetAdministrativeState(", "async function endAdministrativeSession(");
  assert.match(resetSource, /setSelectedProject\(""\)/);
  assert.match(resetSource, /setRoute\("dashboard", \{ persist: false \}\)/);
  assert.match(section(appSource, "async function endAdministrativeSession(", "function authorizationFingerprint("), /resetAdministrativeState\(\)/);
  assert.match(section(appSource, "el\.logoutButton\.addEventListener", "el\.projectSwitcher\.addEventListener"), /resetAdministrativeState\(\)/);
});

test("troca de projeto, RBAC e escopo revogados persistem o fallback", () => {
  const switcher = section(appSource, "el.projectSwitcher.addEventListener", "el.mobileMenuButton.addEventListener");
  const sync = section(appSource, "async function syncAuthorization(", "async function api(");
  assert.match(switcher, /setRoute\(state\.selectedProjectId[\s\S]*?defaultProjectRoute\(\)[\s\S]*?defaultGlobalRoute\(\)\)/);
  assert.equal(sync.includes("state.route ="), false);
  assert.ok((sync.match(/setRoute\(/g) || []).length >= 3);
  assert.match(sync, /setSelectedProject\(""\)/);
});

test("restauração ocorre somente após autorização e projetos atuais", () => {
  const enter = section(appSource, "async function enterApp(", "function setLoginBusy(");
  const loadProjects = section(appSource, "async function loadProjects(", "async function loadProjectDetail(");
  const sync = section(appSource, "async function syncAuthorization(", "async function api(");
  assert.ok(enter.indexOf("verifyAdministrator(user, true)") < enter.indexOf("loadProjects()"));
  assert.ok(enter.indexOf("loadProjects()") < enter.indexOf("restoreSelectedProject()"));
  assert.ok(enter.indexOf("restoreSelectedProject()") < enter.indexOf("restoreSelectedRoute()"));
  assert.match(enter, /if \(state\.user !== user\) return;/);
  assert.ok((enter.match(/if \(state\.user !== user\) return;/g) || []).length >= 4);
  assert.match(loadProjects, /const user = state\.user;/);
  assert.match(loadProjects, /if \(state\.user !== user\) return state\.projects;/);
  assert.match(sync, /await Promise\.all\(\[loadProjects\(true\), safetyRender\]\);\s*if \(state\.user !== user\) return;/);
  assert.match(sync, /catch \(error\) \{\s*if \(state\.user !== user\) return;/);
  assert.equal(enter.includes("location.reload"), false);
  assert.equal(enter.includes("localStorage"), false);
});
