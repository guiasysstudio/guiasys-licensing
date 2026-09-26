// GuiaSys Licensing API — deploy automático via Cloudflare Workers Builds
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5500",
  "http://localhost:5501",
  "https://guiasysstudio.github.io"
];

const ENTITY_NAMES = new Set([
  "plans",
  "customers",
  "licenses",
  "devices",
  "activations",
  "logs"
]);

let googleTokenCache = { token: null, expiresAt: 0 };
let firebaseKeyCache = { keys: null, expiresAt: 0 };

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin)
    }
  });
}

function errorResponse(origin, status, error, message, details = null) {
  return json({ ok: false, error, message, ...(details ? { details } : {}) }, status, origin);
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    throw Object.assign(new Error("O corpo da requisição deve ser JSON."), { status: 415 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("JSON inválido."), { status: 400 });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizePrefix(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function normalizeLicenseKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").trim();
}

function generateLicenseKey(prefix = "GSS") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);

  const groups = [];
  for (let g = 0; g < 4; g++) {
    let part = "";
    for (let i = 0; i < 5; i++) {
      part += alphabet[bytes[g * 5 + i] % alphabet.length];
    }
    groups.push(part);
  }

  return `${normalizePrefix(prefix) || "GSS"}-${groups.join("-")}`;
}

function plusDays(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function isPast(iso) {
  return Boolean(iso && new Date(iso).getTime() <= Date.now());
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(value)));
}

function base64UrlEncode(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getFirebasePublicKeys() {
  if (firebaseKeyCache.keys && firebaseKeyCache.expiresAt > Date.now()) {
    return firebaseKeyCache.keys;
  }

  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );

  if (!response.ok) throw new Error("Não foi possível obter as chaves públicas do Firebase.");

  const data = await response.json();
  if (!Array.isArray(data.keys)) throw new Error("Resposta inválida das chaves públicas do Firebase.");

  firebaseKeyCache = {
    keys: data.keys,
    expiresAt: Date.now() + 55 * 60 * 1000
  };

  return data.keys;
}

async function verifyFirebaseIdToken(idToken, env) {
  if (!idToken) throw new Error("Token Firebase não informado.");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Token Firebase inválido.");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) throw new Error("Cabeçalho do token Firebase inválido.");

  const keys = await getFirebasePublicKeys();
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) throw new Error("Chave pública correspondente ao token não encontrada.");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    base64UrlToUint8Array(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  if (!valid) throw new Error("Assinatura do token Firebase inválida.");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== env.FIREBASE_PROJECT_ID) throw new Error("Token destinado a outro projeto Firebase.");
  if (payload.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) {
    throw new Error("Emissor do token Firebase inválido.");
  }
  if (!payload.sub) throw new Error("UID ausente no token Firebase.");
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("Token Firebase expirado.");
  if (typeof payload.iat !== "number" || payload.iat > now + 300) throw new Error("Data de emissão do token inválida.");

  return payload;
}

function bearerToken(request) {
  return request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requireAdmin(request, env) {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, error: "authentication_required", message: "Autenticação Firebase obrigatória." };
  }

  try {
    const user = await verifyFirebaseIdToken(token, env);
    if (user.sub !== env.ADMIN_FIREBASE_UID) {
      return { ok: false, status: 403, error: "admin_required", message: "Esta conta não possui acesso administrativo." };
    }

    return {
      ok: true,
      user: {
        uid: user.sub,
        email: user.email || null,
        name: user.name || null,
        emailVerified: Boolean(user.email_verified)
      }
    };
  } catch (error) {
    return { ok: false, status: 401, error: "invalid_token", message: error.message };
  }
}

async function getGoogleAccessToken(env) {
  if (googleTokenCache.token && googleTokenCache.expiresAt > Date.now() + 60_000) {
    return googleTokenCache.token;
  }

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedToken}.${base64UrlEncode(signature)}`
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao obter token Google: ${data.error_description || data.error || response.status}`);
  }

  googleTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  };

  return data.access_token;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") return { mapValue: { fields: toFirestoreFields(value) } };
  return { stringValue: String(value) };
}

function toFirestoreFields(object) {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, toFirestoreValue(value)])
  );
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

function docIdFromName(name) {
  return decodeURIComponent(String(name || "").split("/").pop() || "");
}

async function firestoreRequest(env, path, options = {}) {
  const token = await getGoogleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  if (response.status === 404) return null;

  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || `Firestore respondeu ${response.status}`), {
      status: response.status,
      firestore: data
    });
  }

  return data;
}

async function getDoc(env, path) {
  const data = await firestoreRequest(env, path);
  if (!data) return null;
  return { id: docIdFromName(data.name), ...fromFirestoreFields(data.fields || {}) };
}

async function setDoc(env, path, value) {
  const data = await firestoreRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFirestoreFields(value) })
  });
  return { id: docIdFromName(data.name), ...fromFirestoreFields(data.fields || {}) };
}

async function deleteDoc(env, path) {
  const token = await getGoogleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${path}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (![200, 204, 404].includes(response.status)) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || `Falha ao excluir documento: ${response.status}`);
  }
}

async function listCollection(env, path) {
  const token = await getGoogleAccessToken(env);
  let pageToken = "";
  const result = [];

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${path}`
    );
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });

    if (response.status === 404) return [];

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Firestore respondeu ${response.status}`);

    for (const doc of data.documents || []) {
      result.push({ id: docIdFromName(doc.name), ...fromFirestoreFields(doc.fields || {}) });
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return result;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function writeLog(env, projectId, action, details = {}, actor = "admin") {
  const id = randomId("log");
  await setDoc(env, `projects/${projectId}/logs/${id}`, {
    action,
    actor,
    details,
    createdAt: nowIso()
  });
}

function projectPath(projectId) {
  return `projects/${projectId}`;
}

function entityPath(projectId, entity) {
  return `projects/${projectId}/${entity}`;
}

function normalizeLicenseStatus(license) {
  if (license.status === "active" && license.expiresAt && isPast(license.expiresAt)) {
    return { ...license, status: "expired" };
  }
  return license;
}

async function findLicenseByKey(env, projectId, licenseKey) {
  const normalizedKey = normalizeLicenseKey(licenseKey);
  if (!normalizedKey) return null;

  const lookupId = await sha256Hex(normalizedKey);
  const lookup = await getDoc(env, `projects/${projectId}/licenseKeys/${lookupId}`);
  if (!lookup?.licenseId) return null;

  const license = await getDoc(env, `projects/${projectId}/licenses/${lookup.licenseId}`);
  return license ? normalizeLicenseStatus(license) : null;
}

async function projectExists(env, projectId) {
  return Boolean(await getDoc(env, projectPath(projectId)));
}

async function createProject(env, body, admin) {
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("Informe o nome do projeto."), { status: 400 });

  const id = randomId("prj");
  const createdAt = nowIso();
  const project = {
    name,
    slug: slugify(body.slug || name) || id,
    prefix: normalizePrefix(body.prefix || name.slice(0, 4)) || "GSS",
    description: String(body.description || "").trim(),
    status: body.status === "inactive" ? "inactive" : "active",
    trialDays: Math.max(0, Number(body.trialDays || 0)),
    offlineDays: Math.max(0, Number(body.offlineDays || 7)),
    validationHours: Math.max(1, Number(body.validationHours || 24)),
    createdAt,
    updatedAt: createdAt
  };

  const saved = await setDoc(env, projectPath(id), project);
  await writeLog(env, id, "project.created", { name: saved.name }, admin.email || admin.uid);
  return saved;
}

async function createPlan(env, projectId, body, admin) {
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("Informe o nome do plano."), { status: 400 });

  const id = randomId("plan");
  const createdAt = nowIso();
  const lifetime = Boolean(body.lifetime);

  const plan = {
    name,
    description: String(body.description || "").trim(),
    price: Math.max(0, Number(body.price || 0)),
    durationDays: lifetime ? 0 : Math.max(1, Number(body.durationDays || 30)),
    lifetime,
    deviceLimit: Math.max(1, Number(body.deviceLimit || 1)),
    active: body.active !== false,
    createdAt,
    updatedAt: createdAt
  };

  const saved = await setDoc(env, `${entityPath(projectId, "plans")}/${id}`, plan);
  await writeLog(env, projectId, "plan.created", { planId: id, name }, admin.email || admin.uid);
  return saved;
}

async function createCustomer(env, projectId, body, admin) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!name || !email) throw Object.assign(new Error("Informe nome e e-mail do cliente."), { status: 400 });

  const id = randomId("cus");
  const createdAt = nowIso();
  const customer = {
    name,
    email,
    phone: String(body.phone || "").trim(),
    notes: String(body.notes || "").trim(),
    status: body.status === "inactive" ? "inactive" : "active",
    createdAt,
    updatedAt: createdAt
  };

  const saved = await setDoc(env, `${entityPath(projectId, "customers")}/${id}`, customer);
  await writeLog(env, projectId, "customer.created", { customerId: id, name, email }, admin.email || admin.uid);
  return saved;
}

async function createLicense(env, projectId, body, admin) {
  const customerId = String(body.customerId || "");
  if (!customerId) throw Object.assign(new Error("Selecione um cliente."), { status: 400 });

  const customer = await getDoc(env, `${entityPath(projectId, "customers")}/${customerId}`);
  if (!customer) throw Object.assign(new Error("Cliente não encontrado."), { status: 404 });

  const project = await getDoc(env, projectPath(projectId));
  if (!project) throw Object.assign(new Error("Projeto não encontrado."), { status: 404 });

  let plan = null;
  if (body.planId) {
    plan = await getDoc(env, `${entityPath(projectId, "plans")}/${body.planId}`);
    if (!plan) throw Object.assign(new Error("Plano não encontrado."), { status: 404 });
  }

  const id = randomId("lic");
  const createdAt = nowIso();
  const lifetime = body.lifetime != null ? Boolean(body.lifetime) : Boolean(plan?.lifetime);
  const durationDays = lifetime
    ? 0
    : Math.max(1, Number(body.durationDays || plan?.durationDays || 30));
  const maxDevices = Math.max(1, Number(body.maxDevices || plan?.deviceLimit || 1));
  const startMode = ["first_activation", "immediate"].includes(body.startMode)
    ? body.startMode
    : "first_activation";
  const key = generateLicenseKey(project.prefix);

  let activatedAt = null;
  let expiresAt = null;
  let status = "pending";

  if (startMode === "immediate") {
    activatedAt = createdAt;
    expiresAt = lifetime ? null : plusDays(createdAt, durationDays);
    status = "active";
  }

  const license = {
    key,
    customerId,
    customerName: customer.name,
    customerEmail: customer.email,
    planId: plan?.id || "",
    planName: plan?.name || String(body.planName || "Personalizada"),
    durationDays,
    lifetime,
    maxDevices,
    startMode,
    status,
    activatedAt,
    expiresAt,
    notes: String(body.notes || "").trim(),
    createdAt,
    updatedAt: createdAt
  };

  const saved = await setDoc(env, `${entityPath(projectId, "licenses")}/${id}`, license);
  const lookupId = await sha256Hex(normalizeLicenseKey(key));
  await setDoc(env, `projects/${projectId}/licenseKeys/${lookupId}`, {
    licenseId: id,
    createdAt
  });

  await writeLog(env, projectId, "license.created", {
    licenseId: id,
    customerId,
    planId: plan?.id || null,
    lifetime,
    durationDays,
    maxDevices
  }, admin.email || admin.uid);

  return saved;
}

async function updateEntity(env, projectId, entity, id, body, admin) {
  const path = `${entityPath(projectId, entity)}/${id}`;
  const current = await getDoc(env, path);
  if (!current) throw Object.assign(new Error("Registro não encontrado."), { status: 404 });

  const protectedFields = new Set(["id", "createdAt", "key", "customerId"]);
  const clean = Object.fromEntries(
    Object.entries(body).filter(([key]) => !protectedFields.has(key))
  );

  if (entity === "plans") {
    if ("price" in clean) clean.price = Math.max(0, Number(clean.price || 0));
    if ("durationDays" in clean) clean.durationDays = Math.max(1, Number(clean.durationDays || 1));
    if ("deviceLimit" in clean) clean.deviceLimit = Math.max(1, Number(clean.deviceLimit || 1));
    if (clean.lifetime) clean.durationDays = 0;
  }

  if (entity === "projects") {
    if ("prefix" in clean) clean.prefix = normalizePrefix(clean.prefix);
    if ("slug" in clean) clean.slug = slugify(clean.slug);
  }

  const saved = await setDoc(env, path, { ...current, ...clean, updatedAt: nowIso() });
  await writeLog(env, projectId, `${entity.slice(0, -1)}.updated`, { id }, admin.email || admin.uid);
  return saved;
}

async function licenseAction(env, projectId, licenseId, action, body, admin) {
  const path = `${entityPath(projectId, "licenses")}/${licenseId}`;
  const current = await getDoc(env, path);
  if (!current) throw Object.assign(new Error("Licença não encontrada."), { status: 404 });

  const now = nowIso();
  let next = { ...current, updatedAt: now };

  if (action === "revoke") {
    next.status = "revoked";
    next.revokedAt = now;
    next.revocationReason = String(body.reason || "").trim();
  } else if (action === "suspend") {
    next.status = "suspended";
    next.suspendedAt = now;
  } else if (action === "reactivate") {
    next.status = current.activatedAt ? "active" : "pending";
    next.suspendedAt = null;
    next.revokedAt = null;
    next.revocationReason = "";
  } else if (action === "renew") {
    const days = Math.max(1, Number(body.days || current.durationDays || 30));
    next.lifetime = Boolean(body.lifetime ?? current.lifetime);

    if (next.lifetime) {
      next.expiresAt = null;
      if (next.status === "expired") next.status = "active";
    } else {
      const base = current.expiresAt && !isPast(current.expiresAt) ? current.expiresAt : now;
      next.expiresAt = plusDays(base, days);
      next.durationDays = days;
      if (["expired", "pending"].includes(next.status) && next.activatedAt) next.status = "active";
    }
  } else {
    throw Object.assign(new Error("Ação de licença inválida."), { status: 400 });
  }

  const saved = await setDoc(env, path, next);
  await writeLog(env, projectId, `license.${action}`, { licenseId, ...body }, admin.email || admin.uid);
  return normalizeLicenseStatus(saved);
}

function todayInBrazil(iso = nowIso()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(iso));
}

async function dashboard(env, projectId = "") {
  const projects = projectId
    ? [await getDoc(env, projectPath(projectId))].filter(Boolean)
    : await listCollection(env, "projects");

  let activeLicenses = 0;
  let pendingLicenses = 0;
  let expiring = 0;
  let activationsToday = 0;
  const recentLogs = [];
  const now = Date.now();
  const in30Days = now + 30 * 86400000;
  const today = todayInBrazil();

  for (const project of projects) {
    const [licenses, activations, logs] = await Promise.all([
      listCollection(env, `projects/${project.id}/licenses`),
      listCollection(env, `projects/${project.id}/activations`),
      listCollection(env, `projects/${project.id}/logs`)
    ]);

    for (const item of licenses.map(normalizeLicenseStatus)) {
      if (item.status === "active") activeLicenses++;
      if (item.status === "pending") pendingLicenses++;
      if (item.status === "active" && item.expiresAt) {
        const expires = new Date(item.expiresAt).getTime();
        if (expires > now && expires <= in30Days) expiring++;
      }
    }

    activationsToday += activations.filter(item => todayInBrazil(item.createdAt) === today).length;

    recentLogs.push(
      ...logs.map(log => ({
        ...log,
        projectId: project.id,
        projectName: project.name
      }))
    );
  }

  recentLogs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    projectsActive: projects.filter(project => project.status === "active").length,
    projectsTotal: projects.length,
    activeLicenses,
    pendingLicenses,
    activationsToday,
    expiring30Days: expiring,
    recentLogs: recentLogs.slice(0, 12)
  };
}

async function publicActivate(env, body) {
  const projectId = String(body.projectId || "");
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!projectId || !licenseKey || !deviceId) {
    throw Object.assign(new Error("projectId, licenseKey e deviceId são obrigatórios."), { status: 400 });
  }

  const project = await getDoc(env, projectPath(projectId));
  if (!project || project.status !== "active") {
    throw Object.assign(new Error("Projeto inválido ou inativo."), { status: 404 });
  }

  let license = await findLicenseByKey(env, projectId, licenseKey);
  if (!license) throw Object.assign(new Error("Licença inválida."), { status: 404 });

  if (["revoked", "suspended", "expired"].includes(license.status)) {
    throw Object.assign(new Error(`Licença ${license.status}.`), { status: 403, reason: license.status });
  }

  const deviceHash = await sha256Hex(deviceId);
  const devicePath = `projects/${projectId}/devices/${deviceHash}`;
  const existingDevice = await getDoc(env, devicePath);
  const devices = await listCollection(env, `projects/${projectId}/devices`);
  const activeDevices = devices.filter(device => device.licenseId === license.id && device.active !== false);

  if (!existingDevice?.active && activeDevices.length >= Number(license.maxDevices || 1)) {
    throw Object.assign(new Error("Limite de dispositivos atingido."), { status: 409, reason: "device_limit" });
  }

  const now = nowIso();
  if (license.status === "pending") {
    license = {
      ...license,
      status: "active",
      activatedAt: now,
      expiresAt: license.lifetime ? null : plusDays(now, license.durationDays),
      updatedAt: now
    };
    await setDoc(env, `projects/${projectId}/licenses/${license.id}`, license);
  }

  if (license.expiresAt && isPast(license.expiresAt)) {
    await setDoc(env, `projects/${projectId}/licenses/${license.id}`, {
      ...license,
      status: "expired",
      updatedAt: now
    });
    throw Object.assign(new Error("Licença expirada."), { status: 403, reason: "expired" });
  }

  await setDoc(env, devicePath, {
    licenseId: license.id,
    customerId: license.customerId,
    deviceHash,
    name: String(body.deviceName || "Dispositivo").trim(),
    platform: String(body.platform || "").trim(),
    appVersion: String(body.appVersion || "").trim(),
    active: true,
    firstActivatedAt: existingDevice?.firstActivatedAt || now,
    lastSeenAt: now,
    updatedAt: now
  });

  const activationId = randomId("act");
  await setDoc(env, `projects/${projectId}/activations/${activationId}`, {
    licenseId: license.id,
    customerId: license.customerId,
    deviceHash,
    type: existingDevice?.active ? "revalidate" : "activate",
    createdAt: now
  });

  await writeLog(env, projectId, "license.activated", {
    licenseId: license.id,
    deviceHash
  }, "api");

  return {
    valid: true,
    projectId,
    licenseId: license.id,
    status: "active",
    planName: license.planName,
    customerName: license.customerName,
    expiresAt: license.expiresAt,
    lifetime: Boolean(license.lifetime),
    maxDevices: Number(license.maxDevices || 1),
    activeDevices: existingDevice?.active ? activeDevices.length : activeDevices.length + 1,
    offlineDays: Number(project.offlineDays || 0),
    validationHours: Number(project.validationHours || 24),
    serverTime: now
  };
}

async function publicValidate(env, body) {
  const projectId = String(body.projectId || "");
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!projectId || !licenseKey || !deviceId) {
    throw Object.assign(new Error("projectId, licenseKey e deviceId são obrigatórios."), { status: 400 });
  }

  const project = await getDoc(env, projectPath(projectId));
  if (!project || project.status !== "active") {
    throw Object.assign(new Error("Projeto inválido ou inativo."), { status: 404 });
  }

  const license = await findLicenseByKey(env, projectId, licenseKey);
  if (!license) throw Object.assign(new Error("Licença inválida."), { status: 404 });

  if (["revoked", "suspended", "expired", "pending"].includes(license.status)) {
    throw Object.assign(new Error(`Licença ${license.status}.`), { status: 403, reason: license.status });
  }

  const deviceHash = await sha256Hex(deviceId);
  const device = await getDoc(env, `projects/${projectId}/devices/${deviceHash}`);
  if (!device || device.licenseId !== license.id || device.active === false) {
    throw Object.assign(new Error("Dispositivo não autorizado."), { status: 403, reason: "device_not_authorized" });
  }

  const now = nowIso();
  await setDoc(env, `projects/${projectId}/devices/${deviceHash}`, {
    ...device,
    lastSeenAt: now,
    appVersion: String(body.appVersion || device.appVersion || "").trim(),
    updatedAt: now
  });

  return {
    valid: true,
    projectId,
    licenseId: license.id,
    status: "active",
    planName: license.planName,
    expiresAt: license.expiresAt,
    lifetime: Boolean(license.lifetime),
    maxDevices: Number(license.maxDevices || 1),
    offlineDays: Number(project.offlineDays || 0),
    validationHours: Number(project.validationHours || 24),
    serverTime: now
  };
}

async function publicDeactivate(env, body) {
  const projectId = String(body.projectId || "");
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!projectId || !licenseKey || !deviceId) {
    throw Object.assign(new Error("projectId, licenseKey e deviceId são obrigatórios."), { status: 400 });
  }

  const license = await findLicenseByKey(env, projectId, licenseKey);
  if (!license) throw Object.assign(new Error("Licença inválida."), { status: 404 });

  const deviceHash = await sha256Hex(deviceId);
  const path = `projects/${projectId}/devices/${deviceHash}`;
  const device = await getDoc(env, path);
  if (!device || device.licenseId !== license.id) {
    throw Object.assign(new Error("Dispositivo não encontrado para esta licença."), { status: 404 });
  }

  const now = nowIso();
  await setDoc(env, path, { ...device, active: false, deactivatedAt: now, updatedAt: now });

  const activationId = randomId("act");
  await setDoc(env, `projects/${projectId}/activations/${activationId}`, {
    licenseId: license.id,
    customerId: license.customerId,
    deviceHash,
    type: "deactivate",
    createdAt: now
  });

  await writeLog(env, projectId, "device.deactivated", { licenseId: license.id, deviceHash }, "api");

  return { ok: true, deactivated: true, serverTime: now };
}

async function handleAdmin(request, env, origin, url, admin) {
  const method = request.method;
  const path = url.pathname.replace(/^\/api\/v1\/admin\/?/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts.length === 1 && parts[0] === "me" && method === "GET") {
    return json({ ok: true, authorized: true, administrator: admin }, 200, origin);
  }

  if (parts.length === 1 && parts[0] === "dashboard" && method === "GET") {
    return json({ ok: true, dashboard: await dashboard(env, url.searchParams.get("projectId") || "") }, 200, origin);
  }

  if (parts[0] === "projects") {
    if (parts.length === 1) {
      if (method === "GET") {
        const projects = await listCollection(env, "projects");
        projects.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
        return json({ ok: true, projects }, 200, origin);
      }
      if (method === "POST") {
        return json({ ok: true, project: await createProject(env, await readJson(request), admin) }, 201, origin);
      }
    }

    const projectId = parts[1];
    if (!projectId || !(await projectExists(env, projectId))) {
      return errorResponse(origin, 404, "project_not_found", "Projeto não encontrado.");
    }

    if (parts.length === 2) {
      if (method === "GET") return json({ ok: true, project: await getDoc(env, projectPath(projectId)) }, 200, origin);
      if (method === "PATCH") {
        const current = await getDoc(env, projectPath(projectId));
        const body = await readJson(request);
        const next = {
          ...current,
          ...body,
          name: String(body.name ?? current.name).trim(),
          slug: slugify(body.slug ?? current.slug),
          prefix: normalizePrefix(body.prefix ?? current.prefix),
          trialDays: Math.max(0, Number(body.trialDays ?? current.trialDays ?? 0)),
          offlineDays: Math.max(0, Number(body.offlineDays ?? current.offlineDays ?? 7)),
          validationHours: Math.max(1, Number(body.validationHours ?? current.validationHours ?? 24)),
          createdAt: current.createdAt,
          updatedAt: nowIso()
        };
        const saved = await setDoc(env, projectPath(projectId), next);
        await writeLog(env, projectId, "project.updated", { name: saved.name }, admin.email || admin.uid);
        return json({ ok: true, project: saved }, 200, origin);
      }
      if (method === "DELETE") {
        const current = await getDoc(env, projectPath(projectId));
        const saved = await setDoc(env, projectPath(projectId), {
          ...current,
          status: "archived",
          archivedAt: nowIso(),
          updatedAt: nowIso()
        });
        await writeLog(env, projectId, "project.archived", {}, admin.email || admin.uid);
        return json({ ok: true, project: saved }, 200, origin);
      }
    }

    const entity = parts[2];
    if (!ENTITY_NAMES.has(entity)) {
      return errorResponse(origin, 404, "not_found", "Rota administrativa não encontrada.");
    }

    if (parts.length === 3) {
      if (method === "GET") {
        let items = await listCollection(env, entityPath(projectId, entity));
        if (entity === "licenses") items = items.map(normalizeLicenseStatus);
        items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        return json({ ok: true, [entity]: items }, 200, origin);
      }

      if (method === "POST") {
        const body = await readJson(request);
        if (entity === "plans") return json({ ok: true, plan: await createPlan(env, projectId, body, admin) }, 201, origin);
        if (entity === "customers") return json({ ok: true, customer: await createCustomer(env, projectId, body, admin) }, 201, origin);
        if (entity === "licenses") return json({ ok: true, license: await createLicense(env, projectId, body, admin) }, 201, origin);
        return errorResponse(origin, 405, "method_not_allowed", "Este recurso não permite cadastro manual.");
      }
    }

    const entityId = parts[3];
    if (!entityId) return errorResponse(origin, 404, "not_found", "Registro não informado.");

    if (entity === "licenses" && parts.length === 5 && method === "POST") {
      const action = parts[4];
      const body = await readJson(request).catch(() => ({}));
      return json({ ok: true, license: await licenseAction(env, projectId, entityId, action, body, admin) }, 200, origin);
    }

    if (entity === "devices" && parts.length === 5 && parts[4] === "deactivate" && method === "POST") {
      const path = `${entityPath(projectId, "devices")}/${entityId}`;
      const device = await getDoc(env, path);
      if (!device) return errorResponse(origin, 404, "device_not_found", "Dispositivo não encontrado.");
      const saved = await setDoc(env, path, { ...device, active: false, deactivatedAt: nowIso(), updatedAt: nowIso() });
      await writeLog(env, projectId, "device.deactivated.admin", { deviceId: entityId, licenseId: device.licenseId }, admin.email || admin.uid);
      return json({ ok: true, device: saved }, 200, origin);
    }

    if (parts.length === 4) {
      const path = `${entityPath(projectId, entity)}/${entityId}`;
      if (method === "GET") {
        const item = await getDoc(env, path);
        if (!item) return errorResponse(origin, 404, "not_found", "Registro não encontrado.");
        return json({ ok: true, item: entity === "licenses" ? normalizeLicenseStatus(item) : item }, 200, origin);
      }

      if (method === "PATCH") {
        if (!["plans", "customers"].includes(entity)) {
          return errorResponse(origin, 405, "method_not_allowed", "Use as ações específicas deste recurso.");
        }
        const saved = await updateEntity(env, projectId, entity, entityId, await readJson(request), admin);
        return json({ ok: true, item: saved }, 200, origin);
      }

      if (method === "DELETE") {
        if (!["plans", "customers"].includes(entity)) {
          return errorResponse(origin, 405, "method_not_allowed", "Este recurso não pode ser excluído diretamente.");
        }
        await deleteDoc(env, path);
        await writeLog(env, projectId, `${entity.slice(0, -1)}.deleted`, { id: entityId }, admin.email || admin.uid);
        return json({ ok: true, deleted: true }, 200, origin);
      }
    }
  }

  return errorResponse(origin, 404, "not_found", "Rota administrativa não encontrada.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          name: "GuiaSys Licensing API",
          status: "online",
          version: "1.2.0"
        }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "guiasys-licensing-api",
          version: "1.2.0",
          firebaseProject: env.FIREBASE_PROJECT_ID || null,
          serviceAccountConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON),
          adminConfigured: Boolean(env.ADMIN_FIREBASE_UID)
        }, 200, origin);
      }

      if (url.pathname.startsWith("/api/v1/admin/")) {
        const auth = await requireAdmin(request, env);
        if (!auth.ok) return errorResponse(origin, auth.status, auth.error, auth.message);
        return await handleAdmin(request, env, origin, url, auth.user);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/license/activate") {
        return json({ ok: true, license: await publicActivate(env, await readJson(request)) }, 200, origin);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/license/validate") {
        return json({ ok: true, license: await publicValidate(env, await readJson(request)) }, 200, origin);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/license/deactivate") {
        return json({ ok: true, result: await publicDeactivate(env, await readJson(request)) }, 200, origin);
      }

      return errorResponse(origin, 404, "not_found", "Rota não encontrada.");
    } catch (error) {
      console.error(error);
      return errorResponse(
        origin,
        Number(error.status || 500),
        error.reason || "internal_error",
        error.message || "Erro interno do servidor.",
        error.status >= 500 ? null : error.details || null
      );
    }
  }
};
