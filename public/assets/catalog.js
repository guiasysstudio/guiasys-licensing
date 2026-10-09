import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider,
  onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, setPersistence,
  signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = { apiKey: "AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00", authDomain: "guiasys-licensing.firebaseapp.com", projectId: "guiasys-licensing", storageBucket: "guiasys-licensing.firebasestorage.app", messagingSenderId: "854287499951", appId: "1:854287499951:web:0369b194e7663a9d9c0a5a" };
const auth = getAuth(initializeApp(firebaseConfig, "customer-storefront"));
await setPersistence(auth, browserLocalPersistence);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const $ = selector => document.querySelector(selector);
const app = $("#app");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });
const CART_KEY = "gsl.cart.v1";
const CHECKOUT_KEY = "gsl.checkout.v1";
const state = { user: null, account: null, catalog: [], cart: readLocalCart(), favorites: [], syncedUid: "", authReady: false };
let toastTimer;
let pixModalCleanup = null;

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function anchor(text, href, className = "") {
  const node = el("a", className, text);
  node.href = href;
  if (href.startsWith("/")) node.dataset.link = "";
  return node;
}
function button(text, className = "button", action) {
  const node = el("button", className, text);
  node.type = "button";
  if (action) node.addEventListener("click", action);
  return node;
}
function titleBlock(kicker, title, description = "") {
  const wrap = el("div");
  wrap.append(el("p", "eyebrow", kicker), el("h2", "", title));
  if (description) wrap.append(el("p", "lead", description));
  return wrap;
}
function safeHttpsUrl(value) {
  const raw = String(value || "").trim();
  if (/^\/assets\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(raw) && !raw.includes("..")) return raw;
  try {
    const url = new URL(raw, location.origin);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.origin === location.origin && url.pathname.startsWith("/assets/") && !url.pathname.includes("..")) return url.href;
    if (url.hostname !== "firebasestorage.googleapis.com") return "";
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || !["guiasys-licensing.firebasestorage.app", "guiasys-licensing.appspot.com"].includes(decodeURIComponent(match[1]))) return "";
    const objectPath = decodeURIComponent(match[2]);
    if (!/^(?:commerce\/projects\/prj_[a-f0-9]{20}\/(?:logo|icon|banner|screenshot)|profiles\/[A-Za-z0-9_-]+)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(objectPath)) return "";
    return url.searchParams.get("alt") === "media" && url.searchParams.get("token") ? url.href : "";
  } catch { return ""; }
}
function profileInitial(account = state.account, user = state.user) {
  const source = String(account?.displayName || account?.email || user?.displayName || user?.email || "A").trim();
  const first = Array.from(source)[0] || "A";
  return Array.from(first.toLocaleUpperCase("pt-BR"))[0] || "A";
}
function safeNextPath(value, fallback = "/conta/compras") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
function onlyDigits(value, max = 32) { return String(value || "").replace(/\D/g, "").slice(0, max); }
function formatCpf(value) {
  const digits = onlyDigits(value, 11);
  return digits.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function formatPhone(value) {
  const digits = onlyDigits(value, 11);
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}
function formatCep(value) {
  const digits = onlyDigits(value, 8);
  return digits.replace(/^(\d{5})(\d)/, "$1-$2");
}
function isValidCpfClient(value) {
  const cpf = onlyDigits(value, 11);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const check = length => {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
}
function bindMask(input, formatter, maxLength) {
  input.inputMode = "numeric";
  input.maxLength = maxLength;
  input.addEventListener("input", () => {
    const caretAtEnd = input.selectionStart === input.value.length;
    input.value = formatter(input.value);
    if (caretAtEnd) input.setSelectionRange(input.value.length, input.value.length);
  });
}
function image(url, alt, className = "") {
  const source = safeHttpsUrl(url);
  if (!source) return null;
  const node = el("img", className);
  node.src = source;
  node.alt = alt;
  node.loading = "lazy";
  node.referrerPolicy = "no-referrer";
  return node;
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}
function errorMessage(error, fallback = "Não foi possível concluir a operação.") {
  return error?.message || fallback;
}
function readLocalCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item?.projectId && item?.planId && Number(item.quantity) > 0) : [];
  } catch { return []; }
}
function saveLocalCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  updateHeader();
}
function cartKey(item) { return `${item.projectId}|${item.planId}`; }
function cartFingerprint(items = state.cart) {
  return JSON.stringify(
    items.map(item => ({ projectId: item.projectId, planId: item.planId, quantity: Number(item.quantity || 0) }))
      .sort((a, b) => cartKey(a).localeCompare(cartKey(b)))
  );
}
function readCheckoutDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKOUT_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}
function writeCheckoutDraft(value) {
  if (value) localStorage.setItem(CHECKOUT_KEY, JSON.stringify(value));
  else localStorage.removeItem(CHECKOUT_KEY);
}
function checkoutDraftForCurrentCart() {
  const draft = readCheckoutDraft();
  return draft && state.user && draft.uid === state.user.uid && draft.fingerprint === cartFingerprint() ? draft : null;
}
function ensureCheckoutDraft() {
  const existing = checkoutDraftForCurrentCart();
  if (existing) return existing;
  const draft = { uid: state.user.uid, fingerprint: cartFingerprint(), idempotencyKey: crypto.randomUUID(), orderId: "", createdAt: new Date().toISOString() };
  writeCheckoutDraft(draft);
  return draft;
}
function invalidateCheckoutDraft() { writeCheckoutDraft(null); }
function mergeCarts(local, remote) {
  const merged = new Map();
  for (const item of [...remote, ...local]) {
    const key = cartKey(item);
    const current = merged.get(key);
    merged.set(key, { projectId: item.projectId, planId: item.planId, quantity: Math.min(50, Math.max(Number(current?.quantity || 0), Number(item.quantity || 1))) });
  }
  return [...merged.values()].slice(0, 10);
}
async function api(path, options = {}) {
  const token = state.user ? await state.user.getIdToken() : "";
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Erro HTTP ${response.status}`);
    error.reason = payload.error;
    error.status = response.status;
    throw error;
  }
  return payload;
}
async function syncCart() {
  saveLocalCart();
  if (!state.user) return;
  try {
    await api("/api/v1/customer/cart", { method: "PUT", body: JSON.stringify({ items: state.cart }) });
  } catch (error) { console.error("Falha ao sincronizar carrinho.", error); }
}
function addToCart(projectId, planId, quantity = 1, label = "Oferta") {
  const existing = state.cart.find(item => item.projectId === projectId && item.planId === planId);
  if (existing) existing.quantity = Math.min(50, existing.quantity + quantity);
  else if (state.cart.length < 10) state.cart.push({ projectId, planId, quantity: Math.min(50, Math.max(1, quantity)) });
  else { showToast("O carrinho aceita no máximo 10 itens."); return false; }
  invalidateCheckoutDraft();
  void syncCart();
  showToast(`${label} adicionado ao carrinho.`);
  return true;
}
function buyNow(projectId, planId, label) {
  const exists = state.cart.some(item => item.projectId === projectId && item.planId === planId);
  if (!exists && !addToCart(projectId, planId, 1, label)) return;
  navigate("/carrinho");
}
function updateHeader() {
  const count = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  $("#cart-count").textContent = String(count);
  $("#cart-count").hidden = count === 0;
  $("#account-label").textContent = state.user ? "Minha conta" : "Entrar";
  const avatar = $("#account-avatar");
  const avatarUrl = safeHttpsUrl(state.account?.photoUrl);
  avatar.hidden = !avatarUrl;
  avatar.src = avatarUrl || "";
  avatar.alt = avatarUrl ? "Foto do perfil" : "";
  const avatarFallback = $("#account-avatar-fallback");
  avatarFallback.textContent = profileInitial();
  avatarFallback.hidden = Boolean(avatarUrl);
  avatar.onerror = () => {
    avatar.hidden = true;
    avatar.removeAttribute("src");
    avatarFallback.hidden = false;
  };
  $("#account-dropdown").hidden = !state.user || $("#account-menu-button").getAttribute("aria-expanded") !== "true";
  document.querySelectorAll(".site-nav a[data-link]").forEach(node => {
    const current = node.pathname === location.pathname || (node.pathname === "/programas" && location.pathname.startsWith("/programas/"));
    current ? node.setAttribute("aria-current", "page") : node.removeAttribute("aria-current");
  });
}
function setDocument(title, description = "Programas e licenças oficiais da GuiaSys Studio.") {
  const fullTitle = `${title} — GuiaSys Licensing`;
  document.title = fullTitle;
  document.querySelector('meta[name="description"]').content = description;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogTitle) ogTitle.content = fullTitle;
  if (ogDescription) ogDescription.content = description;
  updateHeader();
}
function navigate(href, replace = false) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) return location.assign(url.href);
  history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
  document.querySelector(".site-nav").classList.remove("open");
  $("#account-dropdown").hidden = true;
  $("#account-menu-button").setAttribute("aria-expanded", "false");
  void renderRoute();
}
function loading() {
  app.replaceChildren();
  const node = el("section", "loading-state");
  node.append(el("span", "spinner"), el("p", "", "Carregando…"));
  app.append(node);
}
function emptyState(title, text) {
  const node = el("div", "empty-state");
  node.append(el("h2", "", title), el("p", "", text));
  return node;
}
function formatDuration(plan) {
  if (plan.lifetime) return "Licença vitalícia";
  const days = Number(plan.durationDays || 0);
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}
function planCents(plan) { return Math.round(Number(plan.price || 0) * 100); }
function findOffer(item) {
  const project = state.catalog.find(candidate => candidate.projectId === item.projectId);
  const plan = project?.plans?.find(candidate => candidate.id === item.planId);
  return project && plan ? { project, plan, item } : null;
}
function productCard(project, { favoriteControls = false, favoriteAction = false } = {}) {
  const card = el("article", "product-card");
  const media = el("div", "product-media");
  const visual = image(project.logoUrl || project.iconUrl || project.imageUrl, `Logo de ${project.name}`, "product-icon");
  media.append(visual || el("span", "monogram", String(project.name || "GS").slice(0, 2).toUpperCase()));
  if (project.featured) media.append(el("span", "featured-tag", "Destaque"));
  const body = el("div", "product-body");
  body.append(el("h3", "", project.name), el("p", "", project.tagline || project.shortDescription || "Programa oficial GuiaSys."));
  const actions = el("div", "card-actions");
  actions.append(anchor("Ver programa", `/programas/${encodeURIComponent(project.slug)}`, "button-secondary"));
  if (favoriteAction) {
    const alreadyFavorite = state.favorites.includes(project.projectId);
    const favoriteButton = button(alreadyFavorite ? "♥ Favoritado" : "♡ Favoritar", "button-ghost", async event => {
      if (!state.user) return navigate(`/entrar?next=${encodeURIComponent(location.pathname)}`);
      await api(`/api/v1/customer/favorites/${encodeURIComponent(project.projectId)}`, { method: "POST" });
      if (!state.favorites.includes(project.projectId)) state.favorites.push(project.projectId);
      event.currentTarget.textContent = "♥ Favoritado";
      event.currentTarget.disabled = true;
    });
    favoriteButton.disabled = alreadyFavorite;
    actions.append(favoriteButton);
  }
  if (favoriteControls) actions.append(button("Remover favorito", "button-ghost", async () => {
    await api(`/api/v1/customer/favorites/${encodeURIComponent(project.projectId)}`, { method: "DELETE" });
    state.favorites = state.favorites.filter(id => id !== project.projectId);
    renderFavorites();
  }));
  body.append(actions);
  card.append(media, body);
  return card;
}
function planCard(project, plan) {
  const card = el("article", "plan-card");
  card.append(
    el("h3", "", plan.name),
    el("p", "plan-price", money.format(Number(plan.price || 0))),
    el("p", "", plan.commercialDescription || plan.description || "Licença oficial GuiaSys."),
    el("p", "plan-meta", `${formatDuration(plan)} · ${plan.deviceLimit} ${Number(plan.deviceLimit) === 1 ? "dispositivo" : "dispositivos"}`),
    el("p", "plan-meta", `${plan.startMode === "immediate" ? "Validade iniciada na emissão" : "Validade iniciada na primeira ativação"}${plan.termsVersion ? ` · Termos ${plan.termsVersion}` : ""}`)
  );
  const actions = el("div", "card-actions");
  actions.append(
    button("Adicionar ao carrinho", "button-secondary", () => addToCart(project.projectId, plan.id, 1, `${project.name} — ${plan.name}`)),
    button("Comprar agora", "button", () => buyNow(project.projectId, plan.id, `${project.name} — ${plan.name}`))
  );
  card.append(actions);
  return card;
}
async function loadCatalog(force = false) {
  if (state.catalog.length && !force) return state.catalog;
  const response = await fetch("/api/v1/catalog", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Não foi possível carregar o catálogo.");
  const payload = await response.json();
  state.catalog = payload?.catalog?.projects || [];
  return state.catalog;
}
async function renderHome() {
  setDocument("Início");
  await loadCatalog();
  app.replaceChildren();
  const hero = el("section", "hero section");
  const copy = el("div", "hero-copy");
  copy.append(
    el("p", "eyebrow", "Software GuiaSys · licenças oficiais"),
    el("h1", "", "Licenças oficiais GuiaSys."),
    el("p", "lead", "Conheça programas GuiaSys, compare planos e receba suas licenças em uma conta segura."),
    (() => { const actions = el("div", "hero-actions"); actions.append(anchor("Explorar programas", "/programas", "button"), anchor("Acessar minha conta", state.user ? "/conta/compras" : "/entrar", "button-secondary")); return actions; })()
  );
  const visual = el("div", "hero-visual");
  const logo = el("img", "hero-lockup");
  logo.src = "/assets/brand/guiasys-licensing-lockup.svg";
  logo.alt = "GuiaSys Licensing";
  const fallback = el("div", "asset-fallback");
  fallback.hidden = true;
  const fallbackText = el("div");
  fallbackText.append(el("strong", "", "GuiaSys Licensing"), el("p", "", "Não foi possível carregar a identidade visual."));
  fallback.append(fallbackText);
  logo.addEventListener("error", () => { logo.hidden = true; fallback.hidden = false; }, { once: true });
  visual.append(logo, fallback);
  hero.append(copy, visual);
  const featured = el("section", "section");
  const heading = el("div", "section-heading");
  heading.append(titleBlock("Destaques", "Programas em destaque"), el("p", "", "Programas publicados e mantidos pela equipe GuiaSys."));
  featured.append(heading);
  const featuredItems = state.catalog.filter(item => item.featured).sort((a, b) => a.featuredOrder - b.featuredOrder);
  const grid = el("div", "catalog-grid");
  for (const project of featuredItems.slice(0, 6)) grid.append(productCard(project));
  featured.append(grid.childElementCount ? grid : emptyState("Em breve", "Nenhum programa está publicado neste momento."));
  const institutional = el("section", "institutional");
  institutional.id = "sobre";
  const inside = el("div", "section");
  inside.append(titleBlock("GuiaSys Licensing", "A plataforma oficial das licenças GuiaSys", "Centraliza comercialização, emissão de keys, gerenciamento de licenças, ativação, validação e a conta de cada cliente."));
  const values = el("div", "institutional-grid");
  for (const [title, text] of [["Produtos objetivos", "Recursos que resolvem necessidades reais sem complicar a rotina."], ["Licenciamento seguro", "Cada compra gera chaves rastreáveis e vinculadas à sua conta."], ["Suporte humano", "Orientação direta antes, durante e depois da compra."]]) {
    const card = el("article", "value-card"); card.append(el("h3", "", title), el("p", "", text)); values.append(card);
  }
  inside.append(values); institutional.append(inside);
  app.append(hero, featured, institutional);
}
async function renderPrograms() {
  setDocument("Programas", "Conheça os programas e planos oficiais publicados pela GuiaSys.");
  await loadCatalog();
  app.replaceChildren();
  const page = el("section", "page");
  page.append(titleBlock("Catálogo oficial", "Programas", "Conheça os programas oficiais da GuiaSys."));
  const grid = el("div", "catalog-grid");
  for (const project of state.catalog) grid.append(productCard(project, { favoriteAction: true }));
  page.append(grid.childElementCount ? grid : emptyState("Nenhum programa publicado", "Novas ofertas aparecerão aqui quando estiverem disponíveis."));
  app.append(page);
}
async function renderProgram(slug) {
  loading();
  try {
    const payload = await api(`/api/v1/catalog/${encodeURIComponent(slug)}`);
    const project = payload.project;
    setDocument(project.seoTitle || project.name, project.seoDescription || project.shortDescription || project.description);
    app.replaceChildren();
    const page = el("article", "page");
    const crumbs = el("nav", "breadcrumb");
    crumbs.append(anchor("Programas", "/programas"), el("span", "", "›"), el("span", "", project.name));
    const hero = el("div", "detail-hero");
    const copy = el("div");
    const detailLogo = image(project.logoUrl || project.iconUrl, `Logo de ${project.name}`, "detail-logo");
    if (detailLogo) copy.append(detailLogo);
    copy.append(el("p", "eyebrow", "Programa GuiaSys"), el("h1", "", project.name));
    if (project.tagline) copy.append(el("p", "lead", project.tagline));
    if (project.shortDescription || project.description) copy.append(el("p", "", project.shortDescription || project.description));
    const alreadyFavorite = state.favorites.includes(project.projectId);
    const favorite = button(alreadyFavorite ? "♥ Favoritado" : "Adicionar aos favoritos", "button-ghost", async () => {
      if (!state.user) return navigate(`/entrar?next=${encodeURIComponent(location.pathname)}`);
      await api(`/api/v1/customer/favorites/${encodeURIComponent(project.projectId)}`, { method: "POST" });
      if (!state.favorites.includes(project.projectId)) state.favorites.push(project.projectId);
      favorite.textContent = "♥ Favoritado";
      favorite.disabled = true;
    });
    favorite.disabled = alreadyFavorite;
    copy.append(favorite);
    const visual = image(project.bannerUrl || project.logoUrl || project.imageUrl, `Imagem de ${project.name}`, "detail-banner") || (() => {
      const fallback = el("div", "asset-fallback detail-fallback");
      fallback.append(
        el("span", "monogram", String(project.name || "GS").slice(0, 2).toUpperCase()),
        el("strong", "", project.name)
      );
      return fallback;
    })();
    hero.append(copy, visual);
    page.append(crumbs, hero);
    if (project.fullDescription || project.commercialText) {
      const about = el("section", "section"); about.append(titleBlock("Visão geral", "Sobre o programa"));
      if (project.fullDescription) about.append(el("p", "lead", project.fullDescription));
      if (project.commercialText) about.append(el("p", "", project.commercialText));
      page.append(about);
    }
    if (project.features.length || project.requirements.length) {
      const lists = el("div", "detail-lists");
      for (const [title, items] of [["Principais recursos", project.features], ["Requisitos", project.requirements]]) {
        const panel = el("section", "panel"); panel.append(el("h2", "", title)); const list = el("ul");
        for (const item of items) list.append(el("li", "", item));
        panel.append(list); lists.append(panel);
      }
      page.append(lists);
    }
    if (project.additionalInfo) {
      const additional = el("section", "panel");
      additional.append(el("h2", "", "Informações adicionais"), el("p", "", project.additionalInfo));
      page.append(additional);
    }
    if (project.screenshots.length) {
      const gallery = el("section", "section"); gallery.append(titleBlock("Interface", "Veja o programa"));
      const shots = el("div", "screenshots");
      project.screenshots.forEach((url, index) => { const shot = image(url, `Tela ${index + 1} de ${project.name}`); if (shot) shots.append(shot); });
      gallery.append(shots); page.append(gallery);
    }
    const offers = el("section", "product-offers");
    offers.append(titleBlock("Licenciamento", "Escolha seu plano"));
    const plans = el("div", "plans");
    for (const plan of project.plans) plans.append(planCard(project, plan));
    offers.append(plans); page.append(offers);
    app.append(page);
  } catch (error) {
    setDocument("Programa não encontrado");
    app.replaceChildren(emptyState("Programa não encontrado", "Esta página não existe ou a oferta não está publicada."));
  }
}
function cartOffers() { return state.cart.map(findOffer).filter(Boolean); }
function closePixModal() {
  if (typeof pixModalCleanup === "function") pixModalCleanup();
}
function openPixModal(order, payment) {
  closePixModal();
  const previousFocus = document.activeElement;
  const backdrop = el("div", "pix-modal-backdrop");
  const dialog = el("section", "pix-modal");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "pix-modal-title");
  dialog.tabIndex = -1;

  const header = el("div", "pix-modal-header");
  const heading = el("div");
  heading.append(el("p", "eyebrow", "Pagamento via PIX"));
  const title = el("h2", "", `Pedido ${order.orderNumber || order.orderId}`);
  title.id = "pix-modal-title";
  heading.append(title);
  const close = button("Fechar", "button-ghost");
  close.setAttribute("aria-label", "Fechar pagamento PIX");
  header.append(heading, close);

  const grid = el("div", "pix-grid");
  const qrWrap = el("div", "pix-qr-wrap");
  const qr = el("img"); qr.src = payment.pixQrCodeDataUrl; qr.alt = "QR Code PIX";
  qrWrap.append(qr);
  const details = el("div", "pix-details");
  details.append(el("span", "plan-meta", "Valor do pedido"), el("p", "pix-total", money.format(Number(payment.amountCents || order.totalCents) / 100)));
  if (payment.pixKey) {
    const row = el("p", "pix-meta"); row.append(el("strong", "", "Chave PIX: "), document.createTextNode(payment.pixKey)); details.append(row);
  }
  if (payment.pixTxid) {
    const row = el("p", "pix-meta"); row.append(el("strong", "", "Identificação: "), document.createTextNode(payment.pixTxid)); details.append(row);
  }
  const codeLabel = el("label", "pix-code-label", "PIX Copia e Cola");
  const code = el("textarea", "pix-code"); code.readOnly = true; code.value = payment.pixCode; codeLabel.append(code);
  const copy = button("Copiar código PIX", "button-secondary", async () => {
    await navigator.clipboard.writeText(payment.pixCode); showToast("Código PIX copiado.");
  });
  const reported = button("Já efetuei o pagamento", "button", async () => {
    const whatsappWindow = window.open("about:blank", "_blank");
    if (whatsappWindow) whatsappWindow.opener = null;
    reported.disabled = true;
    try {
      await api(`/api/v1/customer/orders/${encodeURIComponent(order.orderId)}/payment-reported`, { method: "POST", body: JSON.stringify({}) });
      invalidateCheckoutDraft();
      state.cart = [];
      await syncCart();
      showToast("Pagamento informado. Envie o comprovante pelo WhatsApp.");
      closePixModal();
      if (whatsappWindow) {
        whatsappWindow.location.replace(payment.whatsappUrl);
        navigate("/conta/compras");
      } else {
        location.assign(payment.whatsappUrl);
      }
    } catch (error) {
      if (whatsappWindow) whatsappWindow.close();
      showToast(errorMessage(error));
      reported.disabled = false;
    }
  });
  const actions = el("div", "pix-actions"); actions.append(copy, reported);
  details.append(codeLabel, actions, el("p", "pix-help", "A confirmação é manual. Envie o comprovante pelo WhatsApp; a licença será exibida em Minhas compras após a aprovação."));
  grid.append(qrWrap, details); dialog.append(header, grid); backdrop.append(dialog); document.body.append(backdrop); document.body.classList.add("pix-modal-open");

  const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), textarea, [href], [tabindex]:not([tabindex="-1"])')];
  const onKey = event => {
    if (event.key === "Escape") return closePixModal();
    if (event.key !== "Tab") return;
    const nodes = focusable(); if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const onBackdrop = event => { if (event.target === backdrop) closePixModal(); };
  pixModalCleanup = () => {
    document.removeEventListener("keydown", onKey); backdrop.removeEventListener("click", onBackdrop); backdrop.remove();
    document.body.classList.remove("pix-modal-open"); pixModalCleanup = null;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  close.addEventListener("click", closePixModal); backdrop.addEventListener("click", onBackdrop); document.addEventListener("keydown", onKey); dialog.focus();
}
async function checkout() {
  if (!state.user) return navigate("/entrar?next=%2Fcarrinho");
  if (!state.user.emailVerified) return showToast("Confirme seu e-mail antes de comprar.");
  if (!state.account?.profileComplete) return navigate("/conta/perfil?checkout=1");
  const offers = cartOffers(); if (!offers.length) return;
  const action = $("#checkout-button"); action.disabled = true; action.textContent = "Preparando PIX…";
  try {
    let draft = ensureCheckoutDraft();
    let order = null;
    if (draft.orderId) {
      try {
        order = (await api(`/api/v1/customer/orders/${encodeURIComponent(draft.orderId)}`)).order;
        if (!["pending_payment", "payment_failed"].includes(order.status)) {
          if (["payment_reported", "paid", "fulfilled"].includes(order.status)) {
            invalidateCheckoutDraft(); state.cart = []; await syncCart();
            showToast("Este pedido já foi informado. Acompanhe em Minhas compras."); return navigate("/conta/compras");
          }
          invalidateCheckoutDraft(); order = null; draft = ensureCheckoutDraft();
        }
      } catch (error) {
        if (error.status !== 404) throw error;
        invalidateCheckoutDraft(); draft = ensureCheckoutDraft();
      }
    }
    if (!order) {
      order = (await api("/api/v1/customer/orders", {
        method: "POST", body: JSON.stringify({ idempotencyKey: draft.idempotencyKey, items: offers.map(({ item }) => item) })
      })).order;
      draft = { ...draft, orderId: order.orderId }; writeCheckoutDraft(draft);
    }
    const payment = await api(`/api/v1/customer/orders/${encodeURIComponent(order.orderId)}/payment`, {
      method: "POST", body: JSON.stringify({ method: "pix", idempotencyKey: `pix-${order.orderId}` })
    });
    openPixModal(order, payment.payment);
    action.disabled = false; action.textContent = "Ver PIX";
  } catch (error) {
    if (error.reason === "profile_incomplete") return navigate("/conta/perfil?checkout=1");
    showToast(errorMessage(error)); action.disabled = false; action.textContent = "Finalizar com PIX";
  }
}
async function renderCart() {
  setDocument("Carrinho");
  await loadCatalog();
  state.cart = state.cart.filter(item => findOffer(item));
  saveLocalCart();
  app.replaceChildren();
  const page = el("section", "page");
  page.append(titleBlock("Compra", "Seu carrinho", "Cada unidade comprada gera uma licença independente e uma key própria."));
  const offers = cartOffers();
  if (!offers.length) {
    page.append(emptyState("Seu carrinho está vazio", "Adicione um plano para continuar."), anchor("Explorar programas", "/programas", "button"));
    return app.append(page);
  }
  const layout = el("div", "cart-layout");
  const list = el("div", "cart-list");
  for (const offer of offers) {
    const row = el("article", "cart-item");
    const identity = el("div");
    const cartLogo = image(offer.project.logoUrl || offer.project.iconUrl || offer.project.imageUrl, `Logo de ${offer.project.name}`, "product-icon");
    if (cartLogo) identity.append(cartLogo);
    identity.append(
      el("strong", "", offer.project.name),
      el("p", "", offer.plan.name),
      el("small", "plan-meta", `${money.format(planCents(offer.plan) / 100)} cada · subtotal ${money.format(planCents(offer.plan) * offer.item.quantity / 100)}`)
    );
    const quantity = el("div", "quantity");
    const change = delta => {
      offer.item.quantity = Math.max(1, Math.min(50, offer.item.quantity + delta));
      invalidateCheckoutDraft();
      void syncCart(); renderCart();
    };
    quantity.append(button("−", "", () => change(-1)), el("span", "", offer.item.quantity), button("+", "", () => change(1)));
    const remove = button("Remover", "button-ghost", () => { state.cart = state.cart.filter(item => cartKey(item) !== cartKey(offer.item)); invalidateCheckoutDraft(); void syncCart(); renderCart(); });
    row.append(identity, quantity, remove); list.append(row);
  }
  const summary = el("aside", "panel summary"); summary.id = "cart-checkout";
  const units = offers.reduce((sum, offer) => sum + offer.item.quantity, 0);
  const total = offers.reduce((sum, offer) => sum + planCents(offer.plan) * offer.item.quantity, 0);
  const unitRow = el("div", "summary-row"); unitRow.append(el("span", "", "Licenças"), el("strong", "", units));
  const totalRow = el("div", "summary-row summary-total"); totalRow.append(el("span", "", "Total estimado"), el("strong", "", money.format(total / 100)));
  summary.append(el("h2", "", "Resumo"), unitRow, totalRow, el("p", "plan-meta", "Preço e disponibilidade serão recalculados no servidor."), button("Finalizar com PIX", "button", checkout));
  summary.lastElementChild.id = "checkout-button";
  layout.append(list, summary); page.append(layout); app.append(page);
}
function authPage(mode) {
  const config = {
    login: ["Entrar", "Acesse compras e licenças.", "Entrar"],
    signup: ["Criar conta", "Cadastre-se para comprar e acompanhar licenças.", "Criar conta"],
    reset: ["Recuperar senha", "Enviaremos um link de redefinição ao seu e-mail.", "Enviar link"]
  }[mode];
  setDocument(config[0]);
  app.replaceChildren();
  const page = el("section", "page");
  const panel = el("section", "panel form-card");
  const authLogo = el("img", "auth-lockup");
  authLogo.src = "/assets/brand/guiasys-licensing-lockup.svg";
  authLogo.alt = "GuiaSys Licensing";
  panel.append(authLogo, titleBlock("Conta GuiaSys", config[0], config[1]));
  const form = el("form", "form-grid");
  form.noValidate = true;
  if (mode === "signup") {
    const nameLabel = el("label", "full", "Nome completo"); const name = el("input"); name.name = "name"; name.autocomplete = "name"; name.required = true; nameLabel.append(name); form.append(nameLabel);
  }
  const emailLabel = el("label", "full", "E-mail"); const email = el("input"); email.name = "email"; email.type = "email"; email.autocomplete = "email"; email.required = true; emailLabel.append(email); form.append(emailLabel);
  if (mode !== "reset") {
    const passwordLabel = el("label", "full", "Senha"); const password = el("input"); password.name = "password"; password.type = "password"; password.autocomplete = mode === "signup" ? "new-password" : "current-password"; password.minLength = 6; password.required = true; passwordLabel.append(password); form.append(passwordLabel);
    if (mode === "signup") {
      const confirmLabel = el("label", "full", "Confirmar senha"); const confirm = el("input"); confirm.name = "passwordConfirm"; confirm.type = "password"; confirm.autocomplete = "new-password"; confirm.minLength = 6; confirm.required = true; confirmLabel.append(confirm); form.append(confirmLabel);
    }
  }
  const submit = button(config[2], "button"); submit.type = "submit"; form.append(submit);
  const message = el("p", "form-message full"); form.append(message);
  form.addEventListener("submit", async event => {
    event.preventDefault(); submit.disabled = true; message.className = "form-message full"; message.textContent = "Aguarde…";
    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email.value.trim()); message.classList.add("success"); message.textContent = "Link enviado. Verifique sua caixa de entrada.";
      } else if (mode === "signup") {
        if (form.elements.password.value !== form.elements.passwordConfirm.value) throw new Error("As senhas não coincidem.");
        const credential = await createUserWithEmailAndPassword(auth, email.value.trim(), form.elements.password.value);
        await updateProfile(credential.user, { displayName: form.elements.name.value.trim() });
        await sendEmailVerification(credential.user);
        await credential.user.getIdToken(true);
        navigate("/conta/perfil");
      } else {
        await signInWithEmailAndPassword(auth, email.value.trim(), form.elements.password.value);
        const next = new URLSearchParams(location.search).get("next");
        navigate(safeNextPath(next));
      }
    } catch (error) { message.classList.add("error"); message.textContent = "Não foi possível concluir. Verifique os dados e tente novamente."; console.error(error); }
    finally { submit.disabled = false; }
  });
  if (mode === "login" || mode === "signup") {
    const google = button(mode === "signup" ? "Criar conta com Google" : "Continuar com Google", "button-secondary", async () => {
      try {
        await signInWithPopup(auth, googleProvider);
        const next = new URLSearchParams(location.search).get("next");
        navigate(mode === "signup" ? "/conta/perfil" : safeNextPath(next));
      } catch (error) { message.textContent = "Login Google cancelado ou indisponível."; }
    });
    panel.append(google);
  }
  const links = el("div", "auth-links");
  if (mode !== "login") links.append(anchor("Já tenho conta", "/entrar"));
  if (mode !== "signup") links.append(anchor("Criar conta", "/cadastro"));
  if (mode !== "reset") links.append(anchor("Esqueci a senha", "/recuperar-senha"));
  panel.append(form, links); page.append(panel); app.append(page);
}
function accountLayout(currentPath, content) {
  const page = el("section", "page");
  const shell = el("div", "account-shell");
  const nav = el("nav", "account-nav");
  for (const [label, href] of [["Perfil", "/conta/perfil"], ["Favoritos", "/conta/favoritos"], ["Compras e licenças", "/conta/compras"]]) {
    const item = anchor(label, href); if (href === currentPath) item.setAttribute("aria-current", "page"); nav.append(item);
  }
  shell.append(nav, content); page.append(shell); app.replaceChildren(page);
}
async function requireAccount() {
  if (!state.user) { navigate(`/entrar?next=${encodeURIComponent(location.pathname + location.search)}`, true); return false; }
  if (!state.account) {
    const response = await api("/api/v1/customer/me");
    state.account = response.account;
  }
  return true;
}
async function renderProfile() {
  setDocument("Meu perfil");
  if (!await requireAccount()) return;
  const content = el("section", "panel");
  content.append(titleBlock("Minha conta", "Perfil e endereço", "Seus dados são usados para identificar a compra e emitir licenças."));
  if (!state.user.emailVerified) {
    const verifyBox = el("div", "form-message error");
    verifyBox.append(el("span", "", "Confirme seu e-mail antes de finalizar compras."));
    const verifyActions = el("div", "inline-actions");
    verifyActions.append(
      button("Reenviar confirmação", "button-secondary", async event => {
        event.currentTarget.disabled = true;
        try {
          await sendEmailVerification(state.user);
          showToast("E-mail de confirmação reenviado.");
        } catch (error) {
          showToast(errorMessage(error, "Não foi possível reenviar a confirmação agora."));
        } finally { event.currentTarget.disabled = false; }
      }),
      button("Já confirmei", "button-ghost", async event => {
        event.currentTarget.disabled = true;
        try {
          await state.user.reload();
          await state.user.getIdToken(true);
          if (state.user.emailVerified) {
            showToast("E-mail confirmado.");
            await renderProfile();
          } else {
            showToast("A confirmação ainda não foi identificada.");
          }
        } catch (error) {
          showToast(errorMessage(error, "Não foi possível atualizar o estado do e-mail."));
        } finally { if (event.currentTarget.isConnected) event.currentTarget.disabled = false; }
      })
    );
    verifyBox.append(verifyActions);
    content.append(verifyBox);
  }
  if (new URLSearchParams(location.search).get("checkout")) content.append(el("p", "form-message", "Complete os campos obrigatórios para voltar ao carrinho."));
  const form = el("form", "form-grid"); form.noValidate = true;
  const fields = [
    ["displayName","Nome completo","text","name",true],["email","E-mail","email","email",false],
    ["taxId","CPF","text","off",true],["phone","Telefone com DDD","tel","tel",true],
    ["postalCode","CEP","text","postal-code",true],["street","Logradouro","text","street-address",true],
    ["number","Número","text","off",true],["complement","Complemento","text","off",false],
    ["neighborhood","Bairro","text","off",true],["city","Cidade","text","address-level2",true],
    ["state","UF","text","address-level1",true]
  ];
  for (const [name,label,type,autocomplete,editable] of fields) {
    const wrap = el("label", name === "displayName" || name === "email" || name === "street" ? "full" : "", label);
    const input = el("input"); input.name = name; input.type = type; input.autocomplete = autocomplete; input.value = name === "email" ? state.account.email : (state.account[name] || ""); input.disabled = !editable; if (editable && name !== "complement") input.required = true; if (name === "state") input.maxLength = 2; wrap.append(input); form.append(wrap);
  }
  form.elements.taxId.value = formatCpf(form.elements.taxId.value);
  form.elements.phone.value = formatPhone(form.elements.phone.value);
  form.elements.postalCode.value = formatCep(form.elements.postalCode.value);
  bindMask(form.elements.taxId, formatCpf, 14);
  bindMask(form.elements.phone, formatPhone, 15);
  bindMask(form.elements.postalCode, formatCep, 9);
  form.elements.taxId.placeholder = "000.000.000-00";
  form.elements.phone.placeholder = "(00) 00000-0000";
  form.elements.postalCode.placeholder = "00000-000";
  form.elements.state.addEventListener("input", () => { form.elements.state.value = form.elements.state.value.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase(); });

  let lastCepLookup = "";
  let cepLookupBusy = false;
  const submit = button("Salvar perfil", "button"); submit.type = "submit";
  const message = el("p", "form-message full"); form.append(submit, message);
  const lookupCep = async ({ focusNumber = false } = {}) => {
    const cep = onlyDigits(form.elements.postalCode.value, 8);
    if (cep.length !== 8 || cepLookupBusy || cep === lastCepLookup) {
      if (focusNumber && cep.length === 8) form.elements.number.focus();
      return;
    }
    cepLookupBusy = true; message.className = "form-message full"; message.textContent = "Buscando endereço pelo CEP…";
    try {
      const address = (await api("/api/v1/customer/address/cep", {
        method: "POST",
        body: JSON.stringify({ postalCode: cep })
      })).address || {};
      form.elements.street.value = address.street || "";
      form.elements.neighborhood.value = address.neighborhood || "";
      form.elements.city.value = address.city || "";
      form.elements.state.value = address.state || "";
      lastCepLookup = cep; message.className = "form-message full success";
      message.textContent = "Endereço preenchido pelo CEP. Revise os dados e informe o número.";
      if (focusNumber) form.elements.number.focus();
    } catch (error) {
      message.className = "form-message full error";
      message.textContent = errorMessage(error, "Não foi possível consultar o CEP. Preencha o endereço manualmente.");
    } finally { cepLookupBusy = false; }
  };
  form.elements.postalCode.addEventListener("blur", () => { void lookupCep(); });
  form.elements.postalCode.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); void lookupCep({ focusNumber: true });
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    form.elements.taxId.setCustomValidity(isValidCpfClient(form.elements.taxId.value) ? "" : "Informe um CPF válido.");
    form.elements.phone.setCustomValidity(/^\d{10,11}$/.test(onlyDigits(form.elements.phone.value, 11)) ? "" : "Informe um telefone com DDD.");
    form.elements.postalCode.setCustomValidity(/^\d{8}$/.test(onlyDigits(form.elements.postalCode.value, 8)) ? "" : "Informe um CEP válido.");
    if (!form.reportValidity()) return;
    submit.disabled = true; message.textContent = "Salvando…";
    const payload = Object.fromEntries(fields.filter(field => field[4]).map(([name]) => [name, form.elements[name].value.trim()]));
    try {
      const response = await api("/api/v1/customer/me", { method: "PATCH", body: JSON.stringify(payload) });
      state.account = response.account; message.className = "form-message full success"; message.textContent = "Perfil salvo.";
      if (new URLSearchParams(location.search).get("checkout")) setTimeout(() => navigate("/carrinho"), 450);
    } catch (error) { message.className = "form-message full error"; message.textContent = errorMessage(error); }
    finally { submit.disabled = false; }
  });
  const photo = el("section", "profile-photo-card full");
  const photoPreview = el("div", "profile-photo-preview");
  const photoUrl = safeHttpsUrl(state.account.photoUrl);
  const photoFallback = el("span", "profile-photo-fallback", profileInitial());
  photoPreview.append(photoFallback);
  if (photoUrl) {
    const currentPhoto = el("img", "profile-photo-image");
    currentPhoto.src = photoUrl;
    currentPhoto.alt = "Foto do perfil atual";
    currentPhoto.referrerPolicy = "no-referrer";
    currentPhoto.addEventListener("error", () => {
      currentPhoto.remove();
      photoFallback.hidden = false;
    });
    photoFallback.hidden = true;
    photoPreview.prepend(currentPhoto);
  }
  const photoDetails = el("div", "profile-photo-details");
  photoDetails.append(el("h3", "", "Foto do perfil"));
  if (state.account.photoSource === "google") {
    photoDetails.append(el("p", "profile-photo-note", "Foto padrão da conta Google"));
  } else {
    photoDetails.append(el("p", "profile-photo-note", "JPG, PNG ou WebP, até 2 MB."));
  }
  const photoActions = el("div", "inline-actions");
  const photoStatus = el("p", "profile-photo-status");
  photoStatus.setAttribute("aria-live", "polite");
  const file = el("input", "profile-photo-input");
  file.type = "file";
  file.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
  file.hidden = true;
  const changePhoto = button("Trocar foto", "button-secondary", () => file.click());
  photoActions.append(changePhoto);
  let removePhoto = null;
  if (state.account.photoSource === "custom") {
    removePhoto = button("Remover foto", "button-ghost", async () => {
      changePhoto.disabled = true;
      removePhoto.disabled = true;
      photoStatus.className = "profile-photo-status";
      photoStatus.textContent = "Removendo foto…";
      try {
        const response = await api("/api/v1/customer/me/photo", { method: "DELETE" });
        state.account = response.account;
        updateHeader();
        showToast("Foto removida.");
        await renderProfile();
      } catch (error) {
        photoStatus.className = "profile-photo-status error";
        photoStatus.textContent = errorMessage(error);
        changePhoto.disabled = false;
        removePhoto.disabled = false;
      }
    });
    photoActions.append(removePhoto);
  }
  file.addEventListener("change", async () => {
    const selected = file.files?.[0]; if (!selected) return;
    if (selected.size > 2 * 1024 * 1024) {
      file.value = "";
      showToast("A foto deve ter no máximo 2 MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      file.value = "";
      showToast("Escolha uma foto JPG, PNG ou WebP.");
      return;
    }
    changePhoto.disabled = true;
    if (removePhoto) removePhoto.disabled = true;
    photoStatus.className = "profile-photo-status";
    photoStatus.textContent = "Enviando foto…";
    try {
      const dataBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(selected); });
      const response = await api("/api/v1/customer/me/photo", { method: "POST", body: JSON.stringify({ fileName: selected.name, contentType: selected.type, dataBase64 }) });
      state.account = response.account;
      updateHeader();
      showToast("Foto atualizada.");
      await renderProfile();
    } catch (error) {
      photoStatus.className = "profile-photo-status error";
      photoStatus.textContent = errorMessage(error);
      changePhoto.disabled = false;
      if (removePhoto) removePhoto.disabled = false;
    } finally { file.value = ""; }
  });
  photoDetails.append(photoActions, photoStatus, file);
  photo.append(photoPreview, photoDetails);
  form.prepend(photo);
  content.append(form);
  accountLayout("/conta/perfil", content);
}
async function renderFavorites() {
  setDocument("Favoritos");
  if (!await requireAccount()) return;
  await loadCatalog();
  const response = await api("/api/v1/customer/favorites");
  state.favorites = response.projectIds || [];
  const content = el("section");
  content.append(titleBlock("Minha conta", "Favoritos"));
  const grid = el("div", "catalog-grid");
  state.catalog.filter(project => state.favorites.includes(project.projectId)).forEach(project => grid.append(productCard(project, { favoriteControls: true })));
  content.append(grid.childElementCount ? grid : emptyState("Nenhum favorito", "Salve programas para encontrá-los rapidamente."));
  accountLayout("/conta/favoritos", content);
}
const statusLabels = { pending_payment:"Aguardando pagamento", payment_reported:"Pagamento informado", paid:"Pago", fulfilling:"Liberando licença", fulfilled:"Concluído", cancelled:"Cancelado", payment_failed:"Falha no pagamento" };
async function renderPurchases() {
  setDocument("Compras e licenças");
  if (!await requireAccount()) return;
  const [ordersResponse, licensesResponse] = await Promise.all([api("/api/v1/customer/orders"), api("/api/v1/customer/licenses")]);
  const orders = ordersResponse.orders || [], licenses = licensesResponse.licenses || [];
  const content = el("section");
  content.append(titleBlock("Minha conta", "Compras e licenças", "Acompanhe pedidos, quantidades e todas as chaves emitidas."));
  const records = el("div", "records");
  for (const order of orders) {
    const card = el("article", "record-card");
    const head = el("div", "record-head"); head.append(el("strong", "", `Pedido ${order.orderNumber || order.orderId}`), el("span", "status", statusLabels[order.status] || order.status)); card.append(head);
    if (order.createdAt) card.append(el("p", "plan-meta", `Criado em ${dateTime.format(new Date(order.createdAt))}`));
    const lines = el("div", "order-lines");
    for (const item of order.items || []) lines.append(el("span", "", `${item.quantity}× ${item.projectNameSnapshot} — ${item.planNameSnapshot} · ${money.format(item.lineTotalCents / 100)}`));
    card.append(lines, el("strong", "", `Total: ${money.format(Number(order.totalCents || 0) / 100)}`));
    const related = licenses.filter(license => license.orderId === order.orderId);
    if (related.length) {
      const keys = el("div"); keys.append(el("p", "plan-meta", "Licenças emitidas"));
      for (const license of related) {
        const licenseRow = el("div", "license-row");
        const key = button(license.key, "license-key", async () => { await navigator.clipboard.writeText(license.key); showToast("Chave copiada."); });
        const validity = license.lifetime ? "Vitalícia" : (license.expiresAt ? `Válida até ${dateTime.format(new Date(license.expiresAt))}` : "Validade inicia na ativação");
        licenseRow.append(key, el("span", "plan-meta", `${license.status || "pending"} · ${validity}`));
        keys.append(licenseRow);
      }
      card.append(keys);
    }
    if (order.status === "pending_payment") card.append(button("Continuar pagamento", "button-secondary", async event => {
      event.currentTarget.disabled = true;
      try {
        const response = await api(`/api/v1/customer/orders/${encodeURIComponent(order.orderId)}/payment`, { method:"POST", body:JSON.stringify({ method:"pix", idempotencyKey:`pix-${order.orderId}` }) });
        openPixModal(order, response.payment);
      } catch (error) { showToast(errorMessage(error)); event.currentTarget.disabled = false; }
    }));
    records.append(card);
  }
  content.append(records.childElementCount ? records : emptyState("Nenhuma compra", "Seus pedidos aparecerão aqui."));
  accountLayout("/conta/compras", content);
}
function renderLegal(kind) {
  const privacy = kind === "privacidade";
  setDocument(privacy ? "Privacidade" : "Termos de uso");
  const page = el("article", "page legal");
  page.append(el("p", "eyebrow", "GuiaSys Licensing"), el("h1", "", privacy ? "Política de privacidade" : "Termos de uso"), el("p", "lead", "Última atualização: 6 de outubro de 2026."));
  const sections = privacy ? [
    ["Dados tratados", "Tratamos dados de conta, contato, endereço, pedidos, pagamentos informados e licenças para operar o serviço."],
    ["Finalidades", "Os dados são usados para autenticação, atendimento, prevenção a fraude, confirmação manual do pagamento e entrega das licenças."],
    ["Consulta de CEP", "Quando você usa o preenchimento automático de endereço, somente o CEP informado é enviado ao serviço de consulta de endereço; CPF, telefone e demais dados do perfil não fazem parte dessa consulta."],
    ["Segurança e direitos", "Aplicamos controle de acesso por conta. Solicitações sobre dados podem ser encaminhadas ao suporte oficial."]
  ] : [
    ["Objeto", "Este portal comercializa licenças oficiais de programas GuiaSys conforme o plano e as condições apresentados no pedido."],
    ["Pagamento e entrega", "O pagamento disponível é PIX manual. A licença é liberada após confirmação administrativa do recebimento."],
    ["Uso da licença", "Cada chave segue limites de duração, dispositivos e ativação registrados no plano adquirido."],
    ["Suporte", "Dúvidas comerciais ou técnicas devem ser encaminhadas ao canal oficial exibido no rodapé."]
  ];
  for (const [title,text] of sections) page.append(el("h2", "", title), el("p", "", text));
  app.replaceChildren(page);
}
async function renderRoute() {
  loading();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/") await renderHome();
    else if (path === "/programas") await renderPrograms();
    else if (path.startsWith("/programas/")) await renderProgram(decodeURIComponent(path.slice("/programas/".length)));
    else if (path === "/carrinho") await renderCart();
    else if (path === "/entrar") authPage("login");
    else if (path === "/cadastro") authPage("signup");
    else if (path === "/recuperar-senha") authPage("reset");
    else if (path === "/conta/perfil") await renderProfile();
    else if (path === "/conta/favoritos") await renderFavorites();
    else if (path === "/conta/compras") await renderPurchases();
    else if (path === "/termos") renderLegal("termos");
    else if (path === "/privacidade") renderLegal("privacidade");
    else { setDocument("Página não encontrada"); app.replaceChildren(emptyState("Página não encontrada", "O endereço informado não existe.")); }
    if (location.hash) requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
    else scrollTo({ top: 0, behavior: "instant" });
    app.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    app.replaceChildren(emptyState("Não foi possível carregar esta página", errorMessage(error)));
  }
}
async function onSignedIn(user) {
  if (state.user && state.user.uid !== user.uid) {
    state.cart = [];
    state.favorites = [];
    saveLocalCart();
  }
  state.user = user;
  try {
    const [me, remoteCart, favorites] = await Promise.all([
      api("/api/v1/customer/me"),
      api("/api/v1/customer/cart"),
      api("/api/v1/customer/favorites").catch(() => ({ projectIds: [] }))
    ]);
    state.account = me.account;
    state.favorites = favorites.projectIds || [];
    if (state.syncedUid !== user.uid) {
      state.cart = mergeCarts(state.cart, remoteCart.cart?.items || []);
      state.syncedUid = user.uid;
      await syncCart();
    }
  } catch (error) { console.error("Falha ao preparar a conta.", error); }
  updateHeader();
}

document.addEventListener("click", event => {
  const link = event.target.closest("a[data-link]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(link.href);
});
window.addEventListener("popstate", renderRoute);
$(".menu-button").addEventListener("click", event => {
  const nav = $("#site-nav"); const open = nav.classList.toggle("open"); event.currentTarget.setAttribute("aria-expanded", String(open));
});
$("#account-menu-button").addEventListener("click", event => {
  if (!state.user) return navigate("/entrar");
  const dropdown = $("#account-dropdown");
  const open = dropdown.hidden;
  dropdown.hidden = !open;
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
$("#logout-button").addEventListener("click", async () => {
  state.cart = [];
  state.favorites = [];
  state.syncedUid = "";
  invalidateCheckoutDraft();
  saveLocalCart();
  await signOut(auth);
  navigate("/");
});
document.addEventListener("click", event => {
  if (event.target.closest(".account-menu")) return;
  $("#account-dropdown").hidden = true;
  $("#account-menu-button").setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  $("#account-dropdown").hidden = true;
  $("#account-menu-button").setAttribute("aria-expanded", "false");
});
document.querySelectorAll("[data-brand-image]").forEach(node => node.addEventListener("error", () => {
  node.hidden = true; document.querySelector("[data-brand-fallback]").hidden = false;
}, { once: true }));
$("#current-year").textContent = String(new Date().getFullYear());
onAuthStateChanged(auth, async user => {
  if (user) await onSignedIn(user);
  else {
    const hadUser = Boolean(state.user);
    state.user = null; state.account = null; state.favorites = []; state.syncedUid = "";
    if (hadUser) { state.cart = []; saveLocalCart(); }
    updateHeader();
  }
  if (!state.authReady) { state.authReady = true; await renderRoute(); }
  else if (location.pathname.startsWith("/conta/") || location.pathname === "/entrar") await renderRoute();
});

export { mergeCarts, safeHttpsUrl };
