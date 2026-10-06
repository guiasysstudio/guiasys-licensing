import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = { apiKey: "AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00", authDomain: "guiasys-licensing.firebaseapp.com", projectId: "guiasys-licensing", storageBucket: "guiasys-licensing.firebasestorage.app", messagingSenderId: "854287499951", appId: "1:854287499951:web:0369b194e7663a9d9c0a5a" };
const customerApp = initializeApp(firebaseConfig, "customer-storefront");
const auth = getAuth(customerApp);
await setPersistence(auth, browserLocalPersistence);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const $ = selector => document.querySelector(selector);
const catalogStatus = $("#catalog-status");
const catalogGrid = $("#catalog-grid");
const catalogEmpty = $("#catalog-empty");
const catalogError = $("#catalog-error");
const selectionStatus = $("#selection-status");
const checkout = $("#checkout");
const quantityInput = $("#checkout-quantity");
const checkoutMessage = $("#checkout-message");
const authDialog = $("#auth-dialog");
let currentUser = null;
let catalog = [];
let selection = null;
let activePixPayment = null;
let activePixOrder = null;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const orderStatusLabel = {
  pending_payment: "Aguardando pagamento",
  payment_reported: "Pagamento informado",
  paid: "Pagamento confirmado",
  fulfilling: "Pagamento confirmado",
  fulfilled: "Pagamento confirmado",
  cancelled: "Cancelado",
  payment_failed: "Falha no pagamento"
};

function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
function safeHttpsUrl(value) { try { const url = new URL(String(value || "")); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; } }
function durationLabel(plan) { if (plan.lifetime) return "Licença vitalícia"; const days = Number(plan.durationDays || 0); return `${days} ${days === 1 ? "dia" : "dias"}`; }
function deviceLabel(plan) { const count = Math.max(1, Number(plan.deviceLimit || 1)); return `${count} ${count === 1 ? "dispositivo" : "dispositivos"}`; }
function unitCents(plan) { return Number.isSafeInteger(plan.priceCents) ? plan.priceCents : Math.round(Number(plan.price || 0) * 100); }

function updateVisualTotal() { if (!selection) return; const quantity = Math.min(50, Math.max(1, Number(quantityInput.value || 1))); quantityInput.value = String(quantity); $("#checkout-total").textContent = money.format((unitCents(selection.plan) * quantity) / 100); }
function selectOffer(project, plan) {
  selection = { project, plan };
  const query = new URLSearchParams(window.location.search);
  query.set("view", "checkout");
  query.set("projectId", project.projectId);
  query.set("planId", plan.id);
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}#checkout`);
  $("#checkout-product").textContent = project.name; $("#checkout-plan").textContent = plan.name;
  $("#checkout-unit-price").textContent = money.format(unitCents(plan) / 100);
  $("#checkout-duration").textContent = durationLabel(plan); $("#checkout-devices").textContent = deviceLabel(plan);
  quantityInput.value = "1"; updateVisualTotal(); checkout.hidden = false;
  selectionStatus.textContent = `Oferta selecionada: ${project.name} — ${plan.name}.`; selectionStatus.hidden = false;
  checkout.scrollIntoView({ behavior: "smooth", block: "start" });
}

function planCard(project, plan) {
  const card = element("article", "plan-card"); const details = element("ul", "plan-details");
  for (const label of [durationLabel(plan), deviceLabel(plan)]) details.append(element("li", "", label));
  const button = element("button", "offer-button", "Selecionar oferta"); button.type = "button";
  button.setAttribute("aria-label", `Selecionar ${plan.name} de ${project.name}`); button.addEventListener("click", () => selectOffer(project, plan));
  card.append(element("h4", "plan-name", plan.name || "Oferta"), element("p", "plan-price", money.format(unitCents(plan) / 100)), element("p", "plan-description", plan.description || "Licença oficial GuiaSys."), details, button); return card;
}
function productCard(project) {
  const card = element("article", `product-card${project.featured ? " product-featured" : ""}`); const header = element("div", "product-header"); const imageUrl = safeHttpsUrl(project.imageUrl);
  if (imageUrl) { const image = document.createElement("img"); image.className = "product-logo"; image.src = imageUrl; image.alt = `Logo de ${project.name}`; image.loading = "lazy"; image.referrerPolicy = "no-referrer"; header.append(image); }
  else header.append(element("div", "product-monogram", String(project.name || "GS").slice(0, 2).toUpperCase()));
  const identity = element("div", "product-identity"); if (project.featured) identity.append(element("span", "featured-label", "Destaque"));
  identity.append(element("h3", "", project.name || "Programa GuiaSys"), element("p", "", project.shortDescription || project.description || "Programa oficial GuiaSys.")); header.append(identity);
  const body = element("div", "product-body"); if (project.description && project.description !== project.shortDescription) body.append(element("p", "product-description", project.description));
  const plans = element("div", "plans-grid"); for (const plan of project.plans || []) plans.append(planCard(project, plan));
  if (!plans.childElementCount) plans.append(element("p", "no-plans", "Nenhuma oferta publicada para este programa.")); body.append(plans); card.append(header, body); return card;
}
function showState(name) { catalogStatus.hidden = name !== "loading"; catalogGrid.hidden = name !== "ready"; catalogEmpty.hidden = name !== "empty"; catalogError.hidden = name !== "error"; }

async function api(path, options = {}) {
  const token = currentUser ? await currentUser.getIdToken() : "";
  const response = await fetch(path, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.message || `Erro HTTP ${response.status}`); return payload;
}

async function copyText(value, button, successLabel) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(String(value || ""));
  } catch {
    const field = document.createElement("textarea");
    field.value = String(value || ""); field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select(); document.execCommand("copy"); field.remove();
  }
  button.textContent = successLabel;
  setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1800);
}

function orderProduct(order) { return order.productName || order.items?.[0]?.projectNameSnapshot || "Produto GuiaSys"; }
function orderPlan(order) { return order.planName || order.items?.[0]?.planNameSnapshot || "Plano"; }

function showPixPayment(order, payment) {
  activePixOrder = order;
  activePixPayment = payment;
  $("#pix-order-number").textContent = payment.orderNumber || order.orderNumber || order.orderId;
  $("#pix-product").textContent = orderProduct(order);
  $("#pix-plan").textContent = orderPlan(order);
  $("#pix-total").textContent = money.format(Number(payment.amountCents || order.totalCents || 0) / 100);
  $("#pix-display-name").textContent = payment.pixDisplayName || "GuiaSys";
  $("#pix-qr-code").src = payment.pixQrCodeDataUrl;
  $("#pix-code").value = payment.pixCode;
  $("#pix-key").value = payment.pixKey;
  $("#pix-message").textContent = order.status === "payment_reported" ? "Pagamento informado. Aguarde a confirmação manual da GuiaSys." : "";
  $("#report-payment-button").disabled = false;
  $("#report-payment-button").textContent = order.status === "payment_reported" ? "ABRIR WHATSAPP NOVAMENTE" : "JÁ EFETUEI O PAGAMENTO";
  $("#pix-payment").hidden = false;
  $("#pix-payment").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function startPixForOrder(order) {
  const payload = await api(`/api/v1/customer/orders/${encodeURIComponent(order.orderId)}/payment`, {
    method: "POST",
    body: JSON.stringify({ method: "pix", idempotencyKey: `pix-${order.orderId}` })
  });
  showPixPayment(order, payload.payment);
  return payload.payment;
}
async function loadCatalog() {
  showState("loading"); catalogGrid.replaceChildren();
  try { const response = await fetch("/api/v1/catalog", { headers: { Accept: "application/json" } }); if (!response.ok) throw new Error(`Erro HTTP ${response.status}`); const payload = await response.json(); catalog = payload?.catalog?.projects || []; if (!catalog.length) return showState("empty");
    for (const project of catalog) catalogGrid.append(productCard(project)); showState("ready");
    const query = new URLSearchParams(location.search); const project = catalog.find(item => item.projectId === query.get("projectId")); const plan = project?.plans?.find(item => item.id === query.get("planId"));
    if (query.get("view") === "checkout" && project && plan) selectOffer(project, plan);
  } catch (error) { console.error("Falha ao carregar catálogo.", error); showState("error"); }
}
function renderRecords(container, records, kind, licenses = []) {
  container.replaceChildren();
  if (!records.length) return container.append(element("p", "no-plans", kind === "order" ? "Nenhum pedido ainda." : "Nenhuma licença disponível."));
  for (const record of records) {
    const card = element("div", "account-record");
    if (kind === "order") {
      card.append(
        element("strong", "", `Pedido ${record.orderNumber || record.orderId}`),
        element("span", "status-pill", orderStatusLabel[record.status] || record.status),
        element("span", "", `${orderProduct(record)} · ${orderPlan(record)} · ${money.format(Number(record.totalCents || 0) / 100)}`),
        element("small", "", new Date(record.createdAt).toLocaleString("pt-BR"))
      );
      if (record.status === "payment_reported") card.append(element("small", "", "Aguardando confirmação manual da GuiaSys."));
      const related = licenses.filter(license => license.orderId === record.orderId || record.resultingLicenses?.some(result => result.licenseId === license.id));
      if (["paid", "fulfilling", "fulfilled"].includes(record.status)) {
        for (const license of related) {
          card.append(element("span", "license-key", license.key));
          const actions = element("div", "account-actions");
          const copy = element("button", "secondary-button", "COPIAR LICENÇA"); copy.type = "button";
          copy.addEventListener("click", () => copyText(license.key, copy, "LICENÇA COPIADA")); actions.append(copy); card.append(actions);
        }
      } else if (record.status === "pending_payment") {
        const actions = element("div", "account-actions");
        const resume = element("button", "secondary-button", "Continuar pagamento"); resume.type = "button";
        resume.addEventListener("click", async () => {
          resume.disabled = true; resume.textContent = "Gerando PIX…";
          try { await startPixForOrder(record); } catch (error) { resume.textContent = error.message; resume.disabled = false; }
        });
        actions.append(resume); card.append(actions);
      }
    } else {
      card.append(element("strong", "", record.planName || record.id), element("span", "license-key", record.key), element("span", "status-pill", record.status), element("small", "", record.expiresAt ? `Válida até ${new Date(record.expiresAt).toLocaleDateString("pt-BR")}` : "Sem vencimento definido"));
      const copyActions = element("div", "account-actions");
      const copy = element("button", "secondary-button", "COPIAR LICENÇA"); copy.type = "button";
      copy.addEventListener("click", () => copyText(record.key, copy, "LICENÇA COPIADA")); copyActions.append(copy); card.append(copyActions);
      const project = catalog.find(item => item.projectId === record.projectId);
      if (!record.lifetime && project?.plans?.length) {
        const controls = element("div", "auth-buttons");
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Oferta de renovação para ${record.key}`);
        for (const plan of project.plans) {
          const option = document.createElement("option"); option.value = plan.id; option.textContent = `${plan.name} — ${money.format(unitCents(plan) / 100)}`; select.append(option);
        }
        const renew = element("button", "secondary-button", "Renovar"); renew.type = "button";
        renew.addEventListener("click", async () => {
          renew.disabled = true; renew.textContent = "Criando pedido…";
          try {
            const payload = await api(`/api/v1/customer/licenses/${record.id}/renewal-order`, { method: "POST", body: JSON.stringify({ planId: select.value, idempotencyKey: crypto.randomUUID() }) });
            await startPixForOrder(payload.order); renew.textContent = `Pedido ${payload.order.orderNumber || payload.order.orderId}`; await loadAccount();
          } catch (error) { renew.disabled = false; renew.textContent = error.message; }
        });
        controls.append(select, renew); card.append(controls);
      }
    }
    container.append(card);
  }
}
async function loadAccount() {
  if (!currentUser || !currentUser.emailVerified) return;
  try { const [me, orders, licenses] = await Promise.all([api("/api/v1/customer/me"), api("/api/v1/customer/orders"), api("/api/v1/customer/licenses")]);
    $("#customer-email").textContent = me.account.email; renderRecords($("#orders-list"), orders.orders, "order", licenses.licenses); renderRecords($("#licenses-list"), licenses.licenses, "license"); $("#customer-area").hidden = false;
  } catch (error) { console.error("Falha ao carregar conta.", error); }
}
async function createOrder() {
  if (!selection) return; if (!currentUser) { authDialog.showModal(); return; }
  if (!currentUser.emailVerified) { checkoutMessage.textContent = "Confirme o e-mail enviado pelo Firebase antes de comprar."; return; }
  const quantity = Math.min(50, Math.max(1, Number(quantityInput.value || 1))); checkoutMessage.textContent = "Criando pedido…";
  try { const payload = await api("/api/v1/customer/orders", { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), items: [{ projectId: selection.project.projectId, planId: selection.plan.id, quantity }] }) });
    checkoutMessage.textContent = `Pedido ${payload.order.orderNumber || payload.order.orderId} criado. Total validado no servidor: ${money.format(payload.order.totalCents / 100)}.`;
    await startPixForOrder(payload.order); await loadAccount();
  } catch (error) { checkoutMessage.textContent = error.message; }
}

async function reportPayment() {
  if (!activePixOrder || !activePixPayment) return;
  const button = $("#report-payment-button"); button.disabled = true; button.textContent = "INFORMANDO PAGAMENTO…";
  try {
    const payload = await api(`/api/v1/customer/orders/${encodeURIComponent(activePixOrder.orderId)}/payment-reported`, { method: "POST", body: JSON.stringify({}) });
    activePixOrder = payload.order;
    $("#pix-message").textContent = "Pagamento informado. Envie o comprovante no WhatsApp e aguarde a confirmação manual.";
    button.disabled = false; button.textContent = "ABRIR WHATSAPP NOVAMENTE";
    await loadAccount();
    window.open(activePixPayment.whatsappUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    button.disabled = false; button.textContent = "JÁ EFETUEI O PAGAMENTO"; $("#pix-message").textContent = error.message;
  }
}
async function emailAction(create) {
  const email = $("#auth-email").value; const password = $("#auth-password").value;
  try { const credential = create ? await createUserWithEmailAndPassword(auth, email, password) : await signInWithEmailAndPassword(auth, email, password); if (create && !credential.user.emailVerified) await sendEmailVerification(credential.user);
    $("#auth-message").textContent = create ? "Conta criada. Confirme o e-mail antes de comprar." : "Login concluído."; if (!create) authDialog.close();
  } catch (error) { $("#auth-message").textContent = "Não foi possível autenticar. Verifique os dados."; console.error(error); }
}

onAuthStateChanged(auth, async user => { currentUser = user; $("#account-button").textContent = user ? (user.displayName || user.email || "Minha conta") : "Entrar"; $("#logout-button").hidden = !user; if (user) await loadAccount(); else $("#customer-area").hidden = true; });
$("#current-year").textContent = String(new Date().getFullYear()); $("#catalog-retry").addEventListener("click", loadCatalog); quantityInput.addEventListener("input", updateVisualTotal);
$("#create-order-button").addEventListener("click", createOrder); $("#account-button").addEventListener("click", () => currentUser ? $("#customer-area").scrollIntoView({ behavior: "smooth" }) : authDialog.showModal());
$("#copy-pix-code").addEventListener("click", event => copyText(activePixPayment?.pixCode, event.currentTarget, "CÓDIGO COPIADO"));
$("#copy-pix-key").addEventListener("click", event => copyText(activePixPayment?.pixKey, event.currentTarget, "CHAVE COPIADA"));
$("#report-payment-button").addEventListener("click", reportPayment);
$("#logout-button").addEventListener("click", () => signOut(auth)); $("#auth-close").addEventListener("click", () => authDialog.close());
$("#google-login").addEventListener("click", async () => { try { await signInWithPopup(auth, googleProvider); authDialog.close(); } catch (error) { $("#auth-message").textContent = "Login Google cancelado ou indisponível."; console.error(error); } });
$("#email-login").addEventListener("click", () => emailAction(false)); $("#email-signup").addEventListener("click", () => emailAction(true)); loadCatalog();

export { durationLabel, safeHttpsUrl };
