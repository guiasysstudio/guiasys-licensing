import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
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
const PANEL_VERSION = "0.10.0";
const PROTOCOL_VERSION = "GSL-v1";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
try {
  await setPersistence(auth, browserSessionPersistence);
} catch (error) {
  console.error("Não foi possível configurar a persistência da sessão Firebase.", error);
}
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
  emailLoginForm: document.querySelector("#email-login-form"),
  emailLoginButton: document.querySelector("#email-login-button"),
  emailLoginInput: document.querySelector("#email-login-input"),
  passwordLoginInput: document.querySelector("#password-login-input"),
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
  ["dashboard", "dashboard", "Dashboard", "viewDashboard"],
  ["projects", "projects", "Projetos", null],
  ["administrators", "users", "Administradores", "master"],
  ["platform-settings", "settings", "Configurações", "managePlatformSettings"]
];

const projectItems = [
  ["project-dashboard", "dashboard", "Dashboard", "viewDashboard"],
  ["licenses", "key", "Licenças", "manageLicenses"],
  ["generate-license", "plus-circle", "Gerar licença", "manageLicenses"],
  ["plans", "plans", "Planos", "managePlans"],
  ["customers", "users", "Clientes", "manageCustomers"],
  ["devices", "monitor", "Dispositivos", "manageDevices"],
  ["activations", "activity", "Ativações", "viewActivations"],
  ["activation-simulator", "flask", "Simulador", "manageLicenses"],
  ["trial", "trial", "Trial / Avaliação", "manageTrial"],
  ["integration", "plug", "Integração", "viewIntegration"],
  ["logs", "logs", "Logs", "viewLogs"],
  ["project-settings", "settings", "Configurações", "manageProjectSettings"]
];

const ADMIN_PERMISSION_LABELS = {
  viewDashboard: "Visualizar dashboards",
  manageProjects: "Criar e arquivar projetos",
  managePlans: "Gerenciar planos",
  manageCustomers: "Gerenciar clientes",
  manageLicenses: "Gerenciar licenças e usar o simulador",
  manageTrial: "Gerenciar trial / avaliação gratuita",
  viewIntegration: "Visualizar material de integração",
  manageDevices: "Gerenciar dispositivos",
  viewActivations: "Visualizar ativações",
  viewLogs: "Visualizar logs",
  manageProjectSettings: "Alterar configurações dos projetos",
  managePlatformSettings: "Visualizar configurações da plataforma"
};

const statusMap = {
  active: ["Ativa", "success"],
  inactive: ["Inativo", "muted"],
  archived: ["Arquivado", "muted"],
  pending: ["Aguardando ativação", "warning"],
  expired: ["Expirada", "danger"],
  suspended: ["Suspensa", "warning"],
  revoked: ["Revogada", "danger"],
  converted: ["Convertido em licença", "success"],
  none: ["Sem licença", "muted"]
};


function hasPermission(permission) {
  if (!permission) return true;
  if (permission === "master") return Boolean(state.administrator?.master);
  return Boolean(state.administrator?.master || state.administrator?.permissions?.[permission]);
}

function routeAllowed(route) {
  const global = globalItems.find(item => item[0] === route);
  if (global) return hasPermission(global[3]);

  const project = projectItems.find(item => item[0] === route);
  if (project) return hasPermission(project[3]);

  return true;
}

function defaultProjectRoute() {
  const first = projectItems.find(item => hasPermission(item[3]));
  return first?.[0] || "projects";
}

function canCreateProjects() {
  return Boolean(
    hasPermission("manageProjects") &&
    (state.administrator?.master || state.administrator?.allProjects)
  );
}

function iconSvg(name) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    projects: '<path d="M3 7h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 10.4 3V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.37.5.68.88.86.3.14.64.2.97.18H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    key: '<path d="M21 2 13.6 9.4"/><circle cx="8.5" cy="14.5" r="5.5"/><path d="m16 6 2 2 2-2"/><path d="m13 9 2 2"/><path d="M6.5 14.5h.01"/>',
    "plus-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    plans: '<path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3"/><path d="M8 15h8"/>',
    plug: '<path d="M8 12h8"/><path d="M9 8V4M15 8V4"/><path d="M7 8h10v3a5 5 0 0 1-5 5v4"/><path d="M9 20h6"/>',
    trial: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M8 3.5 6.5 2M16 3.5 17.5 2"/>',
    logs: '<path d="M6 4h12M6 9h12M6 14h12M6 19h12"/><path d="M3 4h.01M3 9h.01M3 14h.01M3 19h.01"/>'
  };
  return `<svg ${common}>${paths[name] || paths.dashboard}</svg>`;
}

function helpTip(text) {
  return `<span class="help-tip" tabindex="0" data-tip="${e(text)}" aria-label="${e(text)}">?</span>`;
}

function fieldTitle(label, tip = "") {
  return `<span class="field-label">${e(label)}${tip ? helpTip(tip) : ""}</span>`;
}

function onlyDigits(value, max = 32) {
  return String(value || "").replace(/\D/g, "").slice(0, max);
}

function formatPhone(value) {
  const digits = onlyDigits(value, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCurrencyInput(value) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currencyFromInput(value) {
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bindInputEnhancements(root = document) {
  root.querySelectorAll('[data-mask="phone"]').forEach(input => {
    input.value = formatPhone(input.value);
    input.addEventListener("input", () => { input.value = formatPhone(input.value); });
  });

  root.querySelectorAll('[data-mask="integer"]').forEach(input => {
    input.addEventListener("input", () => {
      input.value = onlyDigits(input.value, Number(input.dataset.maxDigits || 8));
    });
  });

  root.querySelectorAll('[data-mask="prefix"]').forEach(input => {
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    });
  });

  root.querySelectorAll('[data-mask="slug"]').forEach(input => {
    input.addEventListener("input", () => {
      input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").slice(0, 48);
    });
  });

  root.querySelectorAll('[data-mask="currency"]').forEach(input => {
    input.addEventListener("input", () => {
      const digits = onlyDigits(input.value, 12);
      input.value = (Number(digits || 0) / 100).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    });
  });
}

let pendingLoginMessage = "";
let authorizationSyncPromise = null;
let lastAuthorizationSyncAt = 0;

function e(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64UrlBytes(value) {
  const padding = "=".repeat((4 - (String(value).length % 4)) % 4);
  const base64 = (String(value) + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJwsJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

async function verifyEntitlementToken(token, publicJwk) {
  if (!token || !publicJwk) return { signatureValid: false, error: "missing_token_or_public_key" };

  const parts = String(token).split(".");
  if (parts.length !== 3) return { signatureValid: false, error: "invalid_jws" };

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJwsJson(headerPart);
  const claims = decodeJwsJson(payloadPart);

  if (header.alg !== "ES256") {
    return { signatureValid: false, error: "unexpected_algorithm", header, claims };
  }

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );

  const signatureValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64UrlBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );

  return { signatureValid, header, claims };
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

function resetAdministrativeState() {
  state.administrator = null;
  state.cache.clear();
  state.projects = [];
  state.dashboard = null;
  state.selectedProjectId = "";
  lastAuthorizationSyncAt = 0;
}

async function endAdministrativeSession(message) {
  pendingLoginMessage = message || "Sua sessão administrativa foi encerrada.";
  resetAdministrativeState();
  if (auth.currentUser) {
    await signOut(auth);
  } else {
    showScreen("login");
    setLoginMessage(pendingLoginMessage);
  }
}

function authorizationFingerprint(admin) {
  return JSON.stringify({
    master: Boolean(admin?.master),
    allProjects: Boolean(admin?.allProjects),
    projectIds: [...(admin?.projectIds || [])].sort(),
    permissions: admin?.permissions || {}
  });
}

async function syncAuthorization(force = false) {
  if (!state.user || document.hidden) return;
  if (!force && Date.now() - lastAuthorizationSyncAt < 30_000) return;
  if (authorizationSyncPromise) return await authorizationSyncPromise;

  authorizationSyncPromise = (async () => {
    const before = authorizationFingerprint(state.administrator);
    const administrator = await verifyAdministrator(state.user, false);
    const after = authorizationFingerprint(administrator);
    state.administrator = administrator;
    lastAuthorizationSyncAt = Date.now();

    if (before !== after) {
      state.cache.clear();
      await loadProjects();

      if (!routeAllowed(state.route)) {
        state.route = state.selectedProjectId ? defaultProjectRoute() : "projects";
      }

      if (state.selectedProjectId && !selectedProject()) {
        state.selectedProjectId = "";
        state.route = hasPermission("viewDashboard") ? "dashboard" : "projects";
      }

      renderUser();
      renderProjectSwitcher();
      renderNavigation();
      await renderContent();
      toast("Permissões administrativas atualizadas.", "success");
    }
  })();

  try {
    await authorizationSyncPromise;
  } catch (error) {
    console.error(error);
    if ([401, 403].includes(Number(error?.status))) {
      await endAdministrativeSession("Seu acesso administrativo foi alterado. Entre novamente se ainda possuir autorização.");
      return;
    }
  } finally {
    authorizationSyncPromise = null;
  }
}

async function api(path, options = {}, retry = true) {
  if (!state.user) {
    const error = new Error("Sessão administrativa não disponível.");
    error.status = 401;
    error.code = "authentication_required";
    throw error;
  }

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

    if (
      response.status === 401 ||
      ["admin_required", "admin_identity_mismatch", "provider_not_allowed", "recent_auth_required"].includes(data.error)
    ) {
      const message = data.error === "recent_auth_required"
        ? "Por segurança, esta ação exige login recente. Entre novamente e repita a operação."
        : "Sua sessão administrativa não é mais válida. Entre novamente.";
      await endAdministrativeSession(message);
    } else if (
      response.status === 403 &&
      ["permission_denied", "project_access_denied"].includes(data.error)
    ) {
      state.cache.clear();
      lastAuthorizationSyncAt = 0;
    }

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

async function verifyAdministrator(user, forceTokenRefresh = false) {
  const token = await user.getIdToken(forceTokenRefresh);
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

function openModal({ title, subtitle = "", body, submitLabel = "Salvar", onSubmit, onOpen = null, wide = false }) {
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

  bindInputEnhancements(backdrop);
  if (typeof onOpen === "function") onOpen(backdrop);
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
  el.globalNav.innerHTML = globalItems
    .filter(([, , , permission]) => hasPermission(permission))
    .map(([route, icon, label]) => `
      <button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
        <span class="nav-icon">${iconSvg(icon)}</span><span>${label}</span>
      </button>
    `).join("");

  el.projectNav.innerHTML = projectItems
    .filter(([, , , permission]) => hasPermission(permission))
    .map(([route, icon, label]) => `
      <button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
        <span class="nav-icon">${iconSvg(icon)}</span><span>${label}</span>
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
  const photo = state.user?.photoURL || state.administrator?.picture || "";
  el.userName.textContent = name;
  el.userEmail.textContent = state.user?.email || state.administrator?.email || "";

  if (photo) {
    el.userAvatar.textContent = "";
    el.userAvatar.style.backgroundImage = `url("${photo.replace(/"/g, "%22")}")`;
    el.userAvatar.classList.add("has-photo");
  } else {
    el.userAvatar.style.backgroundImage = "";
    el.userAvatar.classList.remove("has-photo");
    el.userAvatar.textContent = initials(name);
  }

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

async function loadProjectDetail(projectId = state.selectedProjectId, force = false) {
  if (!projectId) throw new Error("Projeto não selecionado.");

  const key = `${projectId}:project-detail`;
  if (!force && state.cache.has(key)) return state.cache.get(key);

  const data = await api(`/api/v1/admin/projects/${encodeURIComponent(projectId)}`);
  const summary = state.projects.find(project => project.id === projectId) || {};
  const project = { ...summary, ...(data.project || {}) };
  const index = state.projects.findIndex(item => item.id === projectId);

  if (index >= 0) state.projects[index] = project;
  state.cache.set(key, project);
  renderProjectSwitcher();
  return project;
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
    "trial.started": "Trial iniciado",
    "trial.expired": "Trial expirado",
    "trial.converted": "Trial convertido em licença",
    "trial.reset": "Trial redefinido",
    "device.deactivated": "Dispositivo desativado",
    "device.deactivated.admin": "Dispositivo removido pelo administrador",
    "admin.created": "Administrador cadastrado",
    "admin.updated": "Administrador atualizado",
    "admin.deleted": "Administrador removido",
    "admin.identity_bound": "Identidade Firebase vinculada"
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
    ${pageHeader(
      "Dashboard geral",
      "Visão consolidada de todos os projetos do GuiaSys Licensing.",
      canCreateProjects() ? '<button class="btn btn-primary" id="dashboard-new-project" type="button">+ Novo projeto</button>' : ""
    )}

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

  document.querySelector("#dashboard-new-project")?.addEventListener("click", openProjectCreate);
}

async function projectsView() {
  const canCreate = canCreateProjects();
  const canEdit = hasPermission("manageProjectSettings");

  el.content.innerHTML = `
    ${pageHeader(
      "Projetos",
      "Cada projeto possui um ambiente de licenciamento totalmente independente.",
      canCreate ? '<button class="btn btn-primary" id="new-project" type="button">+ Novo projeto</button>' : ""
    )}

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
              ${canEdit ? '<button class="btn btn-ghost edit-project" type="button">Editar</button>' : ""}
            </div>
          </article>
        `).join("")
        : emptyState(
            "Nenhum projeto disponível",
            state.administrator?.master
              ? "Cadastre seu primeiro produto para começar."
              : "Nenhum projeto foi liberado para esta conta.",
            canCreate ? '<button class="btn btn-primary" id="empty-new-project" type="button">Criar primeiro projeto</button>' : ""
          )}
    </section>
  `;

  document.querySelector("#new-project")?.addEventListener("click", openProjectCreate);
  document.querySelector("#empty-new-project")?.addEventListener("click", openProjectCreate);

  document.querySelectorAll(".project-card").forEach(card => {
    const id = card.dataset.project;
    card.querySelector(".open-project").onclick = async () => {
      state.selectedProjectId = id;
      state.route = defaultProjectRoute();
      renderProjectSwitcher();
      renderNavigation();
      await renderContent();
    };
    card.querySelector(".edit-project")?.addEventListener("click", async () => {
      openProjectEdit(await loadProjectDetail(id, true));
    });
  });
}

function projectForm(project = {}) {
  return `
    <div class="form-grid form-grid-2">
      <label class="field">
        ${fieldTitle("Nome do projeto *", "Nome que identifica o produto dentro do GuiaSys Licensing.")}
        <input name="name" required maxlength="80" value="${e(project.name || "")}" placeholder="Ex.: MeuProduto">
      </label>
      <label class="field">
        ${fieldTitle("Prefixo da key *", "Sigla usada no início das chaves geradas. Exemplo: APP-XXXXX-... para um produto com prefixo APP.")}
        <input name="prefix" required maxlength="8" data-mask="prefix" value="${e(project.prefix || "")}" placeholder="GPL">
      </label>
      <label class="field">
        ${fieldTitle("Slug", "Identificador técnico amigável do projeto, usado internamente. Use letras minúsculas, números e hífen.")}
        <input name="slug" maxlength="48" data-mask="slug" value="${e(project.slug || "")}" placeholder="guiaplay">
      </label>
      <label class="field">
        ${fieldTitle("Status", "Projetos inativos não aceitam novas ativações de licença.")}
        <select name="status">
          <option value="active" ${project.status !== "inactive" ? "selected" : ""}>Ativo</option>
          <option value="inactive" ${project.status === "inactive" ? "selected" : ""}>Inativo</option>
        </select>
      </label>
      <label class="field">
        ${fieldTitle("Dias permitidos offline", "Período máximo que o aplicativo pode continuar funcionando sem conseguir validar a licença pela internet.")}
        <input name="offlineDays" inputmode="numeric" data-mask="integer" data-max-digits="4" value="${e(project.offlineDays ?? 7)}">
      </label>
      <label class="field">
        ${fieldTitle("Intervalo de validação (horas)", "Frequência com que o aplicativo deve consultar o servidor para confirmar se a licença continua válida.")}
        <input name="validationHours" inputmode="numeric" data-mask="integer" data-max-digits="4" value="${e(project.validationHours ?? 24)}">
      </label>
      <label class="field check-field">
        <input name="publicCatalog" type="checkbox" value="true" ${project.publicCatalog ? "checked" : ""}>
        ${fieldTitle("Disponível no portal do cliente", "Quando ativado, este produto poderá aparecer no futuro site GuiaSys Licensing Client. Somente planos marcados para venda serão exibidos.")}
      </label>
      <label class="field field-full">
        ${fieldTitle("Domínios permitidos para integração Web", "Um domínio por linha. Sites JavaScript/TypeScript só poderão chamar a API pública deste projeto a partir destas origens. Aplicativos desktop/mobile não usam esta restrição de navegador.")}
        <textarea name="allowedOrigins" rows="3" placeholder="https://app.exemplo.com&#10;https://www.exemplo.com">${e((project.allowedOrigins || []).join("\n"))}</textarea>
      </label>
      <label class="field field-full">
        ${fieldTitle("Descrição", "Descrição interna para ajudar a identificar o projeto.")}
        <textarea name="description" rows="3" maxlength="300" placeholder="Descrição interna do projeto">${e(project.description || "")}</textarea>
      </label>
    </div>
  `;
}

function projectPayload(values, form = null) {
  return {
    ...values,
    publicCatalog: form ? form.elements.publicCatalog?.checked === true : Boolean(values.publicCatalog),
    offlineDays: Number(values.offlineDays || 0),
    validationHours: Math.max(1, Number(values.validationHours || 24))
  };
}

function openProjectCreate() {
  openModal({
    title: "Novo projeto",
    subtitle: "Um ambiente independente será criado para este produto.",
    body: projectForm(),
    submitLabel: "Criar projeto",
    wide: true,
    onSubmit: async (values, form) => {
      const data = await api("/api/v1/admin/projects", {
        method: "POST",
        body: JSON.stringify(projectPayload(values, form))
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
    onSubmit: async (values, form) => {
      const data = await api(`/api/v1/admin/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify(projectPayload(values, form))
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

function bindPlanFormBehavior(form) {
  const lifetime = form.elements.lifetime;
  const duration = form.elements.durationDays;
  if (!lifetime || !duration) return;

  const sync = () => {
    duration.disabled = lifetime.checked;
    duration.closest(".field")?.classList.toggle("field-locked", lifetime.checked);
    if (lifetime.checked) duration.value = "0";
    else if (!Number(duration.value)) duration.value = "30";
  };

  lifetime.addEventListener("change", sync);
  sync();
}

function planForm(plan = {}) {
  return `
    <div class="form-grid form-grid-2">
      <label class="field field-full">
        ${fieldTitle("Nome do plano *", "Nome comercial ou interno do plano. Exemplo: Mensal, Anual, ADM.")}
        <input name="name" required maxlength="80" value="${e(plan.name || "")}" placeholder="Ex.: Mensal">
      </label>
      <label class="field">
        ${fieldTitle("Preço (R$)", "Valor do plano em reais. O campo aceita somente valor monetário.")}
        <div class="money-input"><span>R$</span><input name="price" inputmode="numeric" data-mask="currency" value="${e(formatCurrencyInput(plan.price ?? 0))}"></div>
      </label>
      <label class="field">
        ${fieldTitle("Dispositivos", "Quantidade máxima de dispositivos que podem ficar ativos ao mesmo tempo nesta licença.")}
        <input name="deviceLimit" inputmode="numeric" data-mask="integer" data-max-digits="3" value="${e(plan.deviceLimit ?? 1)}">
      </label>
      <label class="field">
        ${fieldTitle("Duração em dias", "Quantidade de dias de validade. É ignorada quando o plano é vitalício.")}
        <input name="durationDays" inputmode="numeric" data-mask="integer" data-max-digits="5" value="${e(plan.lifetime ? 0 : (plan.durationDays || 30))}">
      </label>
      <label class="field">
        ${fieldTitle("Início da validade", "Define se a contagem começa no momento da emissão da key ou somente na primeira ativação.")}
        <select name="startMode">
          <option value="first_activation" ${(plan.startMode || "first_activation") === "first_activation" ? "selected" : ""}>Na primeira ativação</option>
          <option value="immediate" ${plan.startMode === "immediate" ? "selected" : ""}>Imediatamente ao gerar</option>
        </select>
      </label>
      <label class="field check-field">
        <input name="lifetime" type="checkbox" value="true" ${plan.lifetime ? "checked" : ""}>
        ${fieldTitle("Licença vitalícia", "Quando ativado, a licença não possui data de expiração.")}
      </label>
      <label class="field check-field">
        <input name="active" type="checkbox" value="true" ${plan.active !== false ? "checked" : ""}>
        ${fieldTitle("Plano ativo", "Planos inativos deixam de aparecer para novas emissões, mas licenças já emitidas continuam existindo.")}
      </label>
      <label class="field check-field">
        <input name="publicCatalog" type="checkbox" value="true" ${plan.publicCatalog ? "checked" : ""}>
        ${fieldTitle("Disponível para venda no portal", "Quando ativado, este plano poderá ser exibido no GuiaSys Licensing Client se o projeto também estiver público.")}
      </label>
      <label class="field field-full">
        ${fieldTitle("Descrição", "Informação interna sobre o plano.")}
        <textarea name="description" rows="3">${e(plan.description || "")}</textarea>
      </label>
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
        ["Plano", "Preço", "Duração", "Dispositivos", "Status", "Portal", ""],
        plans.map(plan => `
          <tr>
            <td><strong>${e(plan.name)}</strong><small>${e(plan.description || "")}</small></td>
            <td>${formatMoney(plan.price)}</td>
            <td>${plan.lifetime ? '<span class="badge badge-success">Vitalício</span>' : `${e(plan.durationDays)} dias`}</td>
            <td>${e(plan.deviceLimit)}</td>
            <td>${plan.active ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-muted">Inativo</span>'}</td>
            <td>${plan.publicCatalog ? '<span class="badge badge-success">Venda</span>' : '<span class="badge badge-muted">Oculto</span>'}</td>
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
    onOpen: backdrop => bindPlanFormBehavior(backdrop.querySelector(".modal-form")),
    onSubmit: async (values, form) => {
      const payload = {
        ...values,
        price: currencyFromInput(values.price),
        durationDays: form.elements.lifetime.checked ? 0 : Number(values.durationDays || 30),
        deviceLimit: Number(values.deviceLimit || 1),
        startMode: values.startMode || "first_activation",
        lifetime: form.elements.lifetime.checked,
        active: form.elements.active.checked,
        publicCatalog: form.elements.publicCatalog.checked
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
      <label class="field">
        ${fieldTitle("Nome *", "Nome do cliente que ficará vinculado às licenças deste projeto.")}
        <input name="name" required maxlength="120" value="${e(customer.name || "")}">
      </label>
      <label class="field">
        ${fieldTitle("E-mail *", "E-mail de identificação e contato do cliente.")}
        <input name="email" type="email" required maxlength="160" value="${e(customer.email || "")}">
      </label>
      <label class="field">
        ${fieldTitle("Telefone", "Telefone brasileiro com DDD. Exemplo: (69) 99999-9999.")}
        <input name="phone" inputmode="numeric" data-mask="phone" maxlength="15" value="${e(customer.phone || "")}" placeholder="(69) 99999-9999">
      </label>
      <label class="field">
        ${fieldTitle("Status", "Clientes inativos permanecem no histórico, mas não podem receber novas licenças.")}
        <select name="status">
          <option value="active" ${customer.status !== "inactive" ? "selected" : ""}>Ativo</option>
          <option value="inactive" ${customer.status === "inactive" ? "selected" : ""}>Inativo</option>
        </select>
      </label>
      <label class="field field-full">
        ${fieldTitle("Observações", "Notas internas sobre o cliente.")}
        <textarea name="notes" rows="4">${e(customer.notes || "")}</textarea>
      </label>
    </div>
  `;
}

async function customersView() {
  const customers = await loadEntity("customers", true);
  el.content.innerHTML = `
    ${pageHeader("Clientes", "Clientes cadastrados somente dentro deste projeto.",
      '<button class="btn btn-primary" id="new-customer" type="button">+ Novo cliente</button>')}
    <article class="card table-shell">
      <div class="table-toolbar"><h3>Clientes</h3><span class="badge">${customers.length} registro(s)</span></div>
      ${table(
        ["Cliente", "E-mail", "Cliente", "Status da licença", "Licenças", "Cadastro", ""],
        customers.map(customer => `
          <tr>
            <td>
              <strong>${e(customer.name)}</strong>
              ${customer.recoveredFromLicense ? '<small>Cadastro recuperado do histórico de licença</small>' : ""}
            </td>
            <td>${e(customer.email || "—")}</td>
            <td>${badge(customer.status)}</td>
            <td>
              ${badge(customer.licenseStatus || "none")}
              ${customer.licenseCount > 1 ? `<small>${e(customer.activeLicenseCount || 0)} ativa(s) de ${e(customer.licenseCount)} total</small>` : ""}
            </td>
            <td>${e(customer.licenseCount || 0)}</td>
            <td>${formatDate(customer.createdAt)}</td>
            <td class="table-actions">
              <button class="btn btn-ghost btn-sm edit-customer" data-id="${e(customer.id)}">Editar</button>
              ${customer.licenseCount > 0
                ? `<button class="btn btn-ghost btn-sm disable-customer" data-id="${e(customer.id)}">${customer.status === "inactive" ? "Ativar" : "Desativar"}</button>`
                : `<button class="btn btn-ghost btn-sm delete-customer" data-id="${e(customer.id)}">Excluir</button>`}
            </td>
          </tr>
        `),
        "Cadastre um cliente antes de gerar uma licença."
      )}
    </article>
  `;

  document.querySelector("#new-customer").onclick = () => openCustomer();
  document.querySelectorAll(".edit-customer").forEach(button => button.onclick = () => openCustomer(customers.find(c => c.id === button.dataset.id)));

  document.querySelectorAll(".disable-customer").forEach(button => button.onclick = async () => {
    const customer = customers.find(c => c.id === button.dataset.id);
    const nextStatus = customer.status === "inactive" ? "active" : "inactive";
    await api(`/api/v1/admin/projects/${state.selectedProjectId}/customers/${customer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus })
    });
    invalidate(state.selectedProjectId);
    toast(nextStatus === "active" ? "Cliente reativado." : "Cliente desativado.");
    await renderContent();
  });

  document.querySelectorAll(".delete-customer").forEach(button => button.onclick = async () => {
    const customer = customers.find(c => c.id === button.dataset.id);
    if (!await confirmAction("Excluir cliente", `Excluir "${customer.name}" deste projeto?`, "Excluir")) return;
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

function bindLicensePlanBehavior(form) {
  const planSelect = form.elements.planId;
  const duration = form.elements.durationDays;
  const devices = form.elements.maxDevices;
  const startMode = form.elements.startMode;
  const lifetime = form.elements.lifetime;
  const note = form.querySelector("#plan-lock-note");

  if (!planSelect) return;

  const fields = [duration, devices, startMode, lifetime].filter(Boolean);

  const sync = () => {
    const option = planSelect.selectedOptions[0];
    const hasPlan = Boolean(option?.value);

    if (hasPlan) {
      const isLifetime = option.dataset.lifetime === "true";
      duration.value = isLifetime ? "0" : (option.dataset.duration || "30");
      devices.value = option.dataset.devices || "1";
      startMode.value = option.dataset.startMode || "first_activation";
      lifetime.checked = isLifetime;
    }

    fields.forEach(control => {
      control.disabled = hasPlan;
      control.closest(".field")?.classList.toggle("field-locked", hasPlan);
    });

    if (!hasPlan && duration.value === "0") duration.value = "30";
    if (note) {
      note.textContent = hasPlan
        ? "As regras deste plano foram carregadas automaticamente e não podem ser alteradas nesta emissão."
        : "Licença personalizada: você pode definir duração, dispositivos, início da validade e vitalício.";
      note.classList.toggle("plan-note-locked", hasPlan);
    }
  };

  planSelect.addEventListener("change", sync);
  sync();
}

async function licenseFormHtml() {
  const [customers, plans] = await Promise.all([loadEntity("customers", true), loadEntity("plans", true)]);

  return `
    <div class="form-grid form-grid-2">
      <label class="field field-full">
        ${fieldTitle("Cliente *", "Cliente que será dono desta licença.")}
        <select name="customerId" required>
          <option value="">Selecione...</option>
          ${customers.map(c => `<option value="${e(c.id)}" ${c.status === "inactive" ? "disabled" : ""}>${e(c.name)} — ${e(c.email)}${c.status === "inactive" ? " — Inativo" : ""}</option>`).join("")}
        </select>
      </label>
      <label class="field field-full">
        ${fieldTitle("Plano", "Escolha um plano cadastrado ou use Licença personalizada. Ao escolher um plano, as regras ficam bloqueadas para edição.")}
        <select name="planId" id="license-plan">
          <option value="">Licença personalizada</option>
          ${plans.filter(p => p.active !== false).map(p => `
            <option
              value="${e(p.id)}"
              data-duration="${e(p.durationDays || 0)}"
              data-devices="${e(p.deviceLimit || 1)}"
              data-lifetime="${p.lifetime ? "true" : "false"}"
              data-start-mode="${e(p.startMode || "first_activation")}"
            >${e(p.name)} — ${p.lifetime ? "Vitalício" : `${e(p.durationDays)} dias`} — ${e(p.deviceLimit)} disp.</option>
          `).join("")}
        </select>
        <small id="plan-lock-note" class="plan-lock-note"></small>
      </label>
      <label class="field">
        ${fieldTitle("Duração personalizada (dias)", "Quantidade de dias de validade. Disponível somente para licença personalizada.")}
        <input name="durationDays" inputmode="numeric" data-mask="integer" data-max-digits="5" value="30">
      </label>
      <label class="field">
        ${fieldTitle("Máximo de dispositivos", "Quantidade de dispositivos ativos permitidos. Disponível somente para licença personalizada.")}
        <input name="maxDevices" inputmode="numeric" data-mask="integer" data-max-digits="3" value="1">
      </label>
      <label class="field">
        ${fieldTitle("Início da validade", "Define quando começa a contar o prazo da licença. Disponível somente para licença personalizada.")}
        <select name="startMode">
          <option value="first_activation">Na primeira ativação</option>
          <option value="immediate">Imediatamente</option>
        </select>
      </label>
      <label class="field check-field">
        <input name="lifetime" type="checkbox" value="true">
        ${fieldTitle("Vitalícia", "Licença sem data de expiração. Disponível somente para licença personalizada.")}
      </label>
      <label class="field field-full">
        ${fieldTitle("Observações", "Observações específicas desta licença. Este campo continua editável mesmo quando um plano é selecionado.")}
        <textarea name="notes" rows="3"></textarea>
      </label>
    </div>
  `;
}

async function openLicenseCreate(onCreated = null) {
  const [plans, html] = await Promise.all([loadEntity("plans", true), licenseFormHtml()]);
  openModal({
    title: "Gerar licença",
    subtitle: selectedProject().name,
    body: html,
    submitLabel: "Gerar licença",
    wide: true,
    onOpen: backdrop => bindLicensePlanBehavior(backdrop.querySelector(".modal-form")),
    onSubmit: async (values, form) => {
      const selectedPlan = plans.find(p => p.id === values.planId);
      const payload = selectedPlan
        ? {
            customerId: values.customerId,
            planId: selectedPlan.id,
            durationDays: selectedPlan.durationDays,
            maxDevices: selectedPlan.deviceLimit,
            lifetime: Boolean(selectedPlan.lifetime),
            startMode: selectedPlan.startMode || "first_activation",
            notes: values.notes || ""
          }
        : {
            ...values,
            durationDays: Number(values.durationDays || 30),
            maxDevices: Number(values.maxDevices || 1),
            lifetime: form.elements.lifetime.checked,
            startMode: values.startMode || "first_activation"
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
  const actions = [];
  const suspendedExpired = Boolean(
    license.status === "suspended" &&
    !license.lifetime &&
    license.expiresAt &&
    new Date(license.expiresAt).getTime() <= Date.now()
  );

  if (!license.lifetime && license.status !== "revoked") {
    actions.push(["renew", "Renovar", "primary"]);
  }

  if (license.status === "suspended" && !suspendedExpired) {
    actions.push(["reactivate", "Reativar", "primary"]);
  } else if (["active", "pending"].includes(license.status)) {
    actions.push(["suspend", "Suspender", "ghost"]);
  }

  if (license.status !== "revoked") {
    actions.push(["revoke", "Revogar", "danger"]);
  }

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

  const plans = await loadEntity("plans", true);
  const form = document.querySelector("#generate-license-form");
  bindInputEnhancements(form);
  bindLicensePlanBehavior(form);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const selectedPlan = plans.find(p => p.id === values.planId);

      const payload = selectedPlan
        ? {
            customerId: values.customerId,
            planId: selectedPlan.id,
            durationDays: selectedPlan.durationDays,
            maxDevices: selectedPlan.deviceLimit,
            lifetime: Boolean(selectedPlan.lifetime),
            startMode: selectedPlan.startMode || "first_activation",
            notes: values.notes || ""
          }
        : {
            ...values,
            durationDays: Number(values.durationDays || 30),
            maxDevices: Number(values.maxDevices || 1),
            lifetime: form.elements.lifetime.checked,
            startMode: values.startMode || "first_activation"
          };

      const data = await api(`/api/v1/admin/projects/${state.selectedProjectId}/licenses`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      invalidate(state.selectedProjectId);
      showGeneratedLicense(data.license);
      form.reset();
      bindLicensePlanBehavior(form);
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
    ${pageHeader("Simulador", "Teste os fluxos de licença e trial de " + project.name + " sem precisar integrar o produto ainda.")}

    <section class="grid grid-2 simulator-grid">
      <article class="card card-section">
        <span class="badge">Simulação</span>
        <h3 style="margin-top:14px">Dados do dispositivo</h3>
        <p>Use a mesma licença e o mesmo Device ID para testar ativação, validação e desativação.</p>

        <form id="activation-simulator-form" class="form-grid" style="margin-top:20px">
          <label class="field">
            ${fieldTitle("Licença *", "Licença que será enviada para a API durante o teste.")}
            <select name="licenseKey" required>
              <option value="">Selecione uma licença...</option>
              ${usable.map(item => `
                <option value="${e(item.key)}">${e(item.customerName)} — ${e(item.key)} — ${e(statusMap[item.status]?.[0] || item.status)}</option>
              `).join("")}
            </select>
          </label>

          <label class="field">
            ${fieldTitle("Device ID *", "Identificador estável e único do dispositivo. Em produção, o aplicativo deverá gerar ou recuperar esse identificador automaticamente.")}
            <input name="deviceId" required value="GUIASYS-TEST-PC-001" placeholder="Identificador estável da máquina">
          </label>

          <div class="form-grid form-grid-2">
            <label class="field">
              ${fieldTitle("Nome do dispositivo", "Nome amigável apenas para facilitar a identificação no painel.")}
              <input name="deviceName" value="PC de Teste" placeholder="PC Principal">
            </label>

            <label class="field">
              ${fieldTitle("Plataforma", "Sistema operacional ou plataforma do dispositivo que está ativando a licença.")}
              <input name="platform" value="Windows" placeholder="Windows">
            </label>
          </div>

          <label class="field">
            ${fieldTitle("Versão do aplicativo", "Versão do programa que realizou a ativação ou validação.")}
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
        <div><span>Código de integração</span><code>${e(project.integrationCode || "—")}</code></div>
        <div><span>Project ID</span><code>${e(project.id)}</code></div>
        <div><span>Endpoints</span><code>/api/v1/license/activate · /validate · /deactivate</code></div>
      </div>
    </article>

    <article class="card card-section" style="margin-top:18px">
      <div class="section-heading">
        <div>
          <span class="eyebrow">SIMULADOR DE TRIAL</span>
          <h3>Teste sem instalar o produto</h3>
          <p>Use o mesmo Device ID para testar início, revalidação, expiração e a regra de não reiniciar o período.</p>
        </div>
      </div>
      <div class="form-grid form-grid-2">
        <label class="field">
          ${fieldTitle("Device ID de teste", "Identificador estável usado para representar o mesmo computador durante os testes.")}
          <input id="trial-test-device-id" value="TRIAL-TEST-${e(project.prefix || "GSS")}-01">
        </label>
        <label class="field">
          ${fieldTitle("Nome do dispositivo", "Nome apenas informativo para aparecer no histórico.")}
          <input id="trial-test-device-name" value="PC Teste">
        </label>
        <label class="field">
          ${fieldTitle("Plataforma", "Plataforma enviada pelo produto real.")}
          <input id="trial-test-platform" value="Windows">
        </label>
        <label class="field">
          ${fieldTitle("Versão", "A versão é metadado e não altera a validade do trial.")}
          <input id="trial-test-version" value="1.0.0">
        </label>
      </div>
      <div class="form-page-footer trial-test-actions">
        <button class="btn btn-primary" id="trial-test-start" type="button">Iniciar / consultar trial</button>
        <button class="btn btn-ghost" id="trial-test-validate" type="button">Validar trial</button>
      </div>
      <pre id="trial-test-result" class="integration-contract trial-test-result">Nenhum teste executado.</pre>
    </article>
  `;

  const form = document.querySelector("#activation-simulator-form");
  const result = document.querySelector("#simulator-result");

  if (!usable.length) {
    result.textContent = "Crie pelo menos uma licença antes de testar a ativação.";
  }

  const withEntitlementVerification = async data => {
    const entitlement = data?.license?.entitlement || data?.trial?.entitlement;
    if (!entitlement?.token) return data;

    try {
      const verification = await verifyEntitlementToken(entitlement.token, project.signingPublicJwk);
      return { ...data, clientVerification: verification };
    } catch (error) {
      return {
        ...data,
        clientVerification: {
          signatureValid: false,
          error: error.message
        }
      };
    }
  };

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
          integrationCode: project.integrationCode,
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
        const verifiedData = await withEntitlementVerification(data);
        result.textContent = JSON.stringify({
          httpStatus: response.status,
          ...verifiedData
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


  const runTrialTest = async action => {
    const result = document.querySelector("#trial-test-result");
    const payload = {
      integrationCode: project.integrationCode,
      deviceId: document.querySelector("#trial-test-device-id").value.trim(),
      deviceName: document.querySelector("#trial-test-device-name").value.trim(),
      platform: document.querySelector("#trial-test-platform").value.trim(),
      appVersion: document.querySelector("#trial-test-version").value.trim()
    };

    if (!payload.deviceId) {
      result.textContent = "Informe um Device ID de teste.";
      return;
    }

    result.textContent = "Consultando...";
    try {
      const response = await fetch(`${API_BASE}/api/v1/trial/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      const verifiedData = await withEntitlementVerification(data);
      result.textContent = JSON.stringify({
        httpStatus: response.status,
        ...verifiedData
      }, null, 2);
      invalidate(project.id);

      if (response.ok && data.ok !== false) {
        toast(action === "start" ? "Trial consultado com sucesso." : "Trial validado com sucesso.");
      } else {
        toast(data.message || "A API recusou a operação.", "danger");
      }
    } catch (error) {
      result.textContent = JSON.stringify({
        error: "network_error",
        message: error.message
      }, null, 2);
      toast(error.message, "danger");
    }
  };

  document.querySelector("#trial-test-start").addEventListener("click", () => runTrialTest("start"));
  document.querySelector("#trial-test-validate").addEventListener("click", () => runTrialTest("validate"));
  });
}


async function trialView() {
  const project = await loadProjectDetail();
  const trials = await loadEntity("trials", true);
  const convertedTrials = trials.filter(item => item.status === "converted");
  const activeTrials = trials.filter(item => item.status !== "converted" && item.status !== "expired" && new Date(item.expiresAt).getTime() > Date.now());
  const expiredTrials = trials.filter(item => item.status === "expired" || (item.status !== "converted" && new Date(item.expiresAt).getTime() <= Date.now())).length;

  el.content.innerHTML = `
    ${pageHeader(
      "Trial / Avaliação",
      "Controle centralizado do período gratuito de " + project.name + ".",
      '<span class="badge">' + trials.length + ' dispositivo(s)</span>'
    )}

    <section class="grid grid-4">
      ${metric("Trial", project.trialEnabled && Number(project.trialDays || 0) > 0 ? "Ativo" : "Desativado", project.trialEnabled ? (project.trialDays || 0) + " dia(s) para novos trials" : "Não oferecer avaliação")}
      ${metric("Em avaliação", activeTrials.length, "Trials ainda ativos")}
      ${metric("Convertidos", convertedTrials.length, "Ativaram licença paga")}
      ${metric("Expirados", expiredTrials, "Histórico preservado")}
    </section>

    <article class="card card-section form-page" style="margin-top:18px">
      <div class="section-heading">
        <div>
          <span class="eyebrow">POLÍTICA DE AVALIAÇÃO</span>
          <h3>Regras para novos trials</h3>
          <p>Alterações feitas aqui valem para novos trials. Um trial já iniciado mantém a duração e a data de expiração registradas no início.</p>
        </div>
      </div>

      <form id="trial-settings-form">
        <div class="form-grid form-grid-2">
          <label class="field check-field">
            <input name="trialEnabled" type="checkbox" value="true" ${project.trialEnabled ? "checked" : ""}>
            ${fieldTitle("Ativar avaliação gratuita", "Quando desativado, novas instalações sem licença não recebem período grátis.")}
          </label>

          <label class="field">
            ${fieldTitle("Duração do trial (dias)", "Quantidade de dias concedida no momento em que um NOVO dispositivo inicia o trial online.")}
            <input name="trialDays" inputmode="numeric" data-mask="integer" data-max-digits="4" value="${e(project.trialDays ?? 7)}">
          </label>

          <label class="field">
            ${fieldTitle("Validar online a cada (horas)", "Frequência recomendada para o produto confirmar no servidor se o trial continua válido.")}
            <input name="trialValidationHours" inputmode="numeric" data-mask="integer" data-max-digits="4" value="${e(project.trialValidationHours ?? project.validationHours ?? 24)}">
          </label>

          <label class="field">
            ${fieldTitle("Tolerância offline (horas)", "Tempo máximo sem uma validação online. O trial nunca pode ultrapassar a data expiresAt, mesmo offline.")}
            <input name="trialOfflineHours" inputmode="numeric" data-mask="integer" data-max-digits="5" value="${e(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24)}">
          </label>
        </div>

        <div class="notice" style="margin-top:16px">
          A primeira ativação do trial sempre exige internet. Atualizar ou reinstalar o produto não reinicia o trial para o mesmo Device ID.
        </div>

        <div class="form-page-footer">
          <button class="btn btn-primary" type="submit">Salvar política de trial</button>
        </div>
      </form>
    </article>

    <article class="card table-shell" style="margin-top:18px">
      <div class="table-toolbar">
        <div><span class="eyebrow">HISTÓRICO</span><h3>Dispositivos que usaram trial</h3></div>
        <span class="badge">${trials.length} registro(s)</span>
      </div>
      ${table(
        ["Dispositivo", "Início", "Expiração", "Duração", "Versão", "Último contato", "Status", ""],
        trials.map(trial => {
          const converted = trial.status === "converted";
          const expired = !converted && (trial.status === "expired" || new Date(trial.expiresAt).getTime() <= Date.now());
          return `
            <tr>
              <td><strong>${e(trial.deviceName || "Dispositivo")}</strong><small>${e(trial.platform || "")}</small></td>
              <td>${formatDate(trial.startedAt, true)}</td>
              <td>${formatDate(trial.expiresAt, true)}</td>
              <td>${e(trial.durationDays || 0)} dia(s)</td>
              <td>${e(trial.appVersion || "—")}</td>
              <td>${formatDate(trial.lastSeenAt, true)}</td>
              <td>${converted ? '<span class="badge badge-success">Convertido</span>' : (expired ? '<span class="badge badge-danger">Expirado</span>' : '<span class="badge badge-success">Ativo</span>')}</td>
              <td class="table-actions"><button class="btn btn-ghost btn-sm reset-trial" data-id="${e(trial.id)}" type="button">Redefinir</button></td>
            </tr>
          `;
        }),
        "Nenhum dispositivo iniciou um trial ainda."
      )}
    </article>
  `;

  bindInputEnhancements(el.content);

  document.querySelector("#trial-settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = {
      trialEnabled: form.elements.trialEnabled.checked,
      trialDays: Math.max(0, Number(values.trialDays || 0)),
      trialValidationHours: Math.max(1, Number(values.trialValidationHours || 24)),
      trialOfflineHours: Math.max(0, Number(values.trialOfflineHours || 0))
    };

    const data = await api(`/api/v1/admin/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    state.projects[state.projects.findIndex(item => item.id === project.id)] = data.project;
    invalidate(project.id);
    toast("Política de trial atualizada.");
    await renderContent();
  });

  document.querySelectorAll(".reset-trial").forEach(button => {
    button.addEventListener("click", async () => {
      const trial = trials.find(item => item.id === button.dataset.id);
      if (!await confirmAction(
        "Redefinir trial deste dispositivo?",
        `O histórico de avaliação de "${trial?.deviceName || "Dispositivo"}" será removido e este Device ID poderá iniciar um NOVO trial usando a política atual. Use somente em suporte/testes.`,
        "Redefinir"
      )) return;

      await api(`/api/v1/admin/projects/${project.id}/trials/${encodeURIComponent(button.dataset.id)}/reset`, {
        method: "POST",
        body: JSON.stringify({})
      });
      invalidate(project.id);
      toast("Trial redefinido.");
      await renderContent();
    });
  });
}

function integrationPlatformNotes(platform) {
  const notes = {
    universal: [
      "Use uma camada própria de licenciamento separada da lógica de negócio.",
      "Use armazenamento seguro adequado à plataforma para a key e para o estado local da licença.",
      "O identificador do dispositivo deve ser estável entre atualizações do aplicativo.",
      "Nunca embuta credenciais administrativas, Service Account ou segredos do Worker."
    ],
    dotnet: [
      "Crie um serviço como GuiaSysLicensingService ou um projeto reutilizável GuiaSys.Licensing.",
      "Use HttpClient com timeout e CancellationToken; não bloqueie a UI.",
      "No Windows, derive um Device ID estável do sistema e armazene dados sensíveis com DPAPI/ProtectedData quando aplicável.",
      "Separe modelos de request/response, estado local e apresentação da UI.",
      "A validação deve ocorrer no startup em background quando já houver cache válido, respeitando validationHours."
    ],
    web: [
      "Use fetch/HTTPS e nunca coloque credenciais administrativas no JavaScript.",
      "Aplicações web não devem confiar em armazenamento local para liberar longos períodos offline.",
      "Use o integrationCode como identificador preferencial no frontend; o projectId permanece apenas para compatibilidade e também não é segredo.",
      "Em aplicações web, não confie em LocalStorage/IndexedDB como mecanismo de segurança. Para um site licenciado, a decisão de liberar recursos deve ser validada no backend/servidor sempre que houver backend disponível.",
      "Um frontend JavaScript puro não oferece proteção offline forte contra adulteração; nesse cenário, trate a conexão com o servidor como requisito para operações licenciadas sensíveis."
    ],
    android: [
      "Implemente a integração em um Repository/Service separado da UI.",
      "Use Android Keystore para proteger material local quando aplicável.",
      "Não dependa apenas de um UUID salvo localmente, pois a desinstalação pode apagá-lo. No Android moderno, derive uma identidade estável apropriada à plataforma (por exemplo, ANDROID_ID no escopo do app/assinatura, devidamente hashado) e trate troca de assinatura, usuário ou reset de fábrica como possível mudança de dispositivo.",
      "Chamadas de rede devem ser assíncronas e a UI deve tratar claramente sem conexão, expiração e limite de dispositivos."
    ],
    ios: [
      "Implemente a integração em uma camada Service/Repository separada da UI.",
      "Use Keychain para armazenar License Key, estado local e material de autorização sensível.",
      "Não dependa de um identificador de hardware privado. Use uma identidade estável compatível com as regras da Apple e trate restauração/reset/troca de conta como possível mudança de dispositivo.",
      "Use URLSession/async-await para chamadas HTTPS e aplique no cliente as datas startedAt/expiresAt/activatedAt retornadas pelo servidor.",
      "Atualização pela App Store não deve gerar novo Device ID nem reiniciar trial/licença."
    ],
    flutter: [
      "Centralize o licenciamento em um service/repository Dart separado da camada de apresentação.",
      "Use armazenamento seguro nativo por plataforma (Keychain no iOS e Keystore no Android) por meio de um mecanismo apropriado; não trate SharedPreferences como armazenamento seguro.",
      "O Device ID deve permanecer estável entre atualizações e seguir as regras específicas de Android/iOS quando o app for compilado para cada plataforma.",
      "Use HTTP assíncrono com timeout e tratamento explícito dos estados offline, expired, suspended, revoked e device_limit.",
      "Não duplique regras do GSL-v1 em widgets/telas; a UI apenas apresenta o estado devolvido pela camada de licenciamento."
    ]
  };
  return notes[platform] || notes.universal;
}

function integrationPlatformLabel(platform) {
  return {
    universal: "Universal / qualquer tecnologia",
    dotnet: ".NET / Windows / desktop",
    web: "Site / JavaScript / TypeScript",
    android: "Android / Kotlin",
    ios: "iOS / Swift",
    flutter: "Flutter / Dart"
  }[platform] || "Universal";
}

function buildIntegrationConfig(project) {
  return {
    protocol: PROTOCOL_VERSION,
    apiBaseUrl: API_BASE,
    integrationCode: project.integrationCode,
    signing: {
      algorithm: project.signingAlgorithm || "ES256",
      keyId: project.signingKeyId || null,
      publicJwk: project.signingPublicJwk || null
    },
    web: {
      allowedOrigins: project.allowedOrigins || []
    },
    project: {
      name: project.name,
      projectId: project.id,
      prefix: project.prefix
    },
    trial: {
      enabled: Boolean(project.trialEnabled && Number(project.trialDays || 0) > 0),
      days: Number(project.trialDays || 0),
      validationHours: Number(project.trialValidationHours || project.validationHours || 24),
      offlineHours: Number(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24)
    },
    license: {
      validationHours: Number(project.validationHours || 24),
      offlineDays: Number(project.offlineDays || 0)
    },
    endpoints: {
      projectConfig: "/api/v1/project/config",
      trialStart: "/api/v1/trial/start",
      trialValidate: "/api/v1/trial/validate",
      activate: "/api/v1/license/activate",
      validate: "/api/v1/license/validate",
      deactivate: "/api/v1/license/deactivate"
    }
  };
}

function buildIntegrationContract(project, platform = "universal") {
  const config = buildIntegrationConfig(project);
  const notes = integrationPlatformNotes(platform);
  const sampleKey = `${project.prefix || "GSS"}-XXXXX-XXXXX-XXXXX-XXXXX`;
  const trialEnabled = Boolean(project.trialEnabled && Number(project.trialDays || 0) > 0);
  const trialDays = Number(project.trialDays || 0);
  const trialValidation = Number(project.trialValidationHours || project.validationHours || 24);
  const trialOffline = Number(project.trialOfflineHours ?? trialValidation);

  return [
    "GUIASYS LICENSING — CONTRATO OFICIAL DE INTEGRAÇÃO",
    "================================================================",
    `Protocolo: ${PROTOCOL_VERSION}`,
    `Projeto: ${project.name}`,
    `Tecnologia alvo: ${integrationPlatformLabel(platform)}`,
    `Código de integração: ${project.integrationCode}`,
    `Project ID interno: ${project.id}`,
    `Prefixo de key: ${project.prefix}`,
    `API Base: ${API_BASE}`,
    "",
    "REGRA DE AUTORIDADE",
    "----------------------------------------------------------------",
    "O projeto de destino deve se adaptar ao GuiaSys Licensing.",
    "Não crie outro sistema de licenças, outro formato de key, outro cálculo de validade ou regras próprias de trial.",
    "O Código de Integração identifica este produto no protocolo GSL-v1 e pode ficar embutido no aplicativo/site; ele não é um segredo.",
    "",
    "REGRA DE ATUALIZAÇÕES DO PRODUTO",
    "----------------------------------------------------------------",
    "Atualizar o programa NÃO reinicia trial, NÃO consome novo dispositivo e NÃO invalida licença.",
    `Exemplo: uma licença válida no ${project.name} 2.1.0 continua válida no 2.2.0, 2.3.0 etc., enquanto usar o mesmo Código de Integração, a mesma key e o mesmo Device ID.`,
    "appVersion é apenas metadado enviado ao servidor para auditoria/diagnóstico.",
    "",
    "CONFIGURAÇÃO DINÂMICA",
    "----------------------------------------------------------------",
    "Não grave duração de trial, catálogo de planos ou regras comerciais de forma fixa no código.",
    "Na inicialização, quando necessário, consulte POST /api/v1/project/config usando o Código de Integração.",
    "Alterações administrativas futuras podem mudar regras para novos usuários sem exigir nova versão do produto.",
    "",
    "Request de configuração:",
    JSON.stringify({ integrationCode: project.integrationCode }, null, 2),
    "",
    "A resposta de /project/config também devolve signing.algorithm, signing.keyId e signing.publicJwk.",
    "A chave pública deve ser tratada como material confiável da integração e usada para verificar autorizações offline assinadas.",
    "",
    "PLANOS",
    "----------------------------------------------------------------",
    "Planos são 100% dinâmicos no servidor.",
    "Podem existir planos de 7, 15, 25, 30, 60, 120 dias, vitalícios ou qualquer duração futura.",
    "O projeto integrado não deve conhecer uma lista fixa de planos.",
    "Para licença já emitida, o servidor devolve planName, durationDays, lifetime, activatedAt e expiresAt.",
    "Editar um plano depois não altera retroativamente licenças já emitidas.",
    "",
    "TRIAL / AVALIAÇÃO GRATUITA",
    "----------------------------------------------------------------",
    `Trial deste projeto: ${trialEnabled ? "ATIVO" : "DESATIVADO"}`,
    `Duração atual para NOVOS trials: ${trialEnabled ? trialDays + " dia(s)" : "não aplicável"}`,
    `Validação online do trial: ${trialValidation} hora(s)`,
    `Tolerância offline do trial: ${trialOffline} hora(s)`,
    "",
    "A primeira ativação do trial SEMPRE exige internet.",
    "O servidor registra startedAt e expiresAt. A expiração continua valendo mesmo se o dispositivo ficar offline.",
    "Se a duração for alterada no painel, a nova duração vale para trials iniciados depois da alteração; trials já iniciados mantêm o expiresAt original.",
    "Atualização ou reinstalação não inicia um novo trial para o mesmo Device ID.",
    "Se o usuário comprar/ativar licença paga durante o trial, a licença paga passa a comandar o acesso; dias restantes do trial não são somados.",
    "Quando isso acontece, o servidor marca o trial como converted e ele não pode ser iniciado novamente para obter dias extras.",
    "",
    "Fluxo recomendado na primeira execução sem licença:",
    "1. Obter Device ID estável.",
    "2. Consultar /api/v1/project/config.",
    "3. Se trial.enabled=true, chamar /api/v1/trial/start.",
    "4. Se o servidor autorizar, salvar startedAt/expiresAt e liberar a avaliação.",
    "5. Se trial não estiver disponível ou estiver expirado, mostrar a tela para ativar License Key/comprar licença.",
    "",
    "Request para iniciar trial:",
    JSON.stringify({
      integrationCode: project.integrationCode,
      deviceId: "<DEVICE_ID_ESTAVEL>",
      deviceName: "<NOME_DO_DISPOSITIVO>",
      platform: "<PLATAFORMA>",
      appVersion: "<VERSAO>"
    }, null, 2),
    "",
    "Endpoint: POST /api/v1/trial/start",
    "",
    "Validação periódica do trial:",
    JSON.stringify({
      integrationCode: project.integrationCode,
      deviceId: "<MESMO_DEVICE_ID>",
      appVersion: "<VERSAO>"
    }, null, 2),
    "",
    "Endpoint: POST /api/v1/trial/validate",
    "Nunca permita funcionamento além de expiresAt. Se a tolerância offline terminar antes, exija conexão.",
    "",
    "LICENÇA PAGA",
    "----------------------------------------------------------------",
    "A key não é decodificada localmente; ela é validada pelo servidor.",
    "A validade pode começar na emissão ou na primeira ativação conforme startMode.",
    "Quando startMode=first_activation, uma key criada em 27/09 e ativada em 29/09 começa a contar em 29/09.",
    "O programa deve confiar em activatedAt/expiresAt retornados pelo servidor, nunca calcular a validade pela data de criação.",
    "",
    "Ativação:",
    JSON.stringify({
      integrationCode: project.integrationCode,
      licenseKey: sampleKey,
      deviceId: "<DEVICE_ID_ESTAVEL>",
      deviceName: "<NOME_DO_DISPOSITIVO>",
      platform: "<PLATAFORMA>",
      appVersion: "<VERSAO>"
    }, null, 2),
    "",
    "Endpoint: POST /api/v1/license/activate",
    "",
    "Validação:",
    JSON.stringify({
      integrationCode: project.integrationCode,
      licenseKey: sampleKey,
      deviceId: "<MESMO_DEVICE_ID>",
      appVersion: "<VERSAO>"
    }, null, 2),
    "",
    "Endpoint: POST /api/v1/license/validate",
    "",
    "Desativação deste dispositivo:",
    JSON.stringify({
      integrationCode: project.integrationCode,
      licenseKey: sampleKey,
      deviceId: "<MESMO_DEVICE_ID>"
    }, null, 2),
    "",
    "Endpoint: POST /api/v1/license/deactivate",
    "",
    "ABA CONTA / LICENÇA — COMPORTAMENTO OBRIGATÓRIO",
    "----------------------------------------------------------------",
    "Todo programa, aplicativo ou site integrado deve possuir uma área equivalente a 'Conta' ou 'Licença'.",
    "O design é livre no projeto de destino, mas a lógica é definida por este contrato.",
    "",
    "Quando houver licença paga ativa, mostrar:",
    "- Nome do cliente (customerName)",
    "- E-mail do cliente (customerEmail)",
    "- License Key armazenada pelo próprio produto/aplicativo com a proteção adequada à plataforma",
    "- Plano (planName)",
    "- Status",
    "- Data de início real (activatedAt)",
    "- Validade final (expiresAt) ou 'Vitalícia'",
    "- Limite de dispositivos (maxDevices), quando útil",
    "- Última validação online",
    "- Botão 'Desativar neste dispositivo'",
    "- Ação/link 'Gerenciar conta' ou 'Renovar' quando o produto disponibilizar portal do cliente.",
    "",
    "Quando estiver em trial, mostrar:",
    "- 'Versão de avaliação'",
    "- startedAt",
    "- expiresAt",
    "- dias/tempo restante calculado sem ultrapassar expiresAt",
    "- ação 'Comprar licença'",
    "- ação 'Já tenho uma key / Ativar licença'",
    "",
    "Quando trial/licença expirar, bloquear os recursos licenciados e oferecer compra/ativação.",
    "",
    "CÓDIGOS DE ERRO OFICIAIS",
    "----------------------------------------------------------------",
    "invalid_request          -> requisição inválida/incompleta",
    "project_not_found        -> integração/projeto não encontrado",
    "project_inactive         -> produto desativado no Licensing",
    "trial_unavailable        -> este produto não oferece trial",
    "trial_not_started        -> trial ainda não foi iniciado neste dispositivo",
    "trial_expired            -> trial deste dispositivo acabou",
    "trial_converted          -> trial foi convertido em licença paga",
    "license_invalid          -> key inválida",
    "pending                  -> licença ainda não ativada",
    "expired                  -> licença expirada",
    "suspended                -> licença suspensa",
    "revoked                  -> licença revogada",
    "device_limit             -> limite de dispositivos atingido",
    "device_not_authorized    -> dispositivo não autorizado",
    "origin_not_allowed       -> domínio web não autorizado no projeto",
    "rate_limited             -> limite temporário de requisições atingido",
    "network_error            -> erro local quando não houver resposta do servidor",
    "",
    "Tome decisões pelo campo 'error'; não analise o texto de 'message'.",
    "",
    "INTERNET E MODO OFFLINE",
    "----------------------------------------------------------------",
    "Primeiro início do trial exige conexão.",
    "Primeira ativação de uma key exige conexão.",
    `Licença paga: validar aproximadamente a cada ${project.validationHours || 24} hora(s); tolerância offline configurada de ${project.offlineDays || 0} dia(s).`,
    `Trial: validar aproximadamente a cada ${trialValidation} hora(s); tolerância offline de ${trialOffline} hora(s).`,
    "Respostas válidas de trial/activate/validate incluem offlineUntil e entitlement.",
    "entitlement.token é um JWS assinado com ES256 pelo GuiaSys Licensing.",
    "Antes de usar um cache offline, verifique criptograficamente a assinatura com signing.publicJwk deste projeto.",
    "Depois da assinatura válida, confira no payload: protocolVersion, projectId, integrationCode, deviceHash, status, expiresAt e offlineUntil.",
    "Calcule SHA-256 do Device ID local e compare com deviceHash do entitlement para impedir reutilização em outro dispositivo.",
    "Nunca confie em claims do token antes de validar a assinatura.",
    "Nunca libere o produto depois de offlineUntil ou expiresAt.",
    "O relógio local não pode conceder tempo além de expiresAt. Se houver retrocesso suspeito de relógio, exija uma validação online.",
    "Uma resposta online de expired/suspended/revoked/trial_expired/trial_converted sempre prevalece sobre cache anterior.",
    "",
    "ASSINATURA OFFLINE DESTE PROJETO",
    "----------------------------------------------------------------",
    `Algoritmo: ${project.signingAlgorithm || "ES256"}`,
    `Key ID: ${project.signingKeyId || "será obtido em /project/config"}`,
    "Public JWK:",
    JSON.stringify(project.signingPublicJwk || { note: "obter signing.publicJwk em /api/v1/project/config" }, null, 2),
    "",
    "INTEGRAÇÃO WEB / CORS",
    "----------------------------------------------------------------",
    `Origens web autorizadas atualmente: ${(project.allowedOrigins || []).length ? (project.allowedOrigins || []).join(", ") : "nenhuma origem externa cadastrada"}`,
    "Aplicativos desktop e mobile normalmente não enviam cabeçalho Origin e não dependem desta lista.",
    "Sites em navegador devem ter sua origem HTTPS cadastrada nas Configurações do projeto.",
    "",
    "IDENTIDADE DO DISPOSITIVO",
    "----------------------------------------------------------------",
    "Use um Device ID estável. A atualização do aplicativo não pode gerar um Device ID novo.",
    "O mesmo Device ID deve ser usado em trial/start, trial/validate, license/activate, license/validate e license/deactivate.",
    "",
    "SEGURANÇA",
    "----------------------------------------------------------------",
    "Nunca inclua FIREBASE_SERVICE_ACCOUNT_JSON, ADMIN_FIREBASE_UID, credenciais administrativas ou segredos do Worker.",
    `Pode ficar no cliente: API Base, Código de Integração ${project.integrationCode}, protocolo ${PROTOCOL_VERSION}, Project ID público e a chave PÚBLICA ES256.`,
    "A chave PRIVADA de assinatura nunca é enviada ao cliente e não aparece no contrato.",
    "",
    "ORIENTAÇÕES ESPECÍFICAS DA TECNOLOGIA",
    "----------------------------------------------------------------",
    ...notes.map(note => `- ${note}`),
    "",
    "CRITÉRIOS DE ACEITAÇÃO",
    "----------------------------------------------------------------",
    "[ ] Atualizar a versão do produto mantém a licença/trial.",
    "[ ] Primeiro trial exige internet.",
    "[ ] Reinstalar não reinicia trial para o mesmo Device ID.",
    "[ ] Alterar a duração do trial afeta novos trials, não os já iniciados.",
    "[ ] Trial bloqueia ao chegar em expiresAt mesmo offline.",
    "[ ] Trial convertido em licença não reinicia.",
    "[ ] Cache offline só é aceito após validar assinatura ES256 e deviceHash.",
    "[ ] offlineUntil e expiresAt são respeitados.",
    "[ ] Key válida ativa a licença.",
    "[ ] Key inválida é recusada.",
    "[ ] Limite de dispositivos é respeitado.",
    "[ ] Desativação libera vaga.",
    "[ ] Suspensão, revogação e expiração bloqueiam na próxima validação.",
    "[ ] Plano/duração não ficam hardcoded no produto.",
    "[ ] Aba Conta/Licença mostra os dados reais retornados pelo servidor.",
    "[ ] Origem Web não cadastrada é recusada quando houver Origin.",
    "[ ] Erro rate_limited é tratado sem loop agressivo de retry.",
    "[ ] Nenhum segredo administrativo ou chave privada está presente no cliente.",
    "",
    "REGRA DE COMPATIBILIDADE",
    "----------------------------------------------------------------",
    `Implemente ${PROTOCOL_VERSION} exatamente como descrito.`,
    "Mudanças incompatíveis nas regras devem nascer primeiro no GuiaSys Licensing e só depois ser adotadas pelos projetos.",
    "",
    "CONFIGURAÇÃO JSON",
    "----------------------------------------------------------------",
    JSON.stringify(config, null, 2)
  ].join("\n");
}

async function integrationView() {
  const project = await loadProjectDetail();
  let platform = "universal";

  const drawContract = () => {
    const text = buildIntegrationContract(project, platform);
    const pre = document.querySelector("#integration-contract");
    if (pre) pre.textContent = text;
    return text;
  };

  const trialLabel = project.trialEnabled && Number(project.trialDays || 0) > 0
    ? `${project.trialDays} dia(s)`
    : "Desativado";

  el.content.innerHTML = `
    ${pageHeader(
      "Integração",
      "Material oficial para integrar " + project.name + " ao GuiaSys Licensing.",
      '<span class="status-pill"><span class="status-dot"></span> ' + PROTOCOL_VERSION + '</span>'
    )}

    <section class="grid grid-4 integration-summary">
      ${metric("Protocolo", PROTOCOL_VERSION, "Contrato oficial")}
      ${metric("Código de integração", project.integrationCode || "Gerando...", "Identificador permanente")}
      ${metric("Trial", trialLabel, "Regra controlada pelo servidor")}
      ${metric("Assinatura offline", project.signingAlgorithm || "ES256", project.signingKeyId ? "Chave pública pronta" : "Carregando chave")}
    </section>

    <article class="card card-section integration-code-card">
      <div>
        <span class="eyebrow">CÓDIGO DE INTEGRAÇÃO</span>
        <h3>${e(project.integrationCode || "—")}</h3>
        <p>Este código identifica ${e(project.name)} no GSL-v1. Ele pode ficar no programa, aplicativo ou site e não é uma credencial secreta.</p>
      </div>
      <button class="btn btn-primary" id="copy-integration-code" type="button">Copiar código</button>
    </article>

    <article class="card card-section integration-controls">
      <div>
        <span class="eyebrow">GERADOR DE INTEGRAÇÃO</span>
        <h3>Instruções prontas para o projeto</h3>
        <p>Escolha a tecnologia e copie o contrato completo. O projeto de destino deve implementar exatamente estas regras.</p>
      </div>
      <div class="integration-actions">
        <label class="field integration-platform">
          <span>Tecnologia alvo</span>
          <select id="integration-platform">
            <option value="universal">Universal / qualquer tecnologia</option>
            <option value="dotnet">.NET / Windows / desktop</option>
            <option value="web">Site / JavaScript / TypeScript</option>
            <option value="android">Android / Kotlin</option>
            <option value="ios">iOS / Swift</option>
            <option value="flutter">Flutter / Dart</option>
          </select>
        </label>
        <button class="btn btn-primary" id="copy-integration" type="button">Copiar integração completa</button>
        <button class="btn btn-ghost" id="copy-integration-json" type="button">Copiar JSON</button>
      </div>
    </article>

    <section class="integration-identity card card-section">
      <div><span>Projeto</span><strong>${e(project.name)}</strong></div>
      <div><span>Project ID</span><code>${e(project.id)}</code></div>
      <div><span>API</span><code>${e(API_BASE)}</code></div>
      <div><span>Planos</span><strong>Dinâmicos — definidos pelo servidor</strong></div>
    </section>

    <article class="card integration-document-card">
      <div class="table-toolbar">
        <div>
          <span class="eyebrow">DOCUMENTO GERADO</span>
          <h3>Contrato para copiar no chat/projeto de destino</h3>
        </div>
        <span class="badge">Personalizado para este projeto</span>
      </div>
      <pre id="integration-contract" class="integration-contract"></pre>
    </article>
  `;

  drawContract();

  document.querySelector("#integration-platform").addEventListener("change", event => {
    platform = event.target.value;
    drawContract();
  });

  document.querySelector("#copy-integration-code").addEventListener("click", async () => {
    await navigator.clipboard.writeText(project.integrationCode || "");
    toast("Código de integração copiado.");
  });

  document.querySelector("#copy-integration").addEventListener("click", async () => {
    await navigator.clipboard.writeText(drawContract());
    toast("Integração completa copiada.");
  });

  document.querySelector("#copy-integration-json").addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(buildIntegrationConfig(project), null, 2));
    toast("Configuração JSON copiada.");
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
  const project = await loadProjectDetail();
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
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const data = await api(`/api/v1/admin/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify(projectPayload(values, form))
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

async function loadAdmins() {
  const data = await api("/api/v1/admin/admins");
  return data.admins || [];
}

async function loadPlatformLogs() {
  const data = await api("/api/v1/admin/platform-logs");
  return data.logs || [];
}

function adminForm(admin = {}) {
  const allProjects = Boolean(admin.allProjects);
  const permissions = admin.permissions || {};

  return `
    <div class="form-grid form-grid-2">
      <label class="field">
        ${fieldTitle("Nome", "Nome usado para identificar este administrador no painel.")}
        <input name="name" maxlength="120" value="${e(admin.name || "")}" placeholder="Nome do administrador">
      </label>
      <label class="field">
        ${fieldTitle("E-mail Firebase *", "A pessoa poderá entrar com Google ou e-mail/senha, mas deverá usar uma conta Firebase com exatamente este e-mail no primeiro acesso.")}
        <input name="email" type="email" required maxlength="160" value="${e(admin.email || "")}" ${admin.id ? "readonly" : ""} placeholder="usuario@gmail.com">
      </label>
      <label class="field">
        ${fieldTitle("Status", "Administradores inativos não conseguem entrar no painel.")}
        <select name="status">
          <option value="active" ${admin.status !== "inactive" ? "selected" : ""}>Ativo</option>
          <option value="inactive" ${admin.status === "inactive" ? "selected" : ""}>Inativo</option>
        </select>
      </label>
      <label class="field check-field">
        <input name="allProjects" id="admin-all-projects" type="checkbox" value="true" ${allProjects ? "checked" : ""}>
        ${fieldTitle("Todos os projetos, inclusive futuros", "Quando ativado, o administrador enxerga todos os projetos atuais e qualquer projeto criado futuramente.")}
      </label>

      <div class="field field-full">
        ${fieldTitle("Projetos permitidos", "Use esta lista quando o administrador não tiver acesso a todos os projetos.")}
        <div class="permission-projects" id="admin-project-list">
          ${state.projects.filter(p => p.status !== "archived").map(project => `
            <label class="permission-check">
              <input type="checkbox" name="projectIds" value="${e(project.id)}" ${admin.projectIds?.includes(project.id) ? "checked" : ""}>
              <span><strong>${e(project.name)}</strong><small>${e(project.prefix)} · ${e(project.id)}</small></span>
            </label>
          `).join("") || '<div class="muted-box">Nenhum projeto cadastrado.</div>'}
        </div>
      </div>

      <div class="field field-full">
        <div class="permission-heading">
          ${fieldTitle("Permissões", "Defina exatamente quais módulos e ações este administrador poderá usar.")}
          <label class="permission-all"><input id="admin-perm-all" type="checkbox"> Marcar todas</label>
        </div>
        <div class="permissions-grid">
          ${Object.entries(ADMIN_PERMISSION_LABELS).map(([key, label]) => `
            <label class="permission-check">
              <input type="checkbox" name="perm_${e(key)}" value="true" ${permissions[key] ? "checked" : ""}>
              <span>${e(label)}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <div class="notice field-full">
        O usuário master continua com acesso total e não depende destas permissões. Administradores adicionais nunca substituem o master.
      </div>
    </div>
  `;
}

function openAdmin(admin = null, onSaved = null) {
  openModal({
    title: admin ? "Editar administrador" : "Novo administrador",
    subtitle: admin ? admin.email : "Controle o acesso ao GuiaSys Licensing por conta Firebase autorizada.",
    body: adminForm(admin || {}),
    submitLabel: admin ? "Salvar permissões" : "Cadastrar administrador",
    wide: true,
    onOpen: backdrop => {
      const form = backdrop.querySelector(".modal-form");
      const allProjects = form.elements.allProjects;
      const projectChecks = [...form.querySelectorAll('input[name="projectIds"]')];
      const permAll = form.querySelector("#admin-perm-all");
      const permChecks = [...form.querySelectorAll('input[name^="perm_"]')];

      const syncProjects = () => {
        projectChecks.forEach(input => {
          input.disabled = allProjects.checked;
          input.closest(".permission-check")?.classList.toggle("field-locked", allProjects.checked);
        });
      };

      const syncPermAll = () => {
        permAll.checked = permChecks.length > 0 && permChecks.every(input => input.checked);
      };

      allProjects.addEventListener("change", syncProjects);
      permAll.addEventListener("change", () => {
        permChecks.forEach(input => { input.checked = permAll.checked; });
      });
      permChecks.forEach(input => input.addEventListener("change", syncPermAll));

      syncProjects();
      syncPermAll();
    },
    onSubmit: async (values, form) => {
      const payload = {
        name: values.name || "",
        email: values.email,
        status: values.status,
        allProjects: form.elements.allProjects.checked,
        projectIds: [...form.querySelectorAll('input[name="projectIds"]:checked')].map(input => input.value),
        permissions: Object.fromEntries(
          Object.keys(ADMIN_PERMISSION_LABELS).map(key => [
            key,
            Boolean(form.querySelector(`input[name="perm_${key}"]`)?.checked)
          ])
        )
      };

      const path = admin
        ? `/api/v1/admin/admins/${encodeURIComponent(admin.id)}`
        : "/api/v1/admin/admins";

      await api(path, {
        method: admin ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });

      toast(admin ? "Administrador atualizado." : "Administrador cadastrado.");
      if (onSaved) await onSaved();
    }
  });
}

async function administratorsView() {
  if (!state.administrator?.master) {
    throw new Error("Somente o administrador master pode gerenciar administradores.");
  }

  const [admins, platformLogs] = await Promise.all([
    loadAdmins(),
    loadPlatformLogs()
  ]);

  el.content.innerHTML = `
    ${pageHeader(
      "Administradores",
      "Cadastre pessoas que podem ajudar nas vendas e operações, com acesso limitado por projeto e função.",
      '<button class="btn btn-primary" id="new-admin" type="button">+ Novo administrador</button>'
    )}

    <article class="card master-admin-card">
      <div class="admin-avatar master-avatar">${initials(state.user.displayName || "Master")}</div>
      <div class="admin-main">
        <div class="admin-title-row"><strong>${e(state.user.displayName || "Administrador Master")}</strong><span class="badge badge-success">MASTER</span></div>
        <span>${e(state.user.email || "")}</span>
        <small>Acesso total a todos os projetos, configurações e administradores.</small>
      </div>
    </article>

    <article class="card table-shell" style="margin-top:18px">
      <div class="table-toolbar">
        <h3>Administradores adicionais</h3>
        <span class="badge">${admins.length} cadastrado(s)</span>
      </div>
      ${table(
        ["Administrador", "Projetos", "Permissões", "Identidade", "Status", "Atualização", ""],
        admins.map(admin => {
          const projectText = admin.allProjects
            ? "Todos + futuros"
            : (admin.projectIds?.length ? `${admin.projectIds.length} projeto(s)` : "Nenhum");
          const permissionCount = Object.values(admin.permissions || {}).filter(Boolean).length;
          return `
            <tr>
              <td><strong>${e(admin.name || admin.email)}</strong><small>${e(admin.email)}</small></td>
              <td>${e(projectText)}</td>
              <td>${e(permissionCount)} de ${Object.keys(ADMIN_PERMISSION_LABELS).length}</td>
              <td>${admin.identityBound
                ? '<span class="badge badge-success">UID vinculado</span>'
                : '<span class="badge badge-warning">Aguardando 1º login</span>'}</td>
              <td>${admin.status === "active" ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-muted">Inativo</span>'}</td>
              <td>${formatDate(admin.updatedAt, true)}</td>
              <td class="table-actions">
                <button class="btn btn-ghost btn-sm edit-admin" data-id="${e(admin.id)}" type="button">Editar</button>
                <button class="btn btn-ghost btn-sm delete-admin" data-id="${e(admin.id)}" type="button">Excluir</button>
              </td>
            </tr>
          `;
        }),
        "Nenhum administrador adicional cadastrado."
      )}
    </article>

    <article class="card table-shell" style="margin-top:18px">
      <div class="table-toolbar">
        <h3>Auditoria administrativa</h3>
        <span class="badge">${platformLogs.length} evento(s) recente(s)</span>
      </div>
      ${table(
        ["Evento", "Origem", "Data", "Detalhes"],
        platformLogs.map(log => `
          <tr>
            <td><strong>${e(logText(log))}</strong><small><code>${e(log.action)}</code></small></td>
            <td>${e(log.actor || "—")}</td>
            <td>${formatDate(log.createdAt, true)}</td>
            <td><code class="details-code">${e(JSON.stringify(log.details || {}))}</code></td>
          </tr>
        `),
        "Nenhuma alteração administrativa registrada."
      )}
    </article>
  `;

  const refresh = async () => await renderContent();

  document.querySelector("#new-admin").onclick = () => openAdmin(null, refresh);
  document.querySelectorAll(".edit-admin").forEach(button => {
    button.onclick = () => openAdmin(admins.find(item => item.id === button.dataset.id), refresh);
  });
  document.querySelectorAll(".delete-admin").forEach(button => {
    button.onclick = async () => {
      const admin = admins.find(item => item.id === button.dataset.id);
      if (!await confirmAction("Excluir administrador", `Remover o acesso de ${admin.email}?`, "Excluir")) return;
      await api(`/api/v1/admin/admins/${encodeURIComponent(admin.id)}`, { method: "DELETE" });
      toast("Administrador removido.");
      await renderContent();
    };
  });
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
    if (!routeAllowed(state.route)) {
      state.route = state.selectedProjectId ? defaultProjectRoute() : "projects";
      renderNavigation();
    }

    if (!state.selectedProjectId && projectItems.some(([route]) => route === state.route)) {
      state.route = hasPermission("viewDashboard") ? "dashboard" : "projects";
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
      administrators: administratorsView,
      "platform-settings": async () => platformSettingsView(),
      "project-dashboard": projectDashboardView,
      licenses: licensesView,
      "generate-license": generateLicenseView,
      plans: plansView,
      customers: customersView,
      devices: devicesView,
      activations: activationsView,
      "activation-simulator": activationSimulatorView,
      trial: trialView,
      integration: integrationView,
      logs: logsView,
      "project-settings": projectSettingsView
    };

    await (routes[state.route] || projectsView)();
    bindInputEnhancements(el.content);
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
    state.administrator = await verifyAdministrator(user, true);
    lastAuthorizationSyncAt = Date.now();
  } catch (error) {
    pendingLoginMessage = [401, 403].includes(Number(error?.status))
      ? "Esta conta não está autorizada para acessar o painel administrativo."
      : "Não foi possível validar sua sessão administrativa. Verifique a API e tente novamente.";
    await signOut(auth);
    return;
  }

  renderUser();

  try {
    await loadProjects();

    if (!routeAllowed(state.route)) {
      state.route = hasPermission("viewDashboard") ? "dashboard" : "projects";
    }

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

function setLoginBusy(busy) {
  el.loginButton.disabled = busy;
  el.emailLoginButton.disabled = busy;
  el.emailLoginInput.disabled = busy;
  el.passwordLoginInput.disabled = busy;
}

el.loginButton.addEventListener("click", async () => {
  setLoginMessage("");
  setLoginBusy(true);
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    setLoginMessage("Não foi possível entrar com o Google. Tente novamente.");
  } finally {
    setLoginBusy(false);
  }
});

el.emailLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  setLoginMessage("");
  setLoginBusy(true);

  try {
    await signInWithEmailAndPassword(
      auth,
      el.emailLoginInput.value.trim(),
      el.passwordLoginInput.value
    );
    el.passwordLoginInput.value = "";
  } catch (error) {
    console.error(error);
    setLoginMessage("Não foi possível entrar com e-mail e senha. Confira os dados e tente novamente.");
  } finally {
    setLoginBusy(false);
  }
});

el.logoutButton.addEventListener("click", async () => {
  resetAdministrativeState();
  await signOut(auth);
});

el.projectSwitcher.addEventListener("change", async () => {
  state.selectedProjectId = el.projectSwitcher.value;
  state.route = state.selectedProjectId
    ? defaultProjectRoute()
    : (hasPermission("viewDashboard") ? "dashboard" : "projects");
  renderNavigation();
  await renderContent();
});

el.mobileMenuButton.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

window.addEventListener("focus", () => {
  syncAuthorization(false);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncAuthorization(false);
});

window.setInterval(() => {
  syncAuthorization(false);
}, 60_000);

onAuthStateChanged(auth, async user => {
  if (user) {
    await enterApp(user);
    return;
  }

  state.user = null;
  resetAdministrativeState();
  showScreen("login");
  setLoginMessage(pendingLoginMessage);
  pendingLoginMessage = "";
  await checkApi();
});

showScreen("boot");
