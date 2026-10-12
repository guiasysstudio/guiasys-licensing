import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `seção não encontrada: ${start}`);
  return source.slice(from, to);
}

const authorizationRuntimeSource = [
  section("function hasPermission(", "function canCreateProjects("),
  section("function selectedProject(", "function showScreen("),
  section("function authorizationFingerprint(", "async function fetchWithClientTimeout("),
  section("async function syncAuthorization(", "async function api("),
  section("async function enterApp(", "function setLoginBusy(")
].join("\n");

const globalItems = [
  ["dashboard", "dashboard", "Dashboard", "viewDashboard"],
  ["projects", "projects", "Projetos", null],
  ["administrators", "users", "Administradores", "master"]
];

const projectItems = [
  ["project-dashboard", "dashboard", "Dashboard", "viewDashboard"],
  ["customers", "users", "Clientes", "manageCustomers"],
  ["licenses", "key", "Licenças", "manageLicenses"]
];

const PROJECT_A = "prj_81313d3d1ff64a029fb9";
const PROJECT_B = "prj_outro";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function administrator(overrides = {}) {
  return {
    master: false,
    allProjects: false,
    projectIds: [PROJECT_A],
    permissions: {
      viewDashboard: true,
      manageCustomers: false,
      manageLicenses: false
    },
    ...overrides
  };
}

function createRuntime({ initialAdmin, selectedProjectId = PROJECT_A, route = "project-dashboard", verify, load } = {}) {
  const storage = new Map();
  const counters = {
    verify: 0,
    invalidate: 0,
    loadProjects: 0,
    renderUser: 0,
    renderProjectSwitcher: 0,
    renderNavigation: 0,
    renderContent: 0,
    toast: 0,
    ended: 0
  };
  const state = {
    user: { uid: "uid-a146" },
    administrator: initialAdmin === undefined ? administrator() : initialAdmin,
    projects: [
      { id: PROJECT_A, name: "AUDITORIA GSL", status: "active" },
      { id: PROJECT_B, name: "Outro", status: "active" }
    ],
    selectedProjectId,
    route,
    renderRequested: 0
  };
  const el = { content: { innerHTML: route === "customers" ? "CUSTOMERS_SECRET" : route } };
  let navigation = [];
  let switcher = [];

  const sessionStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };

  const dependencies = {
    state,
    globalItems,
    projectItems,
    document: { hidden: false },
    sessionStorage,
    SELECTED_PROJECT_STORAGE_KEY: "gsl:selected-project",
    SELECTED_ROUTE_STORAGE_KEY: "gsl:selected-route",
    AUTHORIZATION_SYNC_THROTTLE_MS: 30_000,
    verifyAdministrator: async user => {
      counters.verify++;
      return verify ? await verify(user) : state.administrator;
    },
    invalidate: () => { counters.invalidate++; },
    loadProjects: async () => {
      counters.loadProjects++;
      const projects = load ? await load() : state.projects;
      state.projects = projects;
      return projects;
    },
    renderUser: () => { counters.renderUser++; },
    renderProjectSwitcher: () => {
      counters.renderProjectSwitcher++;
      switcher = state.projects.map(project => project.id);
    },
    renderNavigation: () => {
      counters.renderNavigation++;
      navigation = projectItems
        .filter(([, , , permission]) => !permission || state.administrator.master || state.administrator.permissions?.[permission])
        .map(([, , label]) => label);
    },
    renderContent: async () => {
      counters.renderContent++;
      el.content.innerHTML = state.route === "customers" ? "CUSTOMERS_SECRET" : state.route;
    },
    toast: () => { counters.toast++; },
    endAdministrativeSession: async () => {
      counters.ended++;
      state.user = null;
      el.content.innerHTML = "LOGIN";
    },
    el,
    loadingView: () => "LOADING",
    window: { addEventListener() {} },
    showScreen() {},
    signOut: async () => {},
    auth: {},
    checkApi: async () => {},
    pageHeader: () => "",
    e: value => String(value),
    clientErrorMessage: error => error?.message || "error",
    console: { error() {} }
  };

  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  const runtime = Function(
    ...names,
    `let authorizationSyncPromise = null;
     let lastAuthorizationSyncAt = 0;
     let pendingLoginMessage = "";
     ${authorizationRuntimeSource}
     return {
       enterApp,
       syncAuthorization,
       authorizationFingerprint,
       restoreSelectedProject,
       restoreSelectedRoute,
       setSelectedProject,
       setRoute,
       routeAllowed,
       defaultProjectRoute,
       defaultGlobalRoute,
       visibleProjectLabels: () => projectItems.filter(([, , , permission]) => hasPermission(permission)).map(([, , label]) => label),
       setLastAuthorizationSyncAt: value => { lastAuthorizationSyncAt = value; },
       setDocumentHidden: value => { document.hidden = value; },
       authorizationSyncPending: () => authorizationSyncPromise !== null
     };`
  )(...values);

  return {
    ...runtime,
    state,
    el,
    counters,
    storage,
    get navigation() { return navigation; },
    get switcher() { return switcher; }
  };
}

test("fingerprint muda com permissão, projectIds e allProjects, mas não com a ordem", () => {
  const runtime = createRuntime();
  const base = administrator();
  const permission = administrator({ permissions: { ...base.permissions, manageCustomers: true } });
  const projects = administrator({ projectIds: [PROJECT_A, PROJECT_B] });
  const allProjects = administrator({ allProjects: true });

  assert.notEqual(runtime.authorizationFingerprint(base), runtime.authorizationFingerprint(permission));
  assert.notEqual(runtime.authorizationFingerprint(base), runtime.authorizationFingerprint(projects));
  assert.notEqual(runtime.authorizationFingerprint(base), runtime.authorizationFingerprint(allProjects));
  assert.equal(
    runtime.authorizationFingerprint(projects),
    runtime.authorizationFingerprint({ ...projects, projectIds: [PROJECT_B, PROJECT_A] })
  );
  assert.equal(
    runtime.authorizationFingerprint(permission),
    runtime.authorizationFingerprint({
      ...permission,
      permissions: { manageLicenses: false, manageCustomers: true, viewDashboard: true }
    })
  );
});

test("cenário real concede Clientes sem logout, reload ou perda do projeto e da rota", async () => {
  const updated = administrator({
    permissions: { viewDashboard: true, manageCustomers: true, manageLicenses: false }
  });
  const runtime = createRuntime({ verify: async () => updated });

  assert.deepEqual(runtime.visibleProjectLabels(), ["Dashboard"]);
  await runtime.syncAuthorization(true);

  assert.equal(runtime.state.administrator.permissions.manageCustomers, true);
  assert.equal(runtime.state.selectedProjectId, PROJECT_A);
  assert.equal(runtime.state.route, "project-dashboard");
  assert.ok(runtime.navigation.includes("Clientes"));
  assert.equal(runtime.counters.ended, 0);
  assert.ok(runtime.counters.renderContent >= 1);
});

test("revogação remove Clientes, abandona a rota e não mantém a view proibida", async () => {
  const projects = deferred();
  const initial = administrator({ permissions: { viewDashboard: true, manageCustomers: true } });
  const runtime = createRuntime({
    initialAdmin: initial,
    route: "customers",
    verify: async () => administrator(),
    load: async () => await projects.promise
  });

  const syncing = runtime.syncAuthorization(true);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(runtime.state.route, "project-dashboard");
  assert.equal(runtime.el.content.innerHTML.includes("CUSTOMERS_SECRET"), false);
  assert.equal(runtime.navigation.includes("Clientes"), false);
  projects.resolve([{ id: PROJECT_A, name: "AUDITORIA GSL", status: "active" }]);
  await syncing;

  assert.equal(runtime.state.route, "project-dashboard");
  assert.equal(runtime.el.content.innerHTML, "project-dashboard");
  assert.equal(runtime.state.selectedProjectId, PROJECT_A);
});

test("remoção de escopo limpa seleção, switcher, rota e conteúdo antes do refetch", async () => {
  const projects = deferred();
  const runtime = createRuntime({
    route: "customers",
    initialAdmin: administrator({ permissions: { viewDashboard: true, manageCustomers: true } }),
    verify: async () => administrator({
      projectIds: [PROJECT_B],
      permissions: { viewDashboard: true, manageCustomers: true }
    }),
    load: async () => await projects.promise
  });

  const syncing = runtime.syncAuthorization(true);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(runtime.state.selectedProjectId, "");
  assert.equal(runtime.state.route, "dashboard");
  assert.equal(runtime.state.projects.some(project => project.id === PROJECT_A), false);
  assert.equal(runtime.switcher.includes(PROJECT_A), false);
  assert.equal(runtime.el.content.innerHTML.includes("CUSTOMERS_SECRET"), false);

  projects.resolve([{ id: PROJECT_B, name: "Outro", status: "active" }]);
  await syncing;
  assert.deepEqual(runtime.state.projects.map(project => project.id), [PROJECT_B]);
});

test("401 ou administrador inativado por 403 encerram a sessão e removem o painel", async () => {
  for (const status of [401, 403]) {
    const error = Object.assign(new Error("inactive"), { status });
    const runtime = createRuntime({ verify: async () => { throw error; } });

    await runtime.syncAuthorization(true);

    assert.equal(runtime.counters.ended, 1);
    assert.equal(runtime.state.user, null);
    assert.equal(runtime.el.content.innerHTML, "LOGIN");
    assert.equal(runtime.authorizationSyncPending(), false);
  }
});

test("erro temporário preserva autorização e sempre libera a promise", async () => {
  const initial = administrator({ permissions: { viewDashboard: true, manageCustomers: true } });
  const runtime = createRuntime({
    initialAdmin: initial,
    verify: async () => { throw Object.assign(new Error("offline"), { status: 503 }); }
  });

  await runtime.syncAuthorization(true);

  assert.equal(runtime.state.administrator, initial);
  assert.equal(runtime.state.user.uid, "uid-a146");
  assert.equal(runtime.counters.ended, 0);
  assert.equal(runtime.counters.renderContent, 0);
  assert.equal(runtime.authorizationSyncPending(), false);
});

test("focus, visibility e interval compartilham uma única sincronização em voo", async () => {
  const response = deferred();
  const runtime = createRuntime({ verify: async () => await response.promise });

  const focus = runtime.syncAuthorization(true);
  const visibility = runtime.syncAuthorization(true);
  const interval = runtime.syncAuthorization(false);
  assert.equal(runtime.counters.verify, 1);
  assert.equal(runtime.authorizationSyncPending(), true);

  response.resolve(administrator());
  await Promise.all([focus, visibility, interval]);
  assert.equal(runtime.counters.verify, 1);
  assert.equal(runtime.authorizationSyncPending(), false);
});

test("resposta tardia de uma sessão anterior não reaplica autorização antiga", async () => {
  const response = deferred();
  const initial = administrator();
  const runtime = createRuntime({ initialAdmin: initial, verify: async () => await response.promise });
  const syncing = runtime.syncAuthorization(true);

  runtime.state.user = { uid: "new-session" };
  response.resolve(administrator({ permissions: { viewDashboard: true, manageCustomers: true } }));
  await syncing;

  assert.equal(runtime.state.administrator, initial);
  assert.equal(runtime.counters.renderNavigation, 0);
  assert.equal(runtime.authorizationSyncPending(), false);
});

test("throttle vale para o interval, enquanto sync forçado consulta imediatamente", async () => {
  const runtime = createRuntime();
  runtime.setLastAuthorizationSyncAt(Date.now());

  await runtime.syncAuthorization(false);
  assert.equal(runtime.counters.verify, 0);

  await runtime.syncAuthorization(true);
  assert.equal(runtime.counters.verify, 1);

  runtime.setDocumentHidden(true);
  await runtime.syncAuthorization(true);
  assert.equal(runtime.counters.verify, 1);
  assert.match(source, /window\.addEventListener\("focus", \(\) => \{\s*syncAuthorization\(true\)/);
  assert.match(source, /visibilitychange[\s\S]*?if \(!document\.hidden\) syncAuthorization\(true\)/);
  assert.match(source, /setInterval[\s\S]*?syncAuthorization\(false\)[\s\S]*?AUTHORIZATION_SYNC_INTERVAL_MS/);
  assert.match(source, /const AUTHORIZATION_SYNC_INTERVAL_MS = 60_000/);
});

test("autorização idêntica não invalida cache nem renderiza novamente", async () => {
  const equivalent = administrator({
    projectIds: [PROJECT_A],
    permissions: { manageLicenses: false, manageCustomers: false, viewDashboard: true }
  });
  const runtime = createRuntime({ verify: async () => equivalent });

  await runtime.syncAuthorization(true);

  assert.equal(runtime.counters.invalidate, 0);
  assert.equal(runtime.counters.loadProjects, 0);
  assert.equal(runtime.counters.renderNavigation, 0);
  assert.equal(runtime.counters.renderContent, 0);
});

test("reload restaura apenas um projeto ainda autorizado e exibe Clientes vigente", () => {
  const current = administrator({ permissions: { viewDashboard: true, manageCustomers: true } });
  const runtime = createRuntime({ initialAdmin: current, selectedProjectId: "" });
  runtime.storage.set("gsl:selected-project", PROJECT_A);

  runtime.restoreSelectedProject();

  assert.equal(runtime.state.selectedProjectId, PROJECT_A);
  assert.ok(runtime.visibleProjectLabels().includes("Clientes"));
  assert.ok(source.indexOf("state.administrator = await verifyAdministrator(user, true)") < source.indexOf("restoreSelectedProject()", source.indexOf("async function enterApp")));

  runtime.state.projects = [{ id: PROJECT_B, status: "active" }];
  runtime.restoreSelectedProject();
  assert.equal(runtime.state.selectedProjectId, "");
  assert.equal(runtime.storage.has("gsl:selected-project"), false);
});

test("entrada totalmente nova usa /me vigente antes da navegação", async () => {
  const updated = administrator({ permissions: { viewDashboard: true, manageCustomers: true } });
  const runtime = createRuntime({
    initialAdmin: null,
    selectedProjectId: "",
    verify: async () => updated,
    load: async () => [{ id: PROJECT_A, name: "AUDITORIA GSL", status: "active" }]
  });
  runtime.state.user = null;
  runtime.storage.set("gsl:selected-project", PROJECT_A);

  await runtime.enterApp({ uid: "fresh-user" });

  assert.equal(runtime.state.administrator.permissions.manageCustomers, true);
  assert.equal(runtime.state.selectedProjectId, PROJECT_A);
  assert.ok(runtime.navigation.includes("Clientes"));
  assert.equal(runtime.counters.verify, 1);
});

test("/me não usa cache de dados nem exige refresh de custom claim", () => {
  const verifySource = section("async function verifyAdministrator(", "function toast(");
  const cacheSource = section("function cacheRead(", "function resetAdministrativeState(");

  assert.match(verifySource, /getIdToken\(forceTokenRefresh\)/);
  assert.match(verifySource, /cache: "no-store"/);
  assert.equal(verifySource.includes("cachedLoad"), false);
  assert.equal(cacheSource.includes("administrator"), false);
  assert.match(source, /const administrator = await verifyAdministrator\(user, false\)/);
});

test("sync e render não usam reload nem timeout arbitrário como correção", () => {
  const syncSource = section("async function syncAuthorization(", "async function api(");
  assert.equal(syncSource.includes("location.reload"), false);
  assert.equal(syncSource.includes("setTimeout"), false);
  assert.match(syncSource, /state\.projects = state\.projects\.filter/);
  assert.match(syncSource, /el\.content\.innerHTML = loadingView\(\)/);
  assert.match(syncSource, /if \(authorizationSyncPromise === pending\) authorizationSyncPromise = null/);
});
