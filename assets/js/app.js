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
const PANEL_VERSION = "0.5.3";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const state = {
  user: null,
  administrator: null,
  apiOnline: false,
  projects: [],
  dashboard: null,
  selectedProjectId: "",
  route: "dashboard",
  cache: new Map()
};

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
  ["activation-simulator", "⚡", "Simulador"],
  ["logs", "≡", "Logs"],
  ["project-settings", "⚙", "Configurações"]
];

const statusMap = {
  active: ["Ativa", "success"],
  inactive: ["Inativo", "muted"],
  archived: ["Arquivado", "muted"],
  pending: ["Aguardando ativação", "warning"],
  expired: ["Expirada", "danger"],
  suspended: ["Suspensa", "warning"],
  revoked: ["Revogada", "danger"]
};

let pendingLoginMessage = "";

function e(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "A") + (parts[1]?.[0] || "")).toUpperCase().slice(0, 2);
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return e(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" } : {})
  }).format(date);
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

function badge(status) {
  const [label, tone] = statusMap[status] || [status || "—", "muted"];
  return `<span class="badge badge-${tone}">${e(label)}</span>`;
}

function selectedProject() {
  return state.projects.find(project => project.id === state.selectedProjectId) || null;
}

function showScreen(name) {
  el.boot.classList.toggle("hidden", name !== "boot");
  el.login.classList.toggle("hidden", name !== "login");
  el.shell.classList.toggle("hidden", name !== "shell");
}

function setLoginMessage(message = "") {
  el.loginMessage.textContent = message;
}

function invalidate(projectId = "") {
  for (const key of [...state.cache.keys()]) {
    if (!projectId || key.startsWith(`${projectId}:`)) state.cache.delete(key);
  }
}

async function api(path, options = {}, retry = true) {
  const token = await state.user.getIdToken(false);
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    cache: "no-store"
  });

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (response.status === 401 && retry) {
    await state.user.getIdToken(true);
    return api(path, options, false);
  }

  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || `Erro HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.error;
    throw error;
  }

  return data;
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
  const token = await user.getIdToken(true);
  const response = await fetch(`${API_BASE}/api/v1/admin/me`, {
    headers: { "Authorization": `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.authorized) {
    const error = new Error(data.message || "Conta sem autorização administrativa.");
    error.status = response.status;
    throw error;
  }
  return data.administrator;
}

function toast(message, tone = "success") {
  let host = document.querySelector("#toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    document.body.appendChild(host);
  }

  const node = document.createElement("div");
  node.className = `toast toast-${tone}`;
  node.textContent = message;
  host.appendChild(node);

  requestAnimationFrame(() => node.classList.add("toast-show"));
  setTimeout(() => {
    node.classList.remove("toast-show");
    setTimeout(() => node.remove(), 200);
  }, 3200);
}

function openModal({ title, subtitle = "", body, submitLabel = "Salvar", onSubmit, wide = false }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <h2>${e(title)}</h2>
          ${subtitle ? `<p>${e(subtitle)}</p>` : ""}
        </div>
        <button class="icon-button modal-close" type="button" aria-label="Fechar">×</button>
      </div>
      <form class="modal-form">
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost modal-cancel" type="button">Cancelar</button>
          <button class="btn btn-primary modal-submit" type="submit">${e(submitLabel)}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.classList.add("modal-open");

  const close = () => {
    backdrop.remove();
    document.body.classList.remove("modal-open");
  };

  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });

  backdrop.querySelector(".modal-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = backdrop.querySelector(".modal-submit");
    button.disabled = true;
    button.textContent = "Salvando...";

    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      await onSubmit(values, event.currentTarget);
      close();
    } catch (error) {
      toast(error.message, "danger");
      button.disabled = false;
      button.textContent = submitLabel;
    }
  });

  setTimeout(() => backdrop.querySelector("input, select, textarea")?.focus(), 50);
}

function confirmAction(title, message, confirmLabel = "Confirmar", tone = "danger") {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-card modal-confirm" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h2>${e(title)}</h2>
            <p>${e(message)}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost cancel" type="button">Cancelar</button>
          <button class="btn btn-${tone === "danger" ? "danger" : "primary"} confirm" type="button">${e(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");

    const finish = value => {
      backdrop.remove();
      document.body.classList.remove("modal-open");
      resolve(value);
    };

    backdrop.querySelector(".cancel").onclick = () => finish(false);
    backdrop.querySelector(".confirm").onclick = () => finish(true);
  });
}

function renderNavigation() {
  el.globalNav.innerHTML = globalItems.map(([route, icon, label]) => `
    <button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
      <span class="nav-icon">${icon}</span><span>${label}</span>
    </button>
  `).join("");

  el.projectNav.innerHTML = projectItems.map(([route, icon, label]) => `
    <button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
      <span class="nav-icon">${icon}</span><span>${label}</span>
    </button>
  `).join("");

  el.projectNavigation.classList.toggle("hidden", !state.selectedProjectId);

  document.querySelectorAll("[data-route]").forEach(button => {
    button.addEventListener("click", async () => {
      state.route = button.dataset.route;
      renderNavigation();
      await renderContent();
      document.body.classList.remove("sidebar-open");
    });
  });
}

function renderProjectSwitcher() {
  el.projectSwitcher.innerHTML = `
    <option value="">Visão geral</option>
    ${state.projects
      .filter(project => project.status !== "archived")
      .map(project => `<option value="${e(project.id)}">${e(project.name)}</option>`)
      .join("")}
  `;
  el.projectSwitcher.value = state.selectedProjectId;
}

function renderUser() {
  const name = state.user?.displayName || state.administrator?.name || "Administrador";
  el.userName.textContent = name;
  el.userEmail.textContent = state.user?.email || state.administrator?.email || "";
  el.userAvatar.textContent = initials(name);
  document.querySelector(".version").textContent = `Painel v${PANEL_VERSION}`;
}

function pageHeader(title, description, action = "") {
  return `
    <div class="page-header">
      <div>
        <h1>${e(title)}</h1>
        <p>${e(description)}</p>
      </div>
      ${action}
    </div>
  `;
}

function metric(label, value, note = "") {
  return `
    <article class="card metric-card">
      <div class="metric-label">${e(label)}</div>
      <div class="metric-value">${e(value)}</div>
      <div class="metric-note">${e(note)}</div>
    </article>
  `;
}

function emptyState(title, text, action = "") {
  return `
    <div class="empty-state">
      <strong>${e(title)}</strong>
      <span>${e(text)}</span>
      ${action ? `<div class="empty-action">${action}</div>` : ""}
    </div>
  `;
}

function loadingView() {
  return `
    <div class="loading-panel">
      <div class="spinner"></div>
      <span>Carregando...</span>
    </div>
  `;
}

function table(headers, rows, emptyText = "Nenhum registro encontrado.") {
  if (!rows.length) return emptyState("Sem registros", emptyText);
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${headers.map(h => `<th>${e(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

async function loadProjects() {
  const data = await api("/api/v1/admin/projects");
  state.projects = data.projects || [];
  renderProjectSwitcher();
}

async function loadDashboard(projectId = "") {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const data = await api(`/api/v1/admin/dashboard${query}`);
  return data.dashboard;
}

async function loadEntity(entity, force = false) {
  const projectId = state.selectedProjectId;
  const key = `${projectId}:${entity}`;
  if (!force && state.cache.has(key)) return state.cache.get(key);
  const data = await api(`/api/v1/admin/projects/${encodeURIComponent(projectId)}/${entity}`);
  const items = data[entity] || [];
  state.cache.set(key, items);
  return items;
}

function logText(log) {
  const map = {
    "project.created": "Projeto criado",
    "project.updated": "Projeto atualizado",
    "project.archived": "Projeto arquivado",
    "plan.created": "Plano criado",
    "plan.updated": "Plano atualizado",
    "plan.deleted": "Plano excluído",
    "customer.created": "Cliente cadastrado",
    "customer.updated": "Cliente atualizado",
    "customer.deleted": "Cliente excluído",
    "license.created": "Licença gerada",
    "license.renew": "Licença renovada",
    "license.suspend": "Licença suspensa",
    "license.reactivate": "Licença reativada",
    "license.revoke": "Licença revogada",
    "license.activated": "Licença ativada",
    "device.deactivated": "Dispositivo desativado",
    "device.deactivated.admin": "Dispositivo removido pelo administrador"
  };
  return map[log.action] || log.action;
}

async function dashboardView() {
  const data = await loadDashboard();
  state.dashboard = data;

  const logs = (data.recentLogs || []).map(log => `
    <div class="activity-row">
      <div class="activity-dot"></div>
      <div class="activity-main">
        <strong>${e(logText(log))}</strong>
        <span>${e(log.projectName || "")}</span>
      </div>
      <time>${formatDate(log.createdAt, true)}</time>
    </div>
  `).join("");

  el.content.innerHTML = `
    ${pageHeader("Dashboard geral", "Visão consolidada de todos os projetos do GuiaSys Licensing.",
      '<button class="btn btn-primary" id="dashboard-new-project" type="button">+ Novo projeto</button>')}

    <section class="grid grid-4">
      ${metric("Projetos ativos", data.projectsActive, `${data.projectsTotal} projeto(s) no total`)}
      ${metric("Licenças ativas", data.activeLicenses, `${data.pendingLicenses} aguardando ativação`)}
      ${metric("Ativações hoje", data.activationsToday, "Horário de Brasília")}
      ${metric("Expiram em 30 dias", data.expiring30Days, "Licenças ativas")}
    </section>

    <section class="dashboard-split">
      <article class="card card-section">
        <div class="section-heading">
          <div><span class="eyebrow">ATIVIDADE</span><h3>Movimentações recentes</h3></div>
        </div>
        <div class="activity-list">
          ${logs || emptyState("Nenhuma atividade", "Os eventos aparecerão aqui conforme o sistema for utilizado.")}
        </div>
      </article>

      <article class="card card-section">
        <span class="status-pill"><span class="status-dot"></span> Administrador autorizado</span>
        <h3 style="margin-top:16px">Infraestrutura operacional</h3>
        <p>Firebase Authentication, Cloudflare Worker e Firestore estão integrados. O painel usa o Worker como única camada administrativa.</p>
        <div class="mini-info">
          <div><span>Conta</span><strong>${e(state.user.email || "")}</strong></div>
          <div><span>Projetos</span><strong>${e(data.projectsTotal)}</strong></div>
          <div><span>API</span><strong>v1</strong></div>
        </div>
      </article>
    </section>
  `;

  document.querySelector("#dashboard-new-project").onclick = openProjectCreate;
}

async function projectsView() {
  el.content.innerHTML = `
    ${pageHeader("Projetos", "Cada projeto possui um ambiente de licenciamento totalmente independente.",
      '<button class="btn btn-primary" id="new-project" type="button">+ Novo projeto</button>')}

    <section class="project-grid">
      ${state.projects.length
        ? state.projects.map(project => `
          <article class="project-card card" data-project="${e(project.id)}">
            <div class="project-card-top">
              <div class="project-symbol">${e((project.prefix || "GS").slice(0, 3))}</div>
              ${badge(project.status)}
            </div>
            <h3>${e(project.name)}</h3>
            <p>${e(project.description || "Sem descrição.")}</p>
            <div class="project-meta">
              <span><small>Prefixo</small><strong>${e(project.prefix)}</strong></span>
              <span><small>Offline</small><strong>${e(project.offlineDays)} dia(s)</strong></span>
              <span><small>Validação</small><strong>${e(project.validationHours)}h</strong></span>
            </div>
            <div class="project-actions">
              <button class="btn btn-primary open-project" type="button">Abrir projeto</button>
              <button class="btn btn-ghost edit-project" type="button">Editar</button>
            </div>
          </article>
        `).join("")
        : emptyState("Nenhum projeto cadastrado", "Cadastre seu primeiro produto para começar.", '<button class="btn btn-primary" id="empty-new-project" type="button">Criar primeiro projeto</button>')}
    </section>
  `;

  document.querySelector("#new-project").onclick = openProjectCreate;
  document.querySelector("#empty-new-project")?.addEventListener("click", openProjectCreate);

  document.querySelectorAll(".project-card").forEach(card => {
    const id = card.dataset.project;
    card.querySelector(".open-project").onclick = async () => {
      state.selectedProjectId = id;
      state.route = "project-dashboard";
      renderProjectSwitcher();
      renderNavigation();
      await renderContent();
    };
    card.querySelector(".edit-project").onclick = () => openProjectEdit(state.projects.find(p => p.id === id));
  });
}

function projectForm(project = {}) {
  return `
    <div class="form-grid form-grid-2">
      <label class="field">
        <span>Nome do projeto *</span>
        <input name="name" required maxlength="80" value="${e(project.name || "")}" placeholder="Ex.: GuiaPlay">
      </label>
      <label class="field">
        <span>Prefixo da key *</span>
        <input name="prefix" required maxlength="8" value="${e(project.prefix || "")}" placeholder="GPL">
      </label>
      <label class="field">
        <span>Slug</span>
        <input name="slug" maxlength="48" value="${e(project.slug || "")}" placeholder="guiaplay">
      </label>
      <label class="field">
        <span>Status</span>
        <select name="status">
          <option value="active" ${project.status !== "inactive" ? "selected" : ""}>Ativo</option>
          <option value="inactive" ${project.status === "inactive" ? "selected" : ""}>Inativo</option>
        </select>
      </label>
      <label class="field">
        <span>Dias de trial</span>
        <input name="trialDays" type="number" min="0" value="${e(project.trialDays ?? 0)}">
      </label>
      <label class="field">
        <span>Dias permitidos offline</span>
        <input name="offlineDays" type="number" min="0" value="${e(project.offlineDays ?? 7)}">
      </label>
      <label class="field">
        <span>Intervalo de validação (horas)</span>
        <input name="validationHours" type="number" min="1" value="${e(project.validationHours ?? 24)}">
      </label>
      <label class="field field-full">
        <span>Descrição</span>
        <textarea name="description" rows="3" maxlength="300" placeholder="Descrição interna do projeto">${e(project.description || "")}</textarea>
      </label>
    </div>
  `;
}

function projectPayload(values) {
  return {
    ...values,
    trialDays: Number(values.trialDays || 0),
    offlineDays: Number(values.offlineDays || 0),
    validationHours: Number(values.validationHours || 24)
  };
}

function openProjectCreate() {
  openModal({
    title: "Novo projeto",
    subtitle: "Um ambiente independente será criado para este produto.",
    body: projectForm(),
    submitLabel: "Criar projeto",
    wide: true,
    onSubmit: async values => {
      const data = await api("/api/v1/admin/projects", {
        method: "POST",
        body: JSON.stringify(projectPayload(values))
      });
      state.projects.push(data.project);
      state.projects.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      renderProjectSwitcher();
      toast("Projeto criado com sucesso.");
      state.selectedProjectId = data.project.id;
      state.route = "project-dashboard";
      renderProjectSwitcher();
      renderNavigation();
      await renderContent();
    }
  });
}

function openProjectEdit(project) {
  openModal({
    title: "Editar projeto",
    subtitle: project.name,
    body: projectForm(project),
    submitLabel: "Salvar alterações",
    wide: true,
    onSubmit: async values => {
      const data = await api(`/api/v1/admin/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify(projectPayload(values))
      });
      const index = state.projects.findIndex(item => item.id === project.id);
      state.projects[index] = data.project;
      invalidate(project.id);
      renderProjectSwitcher();
      toast("Projeto atualizado.");
      await renderContent();
    }
  });
}

async function projectDashboardView() {
  const project = selectedProject();
  const data = await loadDashboard(project.id);

  const logs = (data.recentLogs || []).map(log => `
    <div class="activity-row">
      <div class="activity-dot"></div>
      <div class="activity-main"><strong>${e(logText(log))}</strong><span>${e(log.actor || "")}</span></div>
      <time>${formatDate(log.createdAt, true)}</time>
    </div>
  `).join("");

  el.content.innerHTML = `
    ${pageHeader(project.name, "Dashboard exclusivo deste projeto.", `<span class="project-id-pill">${e(project.prefix)} · ${e(project.id)}</span>`)}

    <section class="grid grid-4">
      ${metric("Licenças ativas", data.activeLicenses, `${data.pendingLicenses} aguardando ativação`)}
      ${metric("Ativações hoje", data.activationsToday, "Horário de Brasília")}
      ${metric("Expiram em 30 dias", data.expiring30Days, "Acompanhe renovações")}
      ${metric("Status", project.status === "active" ? "Ativo" : "Inativo", `Validação a cada ${project.validationHours}h`)}
    </section>

    <section class="dashboard-split">
      <article class="card card-section">
        <div class="section-heading"><div><span class="eyebrow">ATIVIDADE</span><h3>Logs recentes</h3></div></div>
        <div class="activity-list">${logs || emptyState("Nenhum log", "As ações deste projeto aparecerão aqui.")}</div>
      </article>
      <article class="card card-section">
        <span class="badge">Configuração</span>
        <h3 style="margin-top:14px">Política do projeto</h3>
        <div class="mini-info vertical">
          <div><span>Trial</span><strong>${e(project.trialDays)} dia(s)</strong></div>
          <div><span>Offline</span><strong>${e(project.offlineDays)} dia(s)</strong></div>
          <div><span>Validação</span><strong>${e(project.validationHours)} hora(s)</strong></div>
          <div><span>Prefixo</span><strong>${e(project.prefix)}</strong></div>
        </div>
      </article>
    </section>
  `;
}

function planForm(plan = {}) {
  return `
    <div class="form-grid form-grid-2">
      <label class="field field-full"><span>Nome do plano *</span><input name="name" required value="${e(plan.name || "")}" placeholder="Ex.: Semestral"></label>
      <label class="field"><span>Preço (R$)</span><input name="price" type="number" min="0" step="0.01" value="${e(plan.price ?? 0)}"></label>
      <label class="field"><span>Dispositivos</span><input name="deviceLimit" type="number" min="1" value="${e(plan.deviceLimit ?? 1)}"></label>
      <label class="field"><span>Duração em dias</span><input name="durationDays" type="number" min="1" value="${e(plan.durationDays || 30)}"></label>
      <label class="field check-field"><input name="lifetime" type="checkbox" value="true" ${plan.lifetime ? "checked" : ""}><span>Licença vitalícia</span></label>
      <label class="field check-field"><input name="active" type="checkbox" value="true" ${plan.active !== false ? "checked" : ""}><span>Plano ativo</span></label>
      <label class="field field-full"><span>Descrição</span><textarea name="description" rows="3">${e(plan.description || "")}</textarea></label>
    </div>
  `;
}

async function plansView() {
  const plans = await loadEntity("plans");

  el.content.innerHTML = `
    ${pageHeader("Planos", "Configure tipos de licença, duração, preço e limite de dispositivos.",
      '<button class="btn btn-primary" id="new-plan" type="button">+ Novo plano</button>')}
    <article class="card table-shell">
      <div class="table-toolbar"><h3>Planos cadastrados</h3><span class="badge">${plans.length} registro(s)</span></div>
      ${table(
        ["Plano", "Preço", "Duração", "Dispositivos", "Status", ""],
        plans.map(plan => `
          <tr>
            <td><strong>${e(plan.name)}</strong><small>${e(plan.description || "")}</small></td>
            <td>${formatMoney(plan.price)}</td>
            <td>${plan.lifetime ? '<span class="badge badge-success">Vitalício</span>' : `${e(plan.durationDays)} dias`}</td>
            <td>${e(plan.deviceLimit)}</td>
            <td>${plan.active ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-muted">Inativo</span>'}</td>
            <td class="table-actions"><button class="btn btn-ghost btn-sm edit-plan" data-id="${e(plan.id)}">Editar</button><button class="btn btn-ghost btn-sm delete-plan" data-id="${e(plan.id)}">Excluir</button></td>
          </tr>
        `),
        "Cadastre um plano para emitir licenças."
      )}
    </article>
  `;

  document.querySelector("#new-plan").onclick = () => openPlan();
  document.querySelectorAll(".edit-plan").forEach(button => button.onclick = () => openPlan(plans.find(p => p.id === button.dataset.id)));
  document.querySelectorAll(".delete-plan").forEach(button => button.onclick = async () => {
    const plan = plans.find(p => p.id === button.dataset.id);
    if (!await confirmAction("Excluir plano", `Excluir o plano "${plan.name}"? Licenças já emitidas mantêm o snapshot do plano.`, "Excluir")) return;
    await api(`/api/v1/admin/projects/${state.selectedProjectId}/plans/${plan.id}`, { method: "DELETE" });
    invalidate(state.selectedProjectId);
    toast("Plano excluído.");
    await renderContent();
  });
}

function openPlan(plan = null) {
  openModal({
    title: plan ? "Editar plano" : "Novo plano",
    subtitle: selectedProject().name,
    body: planForm(plan || {}),
    submitLabel: plan ? "Salvar alterações" : "Criar plano",
    wide: true,
    onSubmit: async (values, form) => {
      const payload = {
        ...values,
        price: Number(values.price || 0),
        durationDays: Number(values.durationDays || 30),
        deviceLimit: Number(values.deviceLimit || 1),
        lifetime: form.elements.lifetime.checked,
        active: form.elements.active.checked
      };
      const path = plan
        ? `/api/v1/admin/projects/${state.selectedProjectId}/plans/${plan.id}`
        : `/api/v1/admin/projects/${state.selectedProjectId}/plans`;
      await api(path, { method: plan ? "PATCH" : "POST", body: JSON.stringify(payload) });
      invalidate(state.selectedProjectId);
      toast(plan ? "Plano atualizado." : "Plano criado.");
      await renderContent();
    }
  });
}

function customerForm(customer = {}) {
  return `
    <div class="form-grid form-grid-2">
      <label class="field"><span>Nome *</span><input name="name" required value="${e(customer.name || "")}"></label>
      <label class="field"><span>E-mail *</span><input name="email" type="email" required value="${e(customer.email || "")}"></label>
      <label class="field"><span>Telefone</span><input name="phone" value="${e(customer.phone || "")}"></label>
      <label class="field"><span>Status</span><select name="status"><option value="active" ${customer.status !== "inactive" ? "selected" : ""}>Ativo</option><option value="inactive" ${customer.status === "inactive" ? "selected" : ""}>Inativo</option></select></label>
      <label class="field field-full"><span>Observações</span><textarea name="notes" rows="4">${e(customer.notes || "")}</textarea></label>
    </div>
  `;
}

async function customersView() {
  const customers = await loadEntity("customers");
  el.content.innerHTML = `
    ${pageHeader("Clientes", "Clientes cadastrados somente dentro deste projeto.",
      '<button class="btn btn-primary" id="new-customer" type="button">+ Novo cliente</button>')}
    <article class="card table-shell">
      <div class="table-toolbar"><h3>Clientes</h3><span class="badge">${customers.length} registro(s)</span></div>
      ${table(
        ["Cliente", "E-mail", "Telefone", "Status", "Cadastro", ""],
        customers.map(customer => `
          <tr>
            <td><strong>${e(customer.name)}</strong></td>
            <td>${e(customer.email)}</td>
            <td>${e(customer.phone || "—")}</td>
            <td>${badge(customer.status)}</td>
            <td>${formatDate(customer.createdAt)}</td>
            <td class="table-actions"><button class="btn btn-ghost btn-sm edit-customer" data-id="${e(customer.id)}">Editar</button><button class="btn btn-ghost btn-sm delete-customer" data-id="${e(customer.id)}">Excluir</button></td>
          </tr>
        `),
        "Cadastre um cliente antes de gerar uma licença."
      )}
    </article>
  `;

  document.querySelector("#new-customer").onclick = () => openCustomer();
  document.querySelectorAll(".edit-customer").forEach(button => button.onclick = () => openCustomer(customers.find(c => c.id === button.dataset.id)));
  document.querySelectorAll(".delete-customer").forEach(button => button.onclick = async () => {
    const customer = customers.find(c => c.id === button.dataset.id);
    if (!await confirmAction("Excluir cliente", `Excluir "${customer.name}" deste projeto?\nLicenças existentes não serão apagadas.`, "Excluir")) return;
    await api(`/api/v1/admin/projects/${state.selectedProjectId}/customers/${customer.id}`, { method: "DELETE" });
    invalidate(state.selectedProjectId);
    toast("Cliente excluído.");
    await renderContent();
  });
}

function openCustomer(customer = null) {
  openModal({
    title: customer ? "Editar cliente" : "Novo cliente",
    subtitle: selectedProject().name,
    body: customerForm(customer || {}),
    submitLabel: customer ? "Salvar alterações" : "Cadastrar cliente",
    wide: true,
    onSubmit: async values => {
      const path = customer
        ? `/api/v1/admin/projects/${state.selectedProjectId}/customers/${customer.id}`
        : `/api/v1/admin/projects/${state.selectedProjectId}/customers`;
      await api(path, { method: customer ? "PATCH" : "POST", body: JSON.stringify(values) });
      invalidate(state.selectedProjectId);
      toast(customer ? "Cliente atualizado." : "Cliente cadastrado.");
      await renderContent();
    }
  });
}

async function licenseFormHtml() {
  const [customers, plans] = await Promise.all([loadEntity("customers", true), loadEntity("plans", true)]);

  return `
    <div class="form-grid form-grid-2">
      <label class="field field-full">
        <span>Cliente *</span>
        <select name="customerId" required>
          <option value="">Selecione...</option>
          ${customers.map(c => `<option value="${e(c.id)}" ${c.status === "inactive" ? "disabled" : ""}>${e(c.name)} — ${e(c.email)}${c.status === "inactive" ? " — Inativo" : ""}</option>`).join("")}
        </select>
      </label>
      <label class="field field-full">
        <span>Plano</span>
        <select name="planId" id="license-plan">
          <option value="">Licença personalizada</option>
          ${plans.filter(p => p.active !== false).map(p => `<option value="${e(p.id)}">${e(p.name)} — ${p.lifetime ? "Vitalício" : `${e(p.durationDays)} dias`} — ${e(p.deviceLimit)} disp.</option>`).join("")}
        </select>
      </label>
      <label class="field"><span>Duração personalizada (dias)</span><input name="durationDays" type="number" min="1" value="30"></label>
      <label class="field"><span>Máximo de dispositivos</span><input name="maxDevices" type="number" min="1" value="1"></label>
      <label class="field"><span>Início da validade</span><select name="startMode"><option value="first_activation">Na primeira ativação</option><option value="immediate">Imediatamente</option></select></label>
      <label class="field check-field"><input name="lifetime" type="checkbox" value="true"><span>Vitalícia</span></label>
      <label class="field field-full"><span>Observações</span><textarea name="notes" rows="3"></textarea></label>
    </div>
  `;
}

async function openLicenseCreate(onCreated = null) {
  const [plans, html] = await Promise.all([loadEntity("plans"), licenseFormHtml()]);
  openModal({
    title: "Gerar licença",
    subtitle: selectedProject().name,
    body: html,
    submitLabel: "Gerar licença",
    wide: true,
    onSubmit: async (values, form) => {
      const selectedPlan = plans.find(p => p.id === values.planId);
      const payload = {
        ...values,
        durationDays: Number(values.durationDays || selectedPlan?.durationDays || 30),
        maxDevices: Number(values.maxDevices || selectedPlan?.deviceLimit || 1),
        lifetime: form.elements.lifetime.checked || Boolean(selectedPlan?.lifetime)
      };
      const data = await api(`/api/v1/admin/projects/${state.selectedProjectId}/licenses`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      invalidate(state.selectedProjectId);
      toast("Licença gerada com sucesso.");
      await navigator.clipboard?.writeText(data.license.key).catch(() => {});
      showGeneratedLicense(data.license);
      if (onCreated) await onCreated(data.license);
    }
  });
}

function showGeneratedLicense(license) {
  openModal({
    title: "Licença criada",
    subtitle: "A key já foi copiada para a área de transferência quando permitido pelo navegador.",
    body: `
      <div class="license-result">
        <span class="eyebrow">LICENSE KEY</span>
        <div class="license-key-box">${e(license.key)}</div>
        <div class="mini-info vertical">
          <div><span>Cliente</span><strong>${e(license.customerName)}</strong></div>
          <div><span>Plano</span><strong>${e(license.planName)}</strong></div>
          <div><span>Dispositivos</span><strong>${e(license.maxDevices)}</strong></div>
          <div><span>Status</span><strong>${e(statusMap[license.status]?.[0] || license.status)}</strong></div>
        </div>
      </div>
    `,
    submitLabel: "Copiar key",
    onSubmit: async () => {
      await navigator.clipboard.writeText(license.key);
      toast("Key copiada.");
    }
  });
}

async function licensesView() {
  const licenses = await loadEntity("licenses");
  el.content.innerHTML = `
    ${pageHeader("Licenças", "Gerencie validade, status, renovação e dispositivos permitidos.",
      '<button class="btn btn-primary" id="new-license" type="button">+ Gerar licença</button>')}
    <article class="card table-shell">
      <div class="table-toolbar">
        <h3>Licenças emitidas</h3>
        <div class="toolbar-actions"><input id="license-search" class="compact-input" placeholder="Buscar cliente ou key"><span class="badge">${licenses.length} registro(s)</span></div>
      </div>
      <div id="licenses-table"></div>
    </article>
  `;

  const draw = query => {
    const q = query.trim().toLowerCase();
    const filtered = licenses.filter(item =>
      !q ||
      item.key?.toLowerCase().includes(q) ||
      item.customerName?.toLowerCase().includes(q) ||
      item.customerEmail?.toLowerCase().includes(q)
    );

    document.querySelector("#licenses-table").innerHTML = table(
      ["Key", "Cliente", "Plano", "Status", "Expiração", "Disp.", ""],
      filtered.map(item => `
        <tr>
          <td><button class="key-button copy-key" data-key="${e(item.key)}" type="button" title="Copiar key">${e(item.key)}</button></td>
          <td><strong>${e(item.customerName)}</strong><small>${e(item.customerEmail)}</small></td>
          <td>${e(item.planName)}</td>
          <td>${badge(item.status)}</td>
          <td>${item.lifetime ? '<span class="badge badge-success">Vitalícia</span>' : formatDate(item.expiresAt)}</td>
          <td>${e(item.maxDevices)}</td>
          <td class="table-actions">
            <button class="btn btn-ghost btn-sm license-menu" data-id="${e(item.id)}" type="button">Ações</button>
          </td>
        </tr>
      `),
      "Nenhuma licença corresponde ao filtro."
    );

    document.querySelectorAll(".copy-key").forEach(button => button.onclick = async () => {
      await navigator.clipboard.writeText(button.dataset.key);
      toast("Key copiada.");
    });
    document.querySelectorAll(".license-menu").forEach(button => button.onclick = () => openLicenseActions(licenses.find(l => l.id === button.dataset.id)));
  };

  draw("");
  document.querySelector("#license-search").addEventListener("input", event => draw(event.target.value));
  document.querySelector("#new-license").onclick = () => openLicenseCreate(async () => {
    invalidate(state.selectedProjectId);
    await renderContent();
  });
}

function openLicenseActions(license) {
  const actions = [
    ["renew", "Renovar", "primary"],
    ...(license.status === "suspended" ? [["reactivate", "Reativar", "primary"]] : [["suspend", "Suspender", "ghost"]]),
    ...(license.status === "revoked" ? [["reactivate", "Reativar", "primary"]] : [["revoke", "Revogar", "danger"]])
  ];

  openModal({
    title: "Ações da licença",
    subtitle: license.key,
    body: `
      <div class="license-action-summary">
        <div><span>Cliente</span><strong>${e(license.customerName)}</strong></div>
        <div><span>Status</span>${badge(license.status)}</div>
        <div><span>Expiração</span><strong>${license.lifetime ? "Vitalícia" : formatDate(license.expiresAt)}</strong></div>
      </div>
      <div class="action-grid">
        ${actions.map(([action, label, tone]) => `<button class="btn btn-${tone} do-license-action" data-action="${action}" type="button">${label}</button>`).join("")}
      </div>
    `,
    submitLabel: "Copiar key",
    onSubmit: async () => {
      await navigator.clipboard.writeText(license.key);
      toast("Key copiada.");
    }
  });

  setTimeout(() => {
    document.querySelectorAll(".do-license-action").forEach(button => button.onclick = async () => {
      const action = button.dataset.action;
      if (action === "renew") {
        openRenewLicense(license);
        document.querySelector(".modal-backdrop")?.remove();
        document.body.classList.remove("modal-open");
        return;
      }

      if (action === "revoke" && !await confirmAction("Revogar licença", "A próxima validação do cliente será recusada.", "Revogar")) return;

      await api(`/api/v1/admin/projects/${state.selectedProjectId}/licenses/${license.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      document.querySelector(".modal-backdrop")?.remove();
      document.body.classList.remove("modal-open");
      invalidate(state.selectedProjectId);
      toast(`Licença: ${action} concluído.`);
      await renderContent();
    });
  }, 0);
}

function openRenewLicense(license) {
  openModal({
    title: "Renovar licença",
    subtitle: license.key,
    body: `
      <div class="form-grid">
        <label class="field"><span>Adicionar dias</span><input name="days" type="number" min="1" value="${e(license.durationDays || 30)}"></label>
        <label class="field check-field"><input name="lifetime" type="checkbox" value="true" ${license.lifetime ? "checked" : ""}><span>Transformar em vitalícia</span></label>
      </div>
    `,
    submitLabel: "Renovar",
    onSubmit: async (values, form) => {
      await api(`/api/v1/admin/projects/${state.selectedProjectId}/licenses/${license.id}/renew`, {
        method: "POST",
        body: JSON.stringify({ days: Number(values.days || 30), lifetime: form.elements.lifetime.checked })
      });
      invalidate(state.selectedProjectId);
      toast("Licença renovada.");
      await renderContent();
    }
  });
}

async function generateLicenseView() {
  const html = await licenseFormHtml();
  el.content.innerHTML = `
    ${pageHeader("Gerar licença", "Emita uma nova key para um cliente deste projeto.")}
    <article class="card card-section form-page">
      <form id="generate-license-form">
        ${html}
        <div class="form-page-footer">
          <button class="btn btn-primary btn-lg" type="submit">Gerar licença</button>
        </div>
      </form>
    </article>
  `;

  const plans = await loadEntity("plans");
  document.querySelector("#generate-license-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const selectedPlan = plans.find(p => p.id === values.planId);
      const data = await api(`/api/v1/admin/projects/${state.selectedProjectId}/licenses`, {
        method: "POST",
        body: JSON.stringify({
          ...values,
          durationDays: Number(values.durationDays || selectedPlan?.durationDays || 30),
          maxDevices: Number(values.maxDevices || selectedPlan?.deviceLimit || 1),
          lifetime: form.elements.lifetime.checked || Boolean(selectedPlan?.lifetime)
        })
      });
      invalidate(state.selectedProjectId);
      showGeneratedLicense(data.license);
      form.reset();
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      button.disabled = false;
    }
  });
}

async function devicesView() {
  const [devices, licenses] = await Promise.all([loadEntity("devices"), loadEntity("licenses")]);
  const licenseMap = new Map(licenses.map(item => [item.id, item]));

  el.content.innerHTML = `
    ${pageHeader("Dispositivos", "Dispositivos ativados nas licenças deste projeto.")}
    <article class="card table-shell">
      <div class="table-toolbar"><h3>Dispositivos</h3><span class="badge">${devices.filter(d => d.active !== false).length} ativo(s)</span></div>
      ${table(
        ["Dispositivo", "Cliente", "Licença", "Plataforma", "Última validação", "Status", ""],
        devices.map(device => {
          const license = licenseMap.get(device.licenseId);
          return `
            <tr>
              <td><strong>${e(device.name || "Dispositivo")}</strong><small>${e(device.deviceHash?.slice(0, 14) || "")}</small></td>
              <td>${e(license?.customerName || "—")}</td>
              <td><code>${e(license?.key || device.licenseId || "—")}</code></td>
              <td>${e(device.platform || "—")}</td>
              <td>${formatDate(device.lastSeenAt, true)}</td>
              <td>${device.active !== false ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-muted">Desativado</span>'}</td>
              <td class="table-actions">${device.active !== false ? `<button class="btn btn-ghost btn-sm deactivate-device" data-id="${e(device.id)}">Desativar</button>` : ""}</td>
            </tr>
          `;
        }),
        "Nenhum dispositivo ativado ainda."
      )}
    </article>
  `;

  document.querySelectorAll(".deactivate-device").forEach(button => button.onclick = async () => {
    if (!await confirmAction("Desativar dispositivo", "A ativação será liberada para outro dispositivo.", "Desativar")) return;
    await api(`/api/v1/admin/projects/${state.selectedProjectId}/devices/${button.dataset.id}/deactivate`, {
      method: "POST",
      body: JSON.stringify({})
    });
    invalidate(state.selectedProjectId);
    toast("Dispositivo desativado.");
    await renderContent();
  });
}

async function activationsView() {
  const [items, licenses] = await Promise.all([loadEntity("activations"), loadEntity("licenses")]);
  const licenseMap = new Map(licenses.map(item => [item.id, item]));
  const typeMap = { activate: "Ativação", revalidate: "Revalidação", deactivate: "Desativação" };

  el.content.innerHTML = `
    ${pageHeader("Ativações", "Histórico técnico de ativações e desativações.")}
    <article class="card table-shell">
      <div class="table-toolbar"><h3>Histórico</h3><span class="badge">${items.length} evento(s)</span></div>
      ${table(
        ["Evento", "Cliente", "Licença", "Dispositivo", "Data"],
        items.map(item => {
          const license = licenseMap.get(item.licenseId);
          return `
            <tr>
              <td><strong>${e(typeMap[item.type] || item.type)}</strong></td>
              <td>${e(license?.customerName || "—")}</td>
              <td><code>${e(license?.key || item.licenseId)}</code></td>
              <td><code>${e(item.deviceHash?.slice(0, 16) || "—")}</code></td>
              <td>${formatDate(item.createdAt, true)}</td>
            </tr>
          `;
        }),
        "Nenhuma ativação registrada."
      )}
    </article>
  `;
}


async function activationSimulatorView() {
  const licenses = await loadEntity("licenses");
  const usable = licenses;
  const project = selectedProject();

  el.content.innerHTML = `
    ${pageHeader("Simulador de ativação", "Teste o fluxo que o GuiaPlay usará sem precisar integrar o programa ainda.")}

    <section class="grid grid-2 simulator-grid">
      <article class="card card-section">
        <span class="badge">Simulação</span>
        <h3 style="margin-top:14px">Dados do dispositivo</h3>
        <p>Use a mesma licença e o mesmo Device ID para testar ativação, validação e desativação.</p>

        <form id="activation-simulator-form" class="form-grid" style="margin-top:20px">
          <label class="field">
            <span>Licença *</span>
            <select name="licenseKey" required>
              <option value="">Selecione uma licença...</option>
              ${usable.map(item => `
                <option value="${e(item.key)}">${e(item.customerName)} — ${e(item.key)} — ${e(statusMap[item.status]?.[0] || item.status)}</option>
              `).join("")}
            </select>
          </label>

          <label class="field">
            <span>Device ID *</span>
            <input name="deviceId" required value="GUIASYS-TEST-PC-001" placeholder="Identificador estável da máquina">
          </label>

          <div class="form-grid form-grid-2">
            <label class="field">
              <span>Nome do dispositivo</span>
              <input name="deviceName" value="PC de Teste" placeholder="PC Principal">
            </label>

            <label class="field">
              <span>Plataforma</span>
              <input name="platform" value="Windows" placeholder="Windows">
            </label>
          </div>

          <label class="field">
            <span>Versão do aplicativo</span>
            <input name="appVersion" value="0.0.0-test" placeholder="1.0.0">
          </label>

          <div class="simulator-actions">
            <button class="btn btn-primary simulator-action" data-action="activate" type="button">Ativar licença</button>
            <button class="btn btn-ghost simulator-action" data-action="validate" type="button">Validar licença</button>
            <button class="btn btn-danger simulator-action" data-action="deactivate" type="button">Desativar dispositivo</button>
          </div>
        </form>
      </article>

      <article class="card card-section">
        <span class="badge">Resposta da API</span>
        <h3 style="margin-top:14px">Resultado</h3>
        <p>Aqui você verá exatamente o que um programa integrado receberia do Worker.</p>
        <pre id="simulator-result" class="simulator-result">Aguardando uma operação...</pre>
      </article>
    </section>

    <article class="card card-section" style="margin-top:18px">
      <span class="badge">Projeto</span>
      <h3 style="margin-top:14px">Dados usados pelo simulador</h3>
      <div class="mini-info vertical">
        <div><span>Projeto</span><strong>${e(project.name)}</strong></div>
        <div><span>Project ID</span><code>${e(project.id)}</code></div>
        <div><span>Endpoints</span><code>/api/v1/license/activate · /validate · /deactivate</code></div>
      </div>
    </article>
  `;

  const form = document.querySelector("#activation-simulator-form");
  const result = document.querySelector("#simulator-result");

  if (!usable.length) {
    result.textContent = "Crie pelo menos uma licença antes de testar a ativação.";
  }

  document.querySelectorAll(".simulator-action").forEach(button => {
    button.addEventListener("click", async () => {
      if (!form.reportValidity()) return;

      const values = Object.fromEntries(new FormData(form).entries());
      const action = button.dataset.action;
      const original = button.textContent;

      document.querySelectorAll(".simulator-action").forEach(item => item.disabled = true);
      button.textContent = "Processando...";
      result.textContent = "Enviando requisição...";

      try {
        const payload = {
          projectId: state.selectedProjectId,
          licenseKey: values.licenseKey,
          deviceId: values.deviceId,
          deviceName: values.deviceName,
          platform: values.platform,
          appVersion: values.appVersion
        };

        const response = await fetch(`${API_BASE}/api/v1/license/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store"
        });

        const data = await response.json().catch(() => ({}));
        result.textContent = JSON.stringify({
          httpStatus: response.status,
          ...data
        }, null, 2);

        invalidate(state.selectedProjectId);

        if (response.ok && data.ok !== false) {
          toast(
            action === "activate"
              ? "Ativação simulada com sucesso."
              : action === "validate"
                ? "Validação concluída com sucesso."
                : "Dispositivo desativado com sucesso."
          );
        } else {
          toast(data.message || "A API recusou a operação.", "danger");
        }
      } catch (error) {
        result.textContent = JSON.stringify({
          error: "network_error",
          message: error.message
        }, null, 2);
        toast(error.message, "danger");
      } finally {
        document.querySelectorAll(".simulator-action").forEach(item => item.disabled = false);
        button.textContent = original;
      }
    });
  });
}

async function logsView() {
  const logs = await loadEntity("logs");
  el.content.innerHTML = `
    ${pageHeader("Logs", "Auditoria das ações administrativas e eventos da API.")}
    <article class="card table-shell">
      <div class="table-toolbar"><h3>Auditoria</h3><span class="badge">${logs.length} evento(s)</span></div>
      ${table(
        ["Evento", "Origem", "Data", "Detalhes"],
        logs.map(log => `
          <tr>
            <td><strong>${e(logText(log))}</strong><small><code>${e(log.action)}</code></small></td>
            <td>${e(log.actor || "—")}</td>
            <td>${formatDate(log.createdAt, true)}</td>
            <td><code class="details-code">${e(JSON.stringify(log.details || {}))}</code></td>
          </tr>
        `),
        "Nenhum log registrado."
      )}
    </article>
  `;
}

async function projectSettingsView() {
  const project = selectedProject();
  el.content.innerHTML = `
    ${pageHeader("Configurações", "Definições exclusivas de " + project.name)}
    <article class="card card-section form-page">
      <form id="project-settings-form">
        ${projectForm(project)}
        <div class="form-page-footer">
          <button class="btn btn-primary" type="submit">Salvar configurações</button>
          <button class="btn btn-danger" id="archive-project" type="button">Arquivar projeto</button>
        </div>
      </form>
    </article>
  `;

  document.querySelector("#project-settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const data = await api(`/api/v1/admin/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify(projectPayload(values))
    });
    state.projects[state.projects.findIndex(p => p.id === project.id)] = data.project;
    renderProjectSwitcher();
    invalidate(project.id);
    toast("Configurações salvas.");
  });

  document.querySelector("#archive-project").onclick = async () => {
    if (!await confirmAction("Arquivar projeto", "O projeto deixará de aparecer no seletor principal e não aceitará novas ativações.", "Arquivar")) return;
    await api(`/api/v1/admin/projects/${project.id}`, { method: "DELETE" });
    await loadProjects();
    state.selectedProjectId = "";
    state.route = "projects";
    renderProjectSwitcher();
    renderNavigation();
    toast("Projeto arquivado.");
    await renderContent();
  };
}

function platformSettingsView() {
  el.content.innerHTML = `
    ${pageHeader("Configurações da plataforma", "Informações gerais da central de licenciamento.")}
    <section class="grid grid-2">
      <article class="card card-section">
        <span class="badge">Administrador</span>
        <h3 style="margin-top:14px">Conta autorizada</h3>
        <div class="mini-info vertical">
          <div><span>Nome</span><strong>${e(state.user.displayName || "—")}</strong></div>
          <div><span>E-mail</span><strong>${e(state.user.email || "—")}</strong></div>
          <div><span>UID</span><code>${e(state.user.uid)}</code></div>
        </div>
      </article>
      <article class="card card-section">
        <span class="badge">Infraestrutura</span>
        <h3 style="margin-top:14px">Serviços</h3>
        <div class="mini-info vertical">
          <div><span>Frontend</span><strong>GitHub Pages</strong></div>
          <div><span>Autenticação</span><strong>Firebase Auth</strong></div>
          <div><span>Banco</span><strong>Cloud Firestore</strong></div>
          <div><span>API</span><strong>Cloudflare Workers</strong></div>
          <div><span>Painel</span><strong>v${PANEL_VERSION}</strong></div>
        </div>
      </article>
    </section>
  `;
}

async function renderContent() {
  el.content.innerHTML = loadingView();

  try {
    if (!state.selectedProjectId && projectItems.some(([route]) => route === state.route)) {
      state.route = "dashboard";
      renderNavigation();
    }

    if (state.selectedProjectId && !selectedProject()) {
      state.selectedProjectId = "";
      state.route = "dashboard";
      renderProjectSwitcher();
      renderNavigation();
    }

    const routes = {
      dashboard: dashboardView,
      projects: projectsView,
      "platform-settings": async () => platformSettingsView(),
      "project-dashboard": projectDashboardView,
      licenses: licensesView,
      "generate-license": generateLicenseView,
      plans: plansView,
      customers: customersView,
      devices: devicesView,
      activations: activationsView,
      "activation-simulator": activationSimulatorView,
      logs: logsView,
      "project-settings": projectSettingsView
    };

    await (routes[state.route] || dashboardView)();
    el.content.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    el.content.innerHTML = `
      ${pageHeader("Não foi possível carregar", "O módulo encontrou um erro ao consultar a API.")}
      <article class="card card-section">
        <div class="error-state">
          <strong>${e(error.message)}</strong>
          <button class="btn btn-primary" id="retry-view" type="button">Tentar novamente</button>
        </div>
      </article>
    `;
    document.querySelector("#retry-view").onclick = renderContent;
  }
}

async function enterApp(user) {
  showScreen("boot");
  state.user = user;

  try {
    state.administrator = await verifyAdministrator(user);
  } catch (error) {
    pendingLoginMessage = error.status === 403
      ? `Esta conta Google não está autorizada. UID Firebase detectado: ${user.uid}`
      : "Não foi possível validar sua sessão administrativa. Verifique a API e tente novamente.";
    await signOut(auth);
    return;
  }

  renderUser();

  try {
    await loadProjects();
    renderNavigation();
    showScreen("shell");
    await Promise.all([checkApi(), renderContent()]);
  } catch (error) {
    console.error(error);
    showScreen("shell");
    renderNavigation();
    el.content.innerHTML = `
      ${pageHeader("Backend precisa ser atualizado", "O painel está publicado, mas os endpoints completos da API ainda não responderam.")}
      <article class="card card-section">
        <div class="notice notice-danger">
          ${e(error.message)}<br><br>
          Atualize o Cloudflare Worker com o arquivo <code>worker/src/index.js</code> deste repositório.
        </div>
      </article>
    `;
    await checkApi();
  }
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
  state.cache.clear();
  state.projects = [];
  state.selectedProjectId = "";
  await signOut(auth);
});

el.projectSwitcher.addEventListener("change", async () => {
  state.selectedProjectId = el.projectSwitcher.value;
  state.route = state.selectedProjectId ? "project-dashboard" : "dashboard";
  renderNavigation();
  await renderContent();
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
  state.cache.clear();
  showScreen("login");
  setLoginMessage(pendingLoginMessage);
  pendingLoginMessage = "";
  await checkApi();
});

showScreen("boot");
