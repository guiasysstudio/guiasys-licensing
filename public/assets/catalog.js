const catalogStatus = document.querySelector("#catalog-status");
const catalogGrid = document.querySelector("#catalog-grid");
const catalogEmpty = document.querySelector("#catalog-empty");
const catalogError = document.querySelector("#catalog-error");
const selectionStatus = document.querySelector("#selection-status");
const retryButton = document.querySelector("#catalog-retry");

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function durationLabel(plan) {
  if (plan.lifetime) return "Licença vitalícia";
  const days = Number(plan.durationDays || 0);
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

function deviceLabel(plan) {
  const count = Math.max(1, Number(plan.deviceLimit || 1));
  return `${count} ${count === 1 ? "dispositivo" : "dispositivos"}`;
}

function selectOffer(project, plan) {
  const query = new URLSearchParams(window.location.search);
  query.set("projectId", project.projectId);
  query.set("planId", plan.id);
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}#catalog`);
  selectionStatus.textContent = `Oferta selecionada: ${project.name} — ${plan.name}. O checkout será disponibilizado na próxima etapa.`;
  selectionStatus.hidden = false;
  selectionStatus.focus?.();
}

function planCard(project, plan) {
  const card = element("article", "plan-card");
  const heading = element("h4", "plan-name", plan.name || "Oferta");
  const price = element("p", "plan-price", money.format(Number(plan.price || 0)));
  const description = element("p", "plan-description", plan.description || "Licença oficial GuiaSys.");
  const details = element("ul", "plan-details");

  for (const label of [durationLabel(plan), deviceLabel(plan)]) {
    const item = element("li", "", label);
    details.append(item);
  }

  const button = element("button", "offer-button", "Selecionar oferta");
  button.type = "button";
  button.dataset.projectId = project.projectId;
  button.dataset.planId = plan.id;
  button.setAttribute("aria-label", `Selecionar ${plan.name} de ${project.name}`);
  button.addEventListener("click", () => selectOffer(project, plan));

  card.append(heading, price, description, details, button);
  return card;
}

function productCard(project) {
  const card = element("article", `product-card${project.featured ? " product-featured" : ""}`);
  card.dataset.projectId = project.projectId;

  const header = element("div", "product-header");
  const imageUrl = safeHttpsUrl(project.imageUrl);
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "product-logo";
    image.src = imageUrl;
    image.alt = `Logo de ${project.name}`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    header.append(image);
  } else {
    header.append(element("div", "product-monogram", String(project.name || "GS").slice(0, 2).toUpperCase()));
  }

  const identity = element("div", "product-identity");
  if (project.featured) identity.append(element("span", "featured-label", "Destaque"));
  identity.append(element("h3", "", project.name || "Programa GuiaSys"));
  identity.append(element("p", "", project.shortDescription || project.description || "Programa oficial GuiaSys."));
  header.append(identity);

  const body = element("div", "product-body");
  if (project.description && project.description !== project.shortDescription) {
    body.append(element("p", "product-description", project.description));
  }

  if (project.trial?.enabled) {
    const days = Math.max(1, Number(project.trial.days || 1));
    body.append(element("p", "trial-badge", `Avaliação disponível por ${days} ${days === 1 ? "dia" : "dias"}`));
  }

  const plans = element("div", "plans-grid");
  plans.setAttribute("aria-label", `Ofertas de ${project.name}`);
  if (Array.isArray(project.plans) && project.plans.length) {
    for (const plan of project.plans) plans.append(planCard(project, plan));
  } else {
    plans.append(element("p", "no-plans", "Nenhuma oferta publicada para este programa."));
  }
  body.append(plans);
  card.append(header, body);
  return card;
}

function showState(name) {
  catalogStatus.hidden = name !== "loading";
  catalogGrid.hidden = name !== "ready";
  catalogEmpty.hidden = name !== "empty";
  catalogError.hidden = name !== "error";
}

async function loadCatalog() {
  showState("loading");
  catalogGrid.replaceChildren();

  try {
    const response = await fetch("/api/v1/catalog", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`catalog_http_${response.status}`);

    const payload = await response.json();
    if (!payload?.ok || !Array.isArray(payload?.catalog?.projects)) {
      throw new Error("catalog_invalid_payload");
    }

    if (!payload.catalog.projects.length) {
      showState("empty");
      return;
    }

    for (const project of payload.catalog.projects) {
      catalogGrid.append(productCard(project));
    }
    showState("ready");
  } catch (error) {
    console.error("Falha ao carregar o catálogo público.", error);
    showState("error");
  }
}

document.querySelector("#current-year").textContent = String(new Date().getFullYear());
retryButton.addEventListener("click", loadCatalog);
loadCatalog();

export { durationLabel, safeHttpsUrl };
