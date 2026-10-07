import { assertEntityId, assertProjectId } from "./security.js";

export const MAX_JSON_BYTES = 32 * 1024;

const ADMIN_PERMISSION_KEYS = new Set([
  "viewDashboard",
  "manageProjects",
  "managePlans",
  "manageCustomers",
  "manageLicenses",
  "manageTrial",
  "viewIntegration",
  "manageDevices",
  "viewActivations",
  "viewLogs",
  "viewOrders",
  "manageOrders",
  "viewPayments",
  "manageProjectSettings",
  "managePlatformSettings"
]);

export const COMMERCE_LIMITS = Object.freeze({ maxLines: 10, maxQuantityPerLine: 50, maxUnits: 50 });

function fail(message, status = 400, reason = "invalid_request", details = null) {
  throw Object.assign(new Error(message), {
    status,
    reason,
    ...(details ? { details } : {})
  });
}

function plainObject(value, label = "Payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} deve ser um objeto JSON.`);
  }
  return value;
}

function allowFields(body, allowed) {
  plainObject(body);
  const unknown = Object.keys(body).filter(key => !allowed.has(key));
  if (unknown.length) {
    fail("O payload contém campo(s) não permitido(s).", 400, "invalid_request", { fields: unknown });
  }
}

function readString(body, field, options = {}) {
  const {
    required = false,
    min = required ? 1 : 0,
    max = 1000,
    trim = true,
    pattern = null,
    normalize = value => value
  } = options;

  if (!(field in body)) {
    if (required) fail(`O campo ${field} é obrigatório.`);
    return undefined;
  }

  if (typeof body[field] !== "string") fail(`O campo ${field} deve ser texto.`);
  let value = trim ? body[field].trim() : body[field];
  value = normalize(value);

  if (value.length < min) fail(`O campo ${field} é obrigatório.`);
  if (value.length > max) fail(`O campo ${field} excede o limite de ${max} caracteres.`);
  if (pattern && value && !pattern.test(value)) fail(`O campo ${field} possui formato inválido.`);
  return value;
}

function readBoolean(body, field) {
  if (!(field in body)) return undefined;
  if (typeof body[field] !== "boolean") fail(`O campo ${field} deve ser booleano.`);
  return body[field];
}

function readNumber(body, field, options = {}) {
  const { integer = false, min = -Infinity, max = Infinity } = options;
  if (!(field in body)) return undefined;

  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`O campo ${field} deve ser um número finito.`);
  }
  if (integer && !Number.isInteger(value)) fail(`O campo ${field} deve ser um número inteiro.`);
  if (value < min || value > max) fail(`O campo ${field} está fora do intervalo permitido.`);
  return value;
}

function readEnum(body, field, values) {
  if (!(field in body)) return undefined;
  if (typeof body[field] !== "string" || !values.includes(body[field])) {
    fail(`O campo ${field} possui valor inválido.`);
  }
  return body[field];
}

function assignIfDefined(target, field, value) {
  if (value !== undefined) target[field] = value;
}

function validateEmail(value, field = "email") {
  if (value.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail(`O campo ${field} possui e-mail inválido.`);
  }
  return value.toLowerCase();
}

function validateOrigins(value) {
  if (value === undefined) return undefined;

  let source;
  if (Array.isArray(value)) {
    if (value.length > 30) fail("allowedOrigins aceita no máximo 30 origens.");
    source = value;
  } else if (typeof value === "string") {
    if (value.length > 4096) fail("allowedOrigins excede o tamanho permitido.");
    source = value.split(/[\n,;]+/);
  } else {
    fail("allowedOrigins deve ser texto ou uma lista de textos.");
  }

  const origins = [];
  for (const item of source) {
    if (typeof item !== "string") fail("Cada origem permitida deve ser texto.");
    const raw = item.trim();
    if (!raw) continue;
    if (raw.length > 2048) fail("Uma origem permitida excede o tamanho máximo.");

    let url;
    try {
      url = new URL(raw);
    } catch {
      fail(`Origem inválida: ${raw}`);
    }

    if (!["http:", "https:"].includes(url.protocol)) fail(`Origem inválida: ${raw}`);
    if (url.username || url.password) fail(`Origem inválida: ${raw}`);
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }

  if (origins.length > 30) fail("allowedOrigins aceita no máximo 30 origens.");
  return origins;
}

function validateSecureImageUrl(value, field = "imageUrl") {
  if (value === undefined || value === "") return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`O campo ${field} deve conter uma URL HTTPS válida.`);
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    fail(`O campo ${field} deve conter uma URL HTTPS válida e sem credenciais.`);
  }
  return url.href;
}

function readStringArray(body, field, { maxItems = 20, maxLength = 2048, urls = false } = {}) {
  if (!(field in body)) return undefined;
  if (!Array.isArray(body[field]) || body[field].length > maxItems) {
    fail(`O campo ${field} deve ser uma lista com no máximo ${maxItems} itens.`);
  }
  const values = [];
  for (const item of body[field]) {
    if (typeof item !== "string") fail(`Cada item de ${field} deve ser texto.`);
    const value = item.trim();
    if (!value || value.length > maxLength) fail(`Um item de ${field} possui tamanho inválido.`);
    values.push(urls ? validateSecureImageUrl(value, field) : value);
  }
  return [...new Set(values)];
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidCpf(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const digit = length => {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function selectorFields(body) {
  const result = {};
  const projectId = readString(body, "projectId", { max: 128 });
  const integrationCode = readString(body, "integrationCode", {
    max: 32,
    normalize: value => value.toUpperCase(),
    pattern: /^GSLI-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/
  });

  if (projectId) result.projectId = assertProjectId(projectId);
  if (integrationCode) result.integrationCode = integrationCode;
  if (!result.projectId && !result.integrationCode) {
    fail("Informe projectId ou integrationCode.");
  }
  return result;
}

export async function readJsonBody(request, maxBytes = MAX_JSON_BYTES) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    fail("O corpo da requisição deve ser JSON.", 415, "invalid_request");
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    fail("Payload excede o tamanho permitido.", 413, "payload_too_large");
  }

  if (!request.body) fail("JSON inválido.");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        fail("Payload excede o tamanho permitido.", 413, "payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder().decode(bytes).trim();
  if (!text) fail("JSON inválido.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("JSON inválido.");
  }

  return plainObject(parsed);
}

export function validateProjectPayload(body, { partial = false } = {}) {
  const allowed = new Set([
    "name", "slug", "prefix", "description", "shortDescription", "imageUrl",
    "logoUrl", "iconUrl", "bannerUrl", "tagline", "fullDescription",
    "screenshots", "features", "requirements", "additionalInfo", "commercialText",
    "seoTitle", "seoDescription", "status", "publicCatalog", "featured",
    "featuredOrder", "catalogOrder", "displayOrder",
    "allowedOrigins", "trialEnabled", "trialDays", "trialValidationHours",
    "trialOfflineHours", "offlineDays", "validationHours"
  ]);
  allowFields(body, allowed);

  const result = {};
  assignIfDefined(result, "name", readString(body, "name", { required: !partial, min: 1, max: 80 }));
  assignIfDefined(result, "slug", readString(body, "slug", {
    min: 1,
    max: 48,
    pattern: /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
  }));
  assignIfDefined(result, "prefix", readString(body, "prefix", {
    min: 1,
    max: 8,
    pattern: /^[A-Za-z0-9]+$/
  }));
  assignIfDefined(result, "description", readString(body, "description", { max: 300 }));
  assignIfDefined(result, "shortDescription", readString(body, "shortDescription", { max: 180 }));
  const imageUrl = readString(body, "imageUrl", { max: 2048 });
  assignIfDefined(result, "imageUrl", validateSecureImageUrl(imageUrl));
  for (const field of ["logoUrl", "iconUrl", "bannerUrl"]) {
    const value = readString(body, field, { max: 2048 });
    assignIfDefined(result, field, validateSecureImageUrl(value, field));
  }
  assignIfDefined(result, "tagline", readString(body, "tagline", { max: 160 }));
  assignIfDefined(result, "fullDescription", readString(body, "fullDescription", { max: 12_000 }));
  assignIfDefined(result, "additionalInfo", readString(body, "additionalInfo", { max: 6_000 }));
  assignIfDefined(result, "commercialText", readString(body, "commercialText", { max: 6_000 }));
  assignIfDefined(result, "seoTitle", readString(body, "seoTitle", { max: 70 }));
  assignIfDefined(result, "seoDescription", readString(body, "seoDescription", { max: 180 }));
  assignIfDefined(result, "screenshots", readStringArray(body, "screenshots", { maxItems: 12, urls: true }));
  assignIfDefined(result, "features", readStringArray(body, "features", { maxItems: 30, maxLength: 240 }));
  assignIfDefined(result, "requirements", readStringArray(body, "requirements", { maxItems: 30, maxLength: 240 }));
  assignIfDefined(result, "status", readEnum(body, "status", ["active", "inactive"]));
  assignIfDefined(result, "publicCatalog", readBoolean(body, "publicCatalog"));
  assignIfDefined(result, "featured", readBoolean(body, "featured"));
  assignIfDefined(result, "featuredOrder", readNumber(body, "featuredOrder", { integer: true, min: 0, max: 100_000 }));
  assignIfDefined(result, "catalogOrder", readNumber(body, "catalogOrder", { integer: true, min: 0, max: 100_000 }));
  assignIfDefined(result, "displayOrder", readNumber(body, "displayOrder", { integer: true, min: 0, max: 100_000 }));
  assignIfDefined(result, "trialEnabled", readBoolean(body, "trialEnabled"));
  assignIfDefined(result, "trialDays", readNumber(body, "trialDays", { integer: true, min: 0, max: 3650 }));
  assignIfDefined(result, "trialValidationHours", readNumber(body, "trialValidationHours", { integer: true, min: 1, max: 8760 }));
  assignIfDefined(result, "trialOfflineHours", readNumber(body, "trialOfflineHours", { integer: true, min: 0, max: 8760 }));
  assignIfDefined(result, "offlineDays", readNumber(body, "offlineDays", { integer: true, min: 0, max: 3650 }));
  assignIfDefined(result, "validationHours", readNumber(body, "validationHours", { integer: true, min: 1, max: 8760 }));

  if ("allowedOrigins" in body) result.allowedOrigins = validateOrigins(body.allowedOrigins);
  return result;
}

export function validatePlanPayload(body, { partial = false } = {}) {
  const allowed = new Set([
    "name", "description", "price", "durationDays", "lifetime",
    "deviceLimit", "startMode", "active", "publicCatalog", "publishedInCatalog",
    "commercialDescription", "termsVersion", "catalogOrder", "displayOrder"
  ]);
  allowFields(body, allowed);

  const result = {};
  assignIfDefined(result, "name", readString(body, "name", { required: !partial, min: 1, max: 80 }));
  assignIfDefined(result, "description", readString(body, "description", { max: 1000 }));
  assignIfDefined(result, "price", readNumber(body, "price", { min: 0, max: 10_000_000 }));
  assignIfDefined(result, "durationDays", readNumber(body, "durationDays", { integer: true, min: 0, max: 36500 }));
  assignIfDefined(result, "lifetime", readBoolean(body, "lifetime"));
  assignIfDefined(result, "deviceLimit", readNumber(body, "deviceLimit", { integer: true, min: 1, max: 1000 }));
  assignIfDefined(result, "startMode", readEnum(body, "startMode", ["first_activation", "immediate"]));
  assignIfDefined(result, "active", readBoolean(body, "active"));
  assignIfDefined(result, "publicCatalog", readBoolean(body, "publicCatalog"));
  assignIfDefined(result, "publishedInCatalog", readBoolean(body, "publishedInCatalog"));
  assignIfDefined(result, "commercialDescription", readString(body, "commercialDescription", { max: 2000 }));
  assignIfDefined(result, "termsVersion", readString(body, "termsVersion", { max: 80 }));
  assignIfDefined(result, "catalogOrder", readNumber(body, "catalogOrder", { integer: true, min: 0, max: 100_000 }));
  assignIfDefined(result, "displayOrder", readNumber(body, "displayOrder", { integer: true, min: 0, max: 100_000 }));
  return result;
}

export function validateCustomerProfilePayload(body) {
  const allowed = new Set([
    "displayName", "taxId", "phone", "postalCode", "street", "number",
    "complement", "neighborhood", "city", "state", "photoUrl", "photoStoragePath"
  ]);
  allowFields(body, allowed);
  const result = {};
  assignIfDefined(result, "displayName", readString(body, "displayName", { min: 2, max: 120 }));
  const taxId = readString(body, "taxId", { max: 18 });
  if (taxId !== undefined) {
    if (!isValidCpf(taxId)) fail("Informe um CPF válido.", 400, "invalid_cpf");
    result.taxId = digits(taxId);
  }
  const phone = readString(body, "phone", { max: 20 });
  if (phone !== undefined) {
    const normalized = digits(phone);
    const national = normalized.startsWith("55") && normalized.length >= 12 ? normalized.slice(2) : normalized;
    if (!/^\d{10,11}$/.test(national)) fail("Informe um telefone brasileiro com DDD.", 400, "invalid_phone");
    result.phone = national;
  }
  const postalCode = readString(body, "postalCode", { max: 10 });
  if (postalCode !== undefined) {
    const normalized = digits(postalCode);
    if (!/^\d{8}$/.test(normalized)) fail("Informe um CEP válido.", 400, "invalid_postal_code");
    result.postalCode = normalized;
  }
  for (const [field, max] of [["street", 160], ["number", 20], ["complement", 100], ["neighborhood", 100], ["city", 100]]) {
    assignIfDefined(result, field, readString(body, field, { max }));
  }
  assignIfDefined(result, "state", readString(body, "state", { max: 2, pattern: /^[A-Za-z]{2}$/, normalize: value => value.toUpperCase() }));
  const photoUrl = readString(body, "photoUrl", { max: 2048 });
  assignIfDefined(result, "photoUrl", validateSecureImageUrl(photoUrl, "photoUrl"));
  assignIfDefined(result, "photoStoragePath", readString(body, "photoStoragePath", { max: 300, pattern: /^profiles\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/ }));
  return result;
}

export function validateCartPayload(body) {
  allowFields(body, new Set(["items"]));
  if (!Array.isArray(body.items) || body.items.length > COMMERCE_LIMITS.maxLines) {
    fail(`O carrinho aceita no máximo ${COMMERCE_LIMITS.maxLines} itens.`);
  }
  const items = body.items.map(item => {
    plainObject(item, "Item do carrinho");
    allowFields(item, new Set(["projectId", "planId", "quantity"]));
    const projectId = assertProjectId(readString(item, "projectId", { required: true, max: 128 }));
    const planId = assertEntityId("plans", readString(item, "planId", { required: true, max: 128 }));
    const quantity = readNumber(item, "quantity", { integer: true, min: 1, max: COMMERCE_LIMITS.maxQuantityPerLine });
    return { projectId, planId, quantity };
  });
  if (items.reduce((sum, item) => sum + item.quantity, 0) > COMMERCE_LIMITS.maxUnits) {
    fail(`O carrinho aceita no máximo ${COMMERCE_LIMITS.maxUnits} licenças.`);
  }
  return { items };
}

export function validateMediaPayload(body, { maxBytes = 5 * 1024 * 1024, allowKind = false } = {}) {
  const allowed = new Set(["fileName", "contentType", "dataBase64", ...(allowKind ? ["kind"] : [])]);
  allowFields(body, allowed);
  const contentType = readEnum(body, "contentType", ["image/jpeg", "image/png", "image/webp"]);
  const fileName = readString(body, "fileName", { required: true, max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ });
  const dataBase64 = readString(body, "dataBase64", { required: true, max: Math.ceil(maxBytes * 4 / 3) + 16 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) fail("Conteúdo base64 inválido.");
  const byteLength = Math.floor(dataBase64.length * 3 / 4) - (dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0);
  if (byteLength < 1 || byteLength > maxBytes) fail("Arquivo excede o tamanho permitido.", 413, "payload_too_large");
  const extension = fileName.split(".").pop().toLowerCase();
  const allowedExtensions = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"]
  };
  if (!allowedExtensions[contentType].includes(extension)) fail("A extensão do arquivo não corresponde ao tipo informado.", 400, "invalid_media_type");
  let signature;
  try {
    signature = Uint8Array.from(atob(dataBase64.slice(0, 24)), character => character.charCodeAt(0));
  } catch {
    fail("Conteúdo base64 inválido.");
  }
  const validSignature = contentType === "image/jpeg"
    ? signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
    : contentType === "image/png"
      ? signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47
      : String.fromCharCode(...signature.slice(0, 4)) === "RIFF" && String.fromCharCode(...signature.slice(8, 12)) === "WEBP";
  if (!validSignature) fail("O conteúdo do arquivo não corresponde ao tipo informado.", 400, "invalid_media_type");
  const result = { fileName, contentType, dataBase64, byteLength };
  if (allowKind) result.kind = readEnum(body, "kind", ["logo", "icon", "banner", "screenshot"]);
  return result;
}

export function validateCustomerPayload(body, { partial = false } = {}) {
  const allowed = new Set(["name", "email", "phone", "notes", "status"]);
  allowFields(body, allowed);

  const result = {};
  assignIfDefined(result, "name", readString(body, "name", { required: !partial, min: 1, max: 120 }));

  const email = readString(body, "email", { required: !partial, max: 160 });
  if (email !== undefined) result.email = validateEmail(email);

  assignIfDefined(result, "phone", readString(body, "phone", { max: 32 }));
  assignIfDefined(result, "notes", readString(body, "notes", { max: 2000 }));
  assignIfDefined(result, "status", readEnum(body, "status", ["active", "inactive"]));
  return result;
}

export function validateLicenseCreatePayload(body) {
  const allowed = new Set([
    "customerId", "planId", "planName", "durationDays", "lifetime",
    "maxDevices", "startMode", "notes", "idempotencyKey", "source", "externalOrderId"
  ]);
  allowFields(body, allowed);

  const result = {};
  const customerId = readString(body, "customerId", { required: true, max: 128 });
  result.customerId = assertEntityId("customers", customerId);

  const planId = readString(body, "planId", { max: 128 });
  if (planId) result.planId = assertEntityId("plans", planId);

  assignIfDefined(result, "planName", readString(body, "planName", { max: 120 }));
  assignIfDefined(result, "durationDays", readNumber(body, "durationDays", { integer: true, min: 1, max: 36500 }));
  assignIfDefined(result, "lifetime", readBoolean(body, "lifetime"));
  assignIfDefined(result, "maxDevices", readNumber(body, "maxDevices", { integer: true, min: 1, max: 1000 }));
  assignIfDefined(result, "startMode", readEnum(body, "startMode", ["first_activation", "immediate"]));
  assignIfDefined(result, "notes", readString(body, "notes", { max: 2000 }));
  assignIfDefined(result, "idempotencyKey", readString(body, "idempotencyKey", { max: 160 }));
  assignIfDefined(result, "source", readString(body, "source", {
    max: 40,
    pattern: /^[A-Za-z0-9._-]+$/
  }));
  assignIfDefined(result, "externalOrderId", readString(body, "externalOrderId", { max: 160 }));
  return result;
}

export function validateLicenseActionPayload(action, body) {
  plainObject(body);
  if (action === "renew") {
    allowFields(body, new Set(["days", "lifetime"]));
    const result = {};
    assignIfDefined(result, "days", readNumber(body, "days", { integer: true, min: 1, max: 36500 }));
    assignIfDefined(result, "lifetime", readBoolean(body, "lifetime"));
    if (result.days === undefined && result.lifetime !== true) {
      fail("Informe days ou lifetime=true para renovar.", 400, "invalid_renewal");
    }
    return result;
  }

  if (action === "revoke") {
    allowFields(body, new Set(["reason"]));
    const reason = readString(body, "reason", { max: 500 });
    return reason === undefined ? {} : { reason };
  }

  if (["suspend", "reactivate"].includes(action)) {
    allowFields(body, new Set());
    return {};
  }

  fail("Ação de licença inválida.");
}

export function validateAdminPayload(body, { partial = false } = {}) {
  const allowed = new Set(["name", "email", "status", "allProjects", "projectIds", "permissions"]);
  allowFields(body, allowed);

  const result = {};
  assignIfDefined(result, "name", readString(body, "name", { max: 120 }));

  const email = readString(body, "email", { required: !partial, max: 160 });
  if (email !== undefined) result.email = validateEmail(email);

  assignIfDefined(result, "status", readEnum(body, "status", ["active", "inactive"]));
  assignIfDefined(result, "allProjects", readBoolean(body, "allProjects"));

  if ("projectIds" in body) {
    if (!Array.isArray(body.projectIds) || body.projectIds.length > 100) {
      fail("projectIds deve ser uma lista com no máximo 100 projetos.");
    }
    result.projectIds = [...new Set(body.projectIds.map(value => {
      if (typeof value !== "string") fail("Cada projectId deve ser texto.");
      return assertProjectId(value);
    }))];
  }

  if ("permissions" in body) {
    plainObject(body.permissions, "permissions");
    const unknown = Object.keys(body.permissions).filter(key => !ADMIN_PERMISSION_KEYS.has(key));
    if (unknown.length) {
      fail("Permissão administrativa desconhecida.", 400, "invalid_request", { permissions: unknown });
    }

    result.permissions = {};
    for (const [key, value] of Object.entries(body.permissions)) {
      if (typeof value !== "boolean") fail(`A permissão ${key} deve ser booleana.`);
      result.permissions[key] = value;
    }
  }

  return result;
}

export function validatePublicProjectPayload(body) {
  allowFields(body, new Set(["projectId", "integrationCode"]));
  return selectorFields(body);
}

export function validatePublicLicensePayload(body) {
  allowFields(body, new Set([
    "projectId", "integrationCode", "licenseKey", "deviceId",
    "deviceName", "platform", "appVersion", "requestId"
  ]));

  const result = selectorFields(body);
  result.licenseKey = readString(body, "licenseKey", {
    required: true,
    max: 64,
    normalize: value => value.toUpperCase(),
    pattern: /^[A-Z0-9]{1,8}(?:-[A-Z0-9]{5}){4}$/
  });
  result.deviceId = readString(body, "deviceId", { required: true, max: 256 });
  assignIfDefined(result, "deviceName", readString(body, "deviceName", { max: 120 }));
  assignIfDefined(result, "platform", readString(body, "platform", { max: 64 }));
  assignIfDefined(result, "appVersion", readString(body, "appVersion", { max: 64 }));
  assignIfDefined(result, "requestId", readString(body, "requestId", {
    max: 80,
    pattern: /^[A-Za-z0-9._:-]+$/
  }));
  return result;
}

export function validatePublicTrialPayload(body) {
  allowFields(body, new Set([
    "projectId", "integrationCode", "deviceId", "deviceName", "platform", "appVersion", "requestId"
  ]));

  const result = selectorFields(body);
  result.deviceId = readString(body, "deviceId", { required: true, max: 256 });
  assignIfDefined(result, "deviceName", readString(body, "deviceName", { max: 120 }));
  assignIfDefined(result, "platform", readString(body, "platform", { max: 64 }));
  assignIfDefined(result, "appVersion", readString(body, "appVersion", { max: 64 }));
  assignIfDefined(result, "requestId", readString(body, "requestId", {
    max: 80,
    pattern: /^[A-Za-z0-9._:-]+$/
  }));
  return result;
}

export function validateOrderCreatePayload(body) {
  allowFields(body, new Set(["items", "idempotencyKey"]));
  const idempotencyKey = readString(body, "idempotencyKey", {
    required: true,
    min: 8,
    max: 160,
    pattern: /^[A-Za-z0-9._:-]+$/
  });
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > COMMERCE_LIMITS.maxLines) {
    fail(`items deve conter entre 1 e ${COMMERCE_LIMITS.maxLines} linhas.`);
  }

  let units = 0;
  const items = body.items.map((item, index) => {
    plainObject(item, `items[${index}]`);
    allowFields(item, new Set(["projectId", "planId", "quantity"]));
    const projectId = assertProjectId(readString(item, "projectId", { required: true, max: 128 }));
    const planId = assertEntityId("plans", readString(item, "planId", { required: true, max: 128 }));
    const quantity = readNumber(item, "quantity", {
      integer: true,
      min: 1,
      max: COMMERCE_LIMITS.maxQuantityPerLine
    });
    if (quantity === undefined) fail(`O campo items[${index}].quantity é obrigatório.`);
    units += quantity;
    return { type: "new_license", projectId, planId, quantity };
  });
  if (units > COMMERCE_LIMITS.maxUnits) fail(`O pedido aceita no máximo ${COMMERCE_LIMITS.maxUnits} licenças.`);
  return { items, idempotencyKey };
}

export function validateRenewalOrderPayload(body) {
  allowFields(body, new Set(["planId", "idempotencyKey"]));
  return {
    planId: assertEntityId("plans", readString(body, "planId", { required: true, max: 128 })),
    idempotencyKey: readString(body, "idempotencyKey", {
      required: true,
      min: 8,
      max: 160,
      pattern: /^[A-Za-z0-9._:-]+$/
    })
  };
}

export function validatePaymentCreatePayload(body) {
  allowFields(body, new Set(["method", "idempotencyKey"]));
  const method = readEnum(body, "method", ["pix"]);
  if (!method) fail("O campo method é obrigatório.");
  return {
    method,
    idempotencyKey: readString(body, "idempotencyKey", {
      required: true,
      min: 8,
      max: 160,
      pattern: /^[A-Za-z0-9._:-]+$/
    })
  };
}

export function validatePaymentReconcilePayload(body) {
  allowFields(body, new Set(["providerOrderId"]));
  return {
    providerOrderId: readString(body, "providerOrderId", {
      max: 80,
      pattern: /^ORDE_[A-Za-z0-9-]+$/
    })
  };
}
