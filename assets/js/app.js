import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00",
  authDomain: "guiasys-licensing.firebaseapp.com",
  projectId: "guiasys-licensing",
  storageBucket: "guiasys-licensing.firebasestorage.app",
  messagingSenderId: "854287499951",
  appId: "1:854287499951:web:0369b194e7663a9d9c0a5a",
  measurementId: "G-J1GL33PCN7"
};

const API_BASE = "https://guiasys-licensing-api.lindolfoandrew0.workers.dev";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const state = {
  user: null,
  administrator: null,
  adminAuthorized: false,
  apiOnline: false,
  selectedProjectId: "",
  route: "dashboard",
  projects: []
};

let pendingLoginMessage = "";

const el = {
  boot: document.querySelector("#boot-screen"),
  login: document.querySelector("#login-screen"),
  shell: document.querySelector("#app-shell"),
  loginButton: document.querySelector("#google-login-button"),
  loginMessage: document.querySelector("#login-message"),
  logoutButton: document.querySelector("#logout-button"),
  userName: document.querySelector("#user-name"),
  userEmail: document.querySelector("#user-email"),
  userAvatar: document.querySelector("#user-avatar"),
  projectSwitcher: document.querySelector("#project-switcher"),
  globalNav: document.querySelector("#global-nav"),
  projectNavigation: document.querySelector("#project-navigation"),
  projectNav: document.querySelector("#project-nav"),
  content: document.querySelector("#content"),
  apiStatusDot: document.querySelector("#api-status-dot"),
  apiStatusText: document.querySelector("#api-status-text"),
  mobileMenuButton: document.querySelector("#mobile-menu-button")
};

const globalItems = [
  ["dashboard", "⌂", "Dashboard"],
  ["projects", "▦", "Projetos"],
  ["platform-settings", "⚙", "Configurações"]
];

const projectItems = [
  ["project-dashboard", "◫", "Dashboard"],
  ["licenses", "⌁", "Licenças"],
  ["generate-license", "+", "Gerar licença"],
  ["plans", "◇", "Planos"],
  ["customers", "◎", "Clientes"],
  ["devices", "▣", "Dispositivos"],
  ["activations", "↯", "Ativações"],
  ["logs", "≡", "Logs"],
  ["project-settings", "⚙", "Configurações"]
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "A") + (parts[1]?.[0] || "");
}

function showScreen(name) {
  el.boot.classList.toggle("hidden", name !== "boot");
  el.login.classList.toggle("hidden", name !== "login");
  el.shell.classList.toggle("hidden", name !== "shell");
}

function setLoginMessage(message = "") {
  el.loginMessage.textContent = message;
}

async function checkApi() {
  try {
    const response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    const data = await response.json();
    state.apiOnline = Boolean(response.ok && data.ok);
  } catch {
    state.apiOnline = false;
  }

  el.apiStatusDot.classList.toggle("status-dot-muted", !state.apiOnline);
  el.apiStatusText.textContent = state.apiOnline ? "API online" : "API indisponível";
}

async function verifyAdministrator(user) {
  const idToken = await user.getIdToken(true);

  const response = await fetch(`${API_BASE}/api/v1/admin/me`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Accept": "application/json"
    },
    cache: "no-store"
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data.ok || !data.authorized) {
    const error = new Error(
      data.message || "Esta conta não possui acesso administrativo."
    );
    error.status = response.status;
    error.code = data.error || "admin_verification_failed";
    throw error;
  }

  return data.administrator;
}

function renderNavigation() {
  el.globalNav.innerHTML = globalItems.map(([route, icon, label]) => `
    <button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
      <span class="nav-icon">${icon}</span>
      <span>${label}</span>
    </button>
  `).join("");

  el.projectNav.innerHTML = projectItems.map(([route, icon, label]) => `
    <button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
      <span class="nav-icon">${icon}</span>
      <span>${label}</span>
    </button>
  `).join("");

  el.projectNavigation.classList.toggle("hidden", !state.selectedProjectId);

  document.querySelectorAll("[data-route]").forEach(button => {
    button.addEventListener("click", () => {
      state.route = button.dataset.route;
      renderNavigation();
      renderContent();
      document.body.classList.remove("sidebar-open");
    });
  });
}

function renderProjectSwitcher() {
  const current = state.selectedProjectId;
  el.projectSwitcher.innerHTML = `
    <option value="">Visão geral</option>
    ${state.projects.map(project => `
      <option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>
    `).join("")}
  `;
  el.projectSwitcher.value = current;
}

function metric(label, value, note) {
  return `
    <article class="card metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-note">${note}</div>
    </article>
  `;
}

function adminStatusPanel() {
  const administrator = state.administrator || {};
  const uid = escapeHtml(administrator.uid || state.user?.uid || "");
  const email = escapeHtml(administrator.email || state.user?.email || "");

  return `
    <article class="card card-section setup-card">
      <span class="status-pill"><span class="status-dot"></span> Administrador autorizado</span>
      <h3 style="margin-top:14px">Backend protegido e validado</h3>
      <p>O Firebase autenticou a sessão e o Cloudflare Worker confirmou que esta conta corresponde ao administrador permitido.</p>

      <div class="setup-row">
        <div class="code-field">UID: ${uid}</div>
        <div class="code-field">Conta: ${email || "não informada"}</div>
      </div>
    </article>
  `;
}

function dashboardView() {
  return `
    <div class="page-header">
      <div>
        <h1>Dashboard geral</h1>
        <p>Visão consolidada da plataforma GuiaSys Licensing.</p>
      </div>
      <span class="badge">Administração segura</span>
    </div>

    <section class="grid grid-4">
      ${metric("Projetos ativos", "0", "Nenhum projeto cadastrado")}
      ${metric("Licenças ativas", "0", "Sem licenças emitidas")}
      ${metric("Ativações hoje", "0", "Nenhuma ativação")}
      ${metric("Expiram em 30 dias", "0", "Nenhuma expiração")}
    </section>

    <section class="grid grid-2" style="margin-top:18px">
      ${adminStatusPanel()}
      <article class="card card-section">
        <span class="badge">Arquitetura</span>
        <h3 style="margin-top:14px">Ambientes isolados por projeto</h3>
        <p>Cada projeto terá seus próprios planos, clientes, licenças, dispositivos, ativações, logs e configurações.</p>
        <div class="code-field" style="margin-top:20px">/projects/{projectId}/...</div>
      </article>
    </section>
  `;
}

function projectsView() {
  return `
    <div class="page-header">
      <div>
        <h1>Projetos</h1>
        <p>Cadastre os produtos que usarão o motor central de licenciamento.</p>
      </div>
      <button class="btn btn-primary" type="button" disabled title="Cadastro de projetos será conectado ao backend na próxima etapa">+ Novo projeto</button>
    </div>

    <article class="card card-section">
      <div class="empty-state">
        <strong>Nenhum projeto cadastrado</strong>
        A autenticação administrativa já está validada. O próximo módulo será o cadastro real de projetos.
      </div>
    </article>
  `;
}

function genericGlobalView() {
  return `
    <div class="page-header">
      <div>
        <h1>Configurações da plataforma</h1>
        <p>Preferências globais do GuiaSys Licensing.</p>
      </div>
    </div>

    <article class="card card-section">
      <div class="empty-state">
        <strong>Configuração global</strong>
        Esta área será habilitada nas próximas etapas do painel.
      </div>
    </article>
  `;
}

function projectPlaceholder() {
  const project = state.projects.find(item => item.id === state.selectedProjectId);
  const titleMap = Object.fromEntries(projectItems.map(([route, , label]) => [route, label]));

  return `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(titleMap[state.route] || "Projeto")}</h1>
        <p>${escapeHtml(project?.name || "Projeto selecionado")} · ambiente isolado</p>
      </div>
    </div>

    <article class="card card-section">
      <div class="empty-state">
        <strong>Módulo preparado</strong>
        Esta área será conectada aos endpoints administrativos do projeto.
      </div>
    </article>
  `;
}

function renderContent() {
  if (!state.selectedProjectId && projectItems.some(([route]) => route === state.route)) {
    state.route = "dashboard";
  }

  if (state.selectedProjectId && projectItems.some(([route]) => route === state.route)) {
    el.content.innerHTML = projectPlaceholder();
  } else if (state.route === "projects") {
    el.content.innerHTML = projectsView();
  } else if (state.route === "platform-settings") {
    el.content.innerHTML = genericGlobalView();
  } else {
    el.content.innerHTML = dashboardView();
  }
}

function renderUser() {
  const name = state.user?.displayName || state.administrator?.name || "Administrador";
  el.userName.textContent = name;
  el.userEmail.textContent = state.user?.email || state.administrator?.email || "";
  el.userAvatar.textContent = initials(name).toUpperCase().slice(0, 2);
}

async function enterApp(user) {
  showScreen("boot");
  state.user = user;

  try {
    state.administrator = await verifyAdministrator(user);
    state.adminAuthorized = true;
  } catch (error) {
    console.error("Falha na autorização administrativa:", error);

    state.administrator = null;
    state.adminAuthorized = false;

    pendingLoginMessage = error.status === 403
      ? `Esta conta Google não está autorizada. UID Firebase detectado: ${user.uid}`
      : "Não foi possível validar sua sessão administrativa. Verifique a API e tente novamente.";

    await signOut(auth);
    return;
  }

  renderUser();
  renderProjectSwitcher();
  renderNavigation();
  renderContent();
  showScreen("shell");
  await checkApi();
}

el.loginButton.addEventListener("click", async () => {
  setLoginMessage("");
  el.loginButton.disabled = true;

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    setLoginMessage("Não foi possível entrar com o Google. Tente novamente.");
  } finally {
    el.loginButton.disabled = false;
  }
});

el.logoutButton.addEventListener("click", async () => {
  state.adminAuthorized = false;
  state.administrator = null;
  await signOut(auth);
});

el.projectSwitcher.addEventListener("change", () => {
  state.selectedProjectId = el.projectSwitcher.value;

  if (!state.selectedProjectId && projectItems.some(([route]) => route === state.route)) {
    state.route = "dashboard";
  }

  if (state.selectedProjectId && ["dashboard", "projects", "platform-settings"].includes(state.route)) {
    state.route = "project-dashboard";
  }

  renderNavigation();
  renderContent();
});

el.mobileMenuButton.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

onAuthStateChanged(auth, async user => {
  if (user) {
    await enterApp(user);
    return;
  }

  state.user = null;
  state.administrator = null;
  state.adminAuthorized = false;

  showScreen("login");
  setLoginMessage(pendingLoginMessage);
  pendingLoginMessage = "";

  await checkApi();
});

showScreen("boot");
