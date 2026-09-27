// GuiaSys Licensing API — deploy automático via Cloudflare Workers Builds
const PROTOCOL_VERSION = "GSL-v1";
const API_VERSION = "1.6.0";
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
  "trials",
  "devices",
  "activations",
  "logs"
]);

const DEFAULT_ADMIN_PERMISSIONS = {
  viewDashboard: false,
  manageProjects: false,
  managePlans: false,
  manageCustomers: false,
  manageLicenses: false,
  manageTrial: false,
  viewIntegration: false,
  manageDevices: false,
  viewActivations: false,
  viewLogs: false,
  manageProjectSettings: false,
  managePlatformSettings: false
};

function normalizeAdminPermissions(value = {}) {
  return Object.fromEntries(
    Object.keys(DEFAULT_ADMIN_PERMISSIONS).map(key => [key, Boolean(value?.[key])])
  );
}

function allPermissions() {
  return Object.fromEntries(
    Object.keys(DEFAULT_ADMIN_PERMISSIONS).map(key => [key, true])
  );
}

function can(admin, permission) {
  return Boolean(admin?.master || admin?.permissions?.[permission]);
}

function canAccessProject(admin, projectId) {
  return Boolean(
    admin?.master ||
    admin?.allProjects ||
    (Array.isArray(admin?.projectIds) && admin.projectIds.includes(projectId))
  );
}

function requirePermission(admin, permission, message = "Você não possui permissão para esta operação.") {
  if (!can(admin, permission)) {
    throw Object.assign(new Error(message), { status: 403, reason: "permission_denied" });
  }
}

function requireProjectAccess(admin, projectId) {
  if (!canAccessProject(admin, projectId)) {
    throw Object.assign(new Error("Você não possui acesso a este projeto."), { status: 403, reason: "project_access_denied" });
  }
}

function permissionForEntity(entity) {
  return {
    plans: "managePlans",
    customers: "manageCustomers",
    licenses: "manageLicenses",
    trials: "manageTrial",
    devices: "manageDevices",
    activations: "viewActivations",
    logs: "viewLogs"
  }[entity] || null;
}

let googleTokenCache = { token: null, expiresAt: 0 };
let firebaseKeyCache = { keys: null, expiresAt: 0 };

function corsHeaders(origin, publicCors = false) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (origin && (publicCors || ALLOWED_ORIGINS.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(data, status = 200, origin = "", publicCors = false) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin, publicCors)
    }
  });
}

function errorResponse(origin, status, error, message, details = null, publicCors = false) {
  return json({ ok: false, error, message, ...(details ? { details } : {}) }, status, origin, publicCors);
}

function normalizeAllowedOrigins(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,;]+/);

  const origins = [];
  for (const item of source) {
    const raw = String(item || "").trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const origin = url.origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      // Ignora entradas inválidas; o painel exibe somente as origens normalizadas salvas.
    }
  }

  return origins.slice(0, 30);
}

function assertProjectOrigin(project, origin) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return;

  const allowed = normalizeAllowedOrigins(project.allowedOrigins || []);
  if (!allowed.includes(origin)) {
    throw Object.assign(new Error("Origem web não autorizada para este projeto."), {
      status: 403,
      reason: "origin_not_allowed",
      details: { origin }
    });
  }
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    throw Object.assign(new Error("O corpo da requisição deve ser JSON."), { status: 415, reason: "invalid_request" });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("JSON inválido."), { status: 400, reason: "invalid_request" });
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

function generateIntegrationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let part = "";
    for (let i = 0; i < 4; i++) part += alphabet[bytes[g * 4 + i] % alphabet.length];
    groups.push(part);
  }
  return `GSLI-${groups.join("-")}`;
}

function plusDays(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function plusHours(iso, hours) {
  const date = new Date(iso);
  date.setTime(date.getTime() + Number(hours || 0) * 60 * 60 * 1000);
  return date.toISOString();
}

function earliestIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
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
    const baseUser = {
      uid: user.sub,
      email: user.email || null,
      name: user.name || null,
      picture: user.picture || null,
      emailVerified: Boolean(user.email_verified)
    };

    if (user.sub === env.ADMIN_FIREBASE_UID) {
      return {
        ok: true,
        user: {
          ...baseUser,
          master: true,
          role: "master",
          allProjects: true,
          projectIds: [],
          permissions: allPermissions()
        }
      };
    }

    if (!baseUser.email || !baseUser.emailVerified) {
      return { ok: false, status: 403, error: "admin_required", message: "Esta conta não possui acesso administrativo." };
    }

    const adminId = await sha256Hex(baseUser.email.toLowerCase());
    const record = await getDoc(env, `admins/${adminId}`);

    if (!record || record.status !== "active") {
      return { ok: false, status: 403, error: "admin_required", message: "Esta conta não possui acesso administrativo." };
    }

    return {
      ok: true,
      user: {
        ...baseUser,
        adminId,
        master: false,
        role: "admin",
        allProjects: Boolean(record.allProjects),
        projectIds: Array.isArray(record.projectIds) ? record.projectIds : [],
        permissions: normalizeAdminPermissions(record.permissions)
      }
    };
  } catch (error) {
    if (error?.status === 403) {
      return { ok: false, status: 403, error: "admin_required", message: error.message };
    }
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

async function enforceRateLimit(env, request, bucket, limit, windowSeconds) {
  const forwarded = String(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "")
    .split(",")[0]
    .trim();
  const clientId = forwarded || "unknown";
  const id = await sha256Hex(`${clientId}|${bucket}`);
  const path = `rateLimits/${id}`;
  const now = Date.now();
  const current = await getDoc(env, path);
  const windowStartedMs = current?.windowStartedAt ? new Date(current.windowStartedAt).getTime() : 0;
  const sameWindow = current && Number.isFinite(windowStartedMs) && now - windowStartedMs < windowSeconds * 1000;
  const count = sameWindow ? Number(current.count || 0) : 0;

  if (count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowSeconds * 1000 - (now - windowStartedMs)) / 1000));
    throw Object.assign(new Error("Muitas requisições. Aguarde e tente novamente."), {
      status: 429,
      reason: "rate_limited",
      details: { retryAfterSeconds }
    });
  }

  await setDoc(env, path, {
    bucket,
    clientHash: await sha256Hex(clientId),
    count: count + 1,
    windowStartedAt: sameWindow ? current.windowStartedAt : new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
}

async function ensureProjectSigningKey(env, project) {
  if (!project) return null;

  const signingPath = `projects/${project.id}/internal/signing`;
  let stored = await getDoc(env, signingPath);

  if (stored?.privateJwk && stored?.publicJwk && stored?.keyId) {
    if (project.signingKeyId === stored.keyId && project.signingPublicJwk?.x && project.signingPublicJwk?.y) {
      return project;
    }

    return await setDoc(env, projectPath(project.id), {
      ...project,
      signingKeyId: stored.keyId,
      signingAlgorithm: "ES256",
      signingPublicJwk: stored.publicJwk,
      updatedAt: nowIso()
    });
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const keyId = randomId("sig");
  const createdAt = nowIso();

  stored = await setDoc(env, signingPath, {
    keyId,
    algorithm: "ES256",
    privateJwk,
    publicJwk,
    createdAt,
    updatedAt: createdAt
  });

  return await setDoc(env, projectPath(project.id), {
    ...project,
    signingKeyId: stored.keyId,
    signingAlgorithm: "ES256",
    signingPublicJwk: stored.publicJwk,
    updatedAt: createdAt
  });
}

async function signProjectEntitlement(env, project, claims) {
  project = await ensureProjectSigningKey(env, project);
  const stored = await getDoc(env, `projects/${project.id}/internal/signing`);
  if (!stored?.privateJwk || !stored?.keyId) {
    throw Object.assign(new Error("Material de assinatura indisponível."), { status: 500, reason: "signing_unavailable" });
  }

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    stored.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = base64UrlEncode(JSON.stringify({
    alg: "ES256",
    typ: "GSL-ENT",
    kid: stored.keyId
  }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  return {
    format: "JWS",
    algorithm: "ES256",
    keyId: stored.keyId,
    token: `${signingInput}.${base64UrlEncode(signature)}`
  };
}

async function attachSignedEntitlement(env, project, view, deviceHash) {
  const serverTime = view.serverTime || nowIso();
  const offlineLimit = view.type === "trial"
    ? plusHours(serverTime, Number(view.offlineHours || 0))
    : plusDays(serverTime, Number(view.offlineDays || 0));
  const offlineUntil = earliestIso(view.expiresAt || null, offlineLimit);

  const claims = {
    protocolVersion: PROTOCOL_VERSION,
    type: view.type || "license",
    projectId: project.id,
    integrationCode: project.integrationCode,
    deviceHash,
    status: view.status,
    licenseId: view.licenseId || null,
    planName: view.planName || null,
    lifetime: Boolean(view.lifetime),
    issuedAt: view.issuedAt || null,
    activatedAt: view.activatedAt || null,
    startedAt: view.startedAt || null,
    expiresAt: view.expiresAt || null,
    serverTime,
    offlineUntil
  };

  return {
    ...view,
    offlineUntil,
    entitlement: await signProjectEntitlement(env, project, claims)
  };
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

async function ensureProjectIntegrationCode(env, project) {
  if (!project) return null;

  let next = project;
  let changed = false;
  let integrationCreated = false;

  if (!next.integrationCode) {
    next = { ...next, integrationCode: generateIntegrationCode() };
    changed = true;
    integrationCreated = true;
  }

  const defaults = {
    trialEnabled: Boolean(next.trialEnabled ?? Number(next.trialDays || 0) > 0),
    trialDays: Math.max(0, Number(next.trialDays || 0)),
    trialValidationHours: Math.max(1, Number(next.trialValidationHours || next.validationHours || 24)),
    trialOfflineHours: Math.max(0, Number(next.trialOfflineHours ?? next.trialValidationHours ?? next.validationHours ?? 24)),
    publicCatalog: Boolean(next.publicCatalog),
    allowedOrigins: normalizeAllowedOrigins(next.allowedOrigins || [])
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (JSON.stringify(next[key]) !== JSON.stringify(value)) {
      next = { ...next, [key]: value };
      changed = true;
    }
  }

  if (changed) {
    next = await setDoc(env, projectPath(next.id), { ...next, updatedAt: nowIso() });
  }

  if (integrationCreated) {
    const lookupId = await sha256Hex(next.integrationCode);
    await setDoc(env, `integrationCodes/${lookupId}`, {
      projectId: next.id,
      createdAt: nowIso()
    });
  }

  next = await ensureProjectSigningKey(env, next);
  return next;
}

async function resolvePublicProject(env, body = {}, origin = "") {
  const directProjectId = String(body.projectId || "").trim();
  const integrationCode = String(body.integrationCode || "").trim().toUpperCase();

  let projectId = directProjectId;
  if (!projectId && integrationCode) {
    const lookupId = await sha256Hex(integrationCode);
    const lookup = await getDoc(env, `integrationCodes/${lookupId}`);
    projectId = String(lookup?.projectId || "");
  }

  if (!projectId) {
    throw Object.assign(new Error("Informe projectId ou integrationCode."), { status: 400, reason: "invalid_request" });
  }

  let project = await getDoc(env, projectPath(projectId));
  if (!project) {
    throw Object.assign(new Error("Projeto não encontrado."), { status: 404, reason: "project_not_found" });
  }

  project = await ensureProjectIntegrationCode(env, project);
  if (project.status !== "active") {
    throw Object.assign(new Error("Projeto inativo."), { status: 403, reason: "project_inactive" });
  }

  assertProjectOrigin(project, origin);
  return { projectId: project.id, project };
}

function publicProjectConfigView(project) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: project.id,
    integrationCode: project.integrationCode,
    name: project.name,
    prefix: project.prefix,
    signing: {
      algorithm: project.signingAlgorithm || "ES256",
      keyId: project.signingKeyId,
      publicJwk: project.signingPublicJwk
    },
    trial: {
      enabled: Boolean(project.trialEnabled && Number(project.trialDays || 0) > 0),
      days: Math.max(0, Number(project.trialDays || 0)),
      validationHours: Math.max(1, Number(project.trialValidationHours || project.validationHours || 24)),
      offlineHours: Math.max(0, Number(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24))
    },
    license: {
      validationHours: Math.max(1, Number(project.validationHours || 24)),
      offlineDays: Math.max(0, Number(project.offlineDays || 0))
    },
    serverTime: nowIso()
  };
}

function normalizeLicenseStatus(license) {
  if (license.status === "active" && license.expiresAt && isPast(license.expiresAt)) {
    return { ...license, status: "expired" };
  }
  return license;
}


function summarizeCustomerLicenses(licenses) {
  const normalized = licenses.map(normalizeLicenseStatus);
  const counts = {
    active: normalized.filter(item => item.status === "active").length,
    pending: normalized.filter(item => item.status === "pending").length,
    suspended: normalized.filter(item => item.status === "suspended").length,
    expired: normalized.filter(item => item.status === "expired").length,
    revoked: normalized.filter(item => item.status === "revoked").length
  };

  const priority = ["active", "pending", "suspended", "expired", "revoked"];
  const licenseStatus = priority.find(status => counts[status] > 0) || "none";

  return {
    licenseStatus,
    licenseCount: normalized.length,
    activeLicenseCount: counts.active,
    pendingLicenseCount: counts.pending,
    suspendedLicenseCount: counts.suspended,
    expiredLicenseCount: counts.expired,
    revokedLicenseCount: counts.revoked
  };
}

async function listCustomersWithLicenseStatus(env, projectId, admin) {
  const [customers, rawLicenses] = await Promise.all([
    listCollection(env, entityPath(projectId, "customers")),
    listCollection(env, entityPath(projectId, "licenses"))
  ]);

  const licenses = rawLicenses.map(normalizeLicenseStatus);
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const restoredIds = new Set();

  for (const license of licenses) {
    if (!license.customerId || customerMap.has(license.customerId) || restoredIds.has(license.customerId)) {
      continue;
    }

    const restored = await setDoc(env, `${entityPath(projectId, "customers")}/${license.customerId}`, {
      name: String(license.customerName || "Cliente restaurado"),
      email: String(license.customerEmail || "").toLowerCase(),
      phone: "",
      notes: "",
      status: "active",
      recoveredFromLicense: true,
      createdAt: license.createdAt || nowIso(),
      updatedAt: nowIso()
    });

    customerMap.set(restored.id, restored);
    restoredIds.add(restored.id);

    await writeLog(
      env,
      projectId,
      "customer.recovered",
      { customerId: restored.id, sourceLicenseId: license.id },
      admin?.email || admin?.uid || "system"
    );
  }

  const licensesByCustomer = new Map();
  for (const license of licenses) {
    if (!license.customerId) continue;
    if (!licensesByCustomer.has(license.customerId)) licensesByCustomer.set(license.customerId, []);
    licensesByCustomer.get(license.customerId).push(license);
  }

  return [...customerMap.values()]
    .map(customer => ({
      ...customer,
      ...summarizeCustomerLicenses(licensesByCustomer.get(customer.id) || [])
    }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
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
  const validationHours = Math.max(1, Number(body.validationHours || 24));
  const offlineDays = Math.max(0, Number(body.offlineDays ?? 7));
  const trialDays = Math.max(0, Number(body.trialDays || 0));
  const integrationCode = generateIntegrationCode();

  const project = {
    name,
    slug: slugify(body.slug || name) || id,
    prefix: normalizePrefix(body.prefix || name.slice(0, 4)) || "GSS",
    integrationCode,
    description: String(body.description || "").trim(),
    status: body.status === "inactive" ? "inactive" : "active",
    publicCatalog: Boolean(body.publicCatalog),
    allowedOrigins: normalizeAllowedOrigins(body.allowedOrigins || []),
    trialEnabled: Boolean(body.trialEnabled ?? trialDays > 0),
    trialDays,
    trialValidationHours: Math.max(1, Number(body.trialValidationHours || validationHours)),
    trialOfflineHours: Math.max(0, Number(body.trialOfflineHours ?? body.trialValidationHours ?? validationHours)),
    offlineDays,
    validationHours,
    createdAt,
    updatedAt: createdAt
  };

  let saved = await setDoc(env, projectPath(id), project);
  const lookupId = await sha256Hex(integrationCode);
  await setDoc(env, `integrationCodes/${lookupId}`, { projectId: id, createdAt });
  saved = await ensureProjectSigningKey(env, saved);
  await writeLog(env, id, "project.created", { name: saved.name, integrationCode }, admin.email || admin.uid);
  return saved;
}

async function createPlan(env, projectId, body, admin) {
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("Informe o nome do plano."), { status: 400 });

  const id = randomId("plan");
  const createdAt = nowIso();
  const lifetime = Boolean(body.lifetime);

  const startMode = ["first_activation", "immediate"].includes(body.startMode)
    ? body.startMode
    : "first_activation";

  const plan = {
    name,
    description: String(body.description || "").trim(),
    price: Math.max(0, Number(body.price || 0)),
    durationDays: lifetime ? 0 : Math.max(1, Number(body.durationDays || 30)),
    lifetime,
    deviceLimit: Math.max(1, Number(body.deviceLimit || 1)),
    startMode,
    active: body.active !== false,
    publicCatalog: Boolean(body.publicCatalog),
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

  // Quando um plano cadastrado é usado, as regras comerciais vêm exclusivamente do plano.
  // O cliente web não pode sobrescrever duração, vitalício, dispositivos ou início da validade.
  const lifetime = plan ? Boolean(plan.lifetime) : Boolean(body.lifetime);
  const durationDays = lifetime
    ? 0
    : Math.max(1, Number(plan ? plan.durationDays : (body.durationDays || 30)));
  const maxDevices = Math.max(1, Number(plan ? plan.deviceLimit : (body.maxDevices || 1)));
  const requestedStartMode = plan ? plan.startMode : body.startMode;
  const startMode = ["first_activation", "immediate"].includes(requestedStartMode)
    ? requestedStartMode
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
    if ("startMode" in clean && !["first_activation", "immediate"].includes(clean.startMode)) {
      clean.startMode = "first_activation";
    }
    if ("publicCatalog" in clean) clean.publicCatalog = Boolean(clean.publicCatalog);
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

async function dashboard(env, projectId = "", admin = null) {
  let projects = projectId
    ? [await getDoc(env, projectPath(projectId))].filter(Boolean)
    : await listCollection(env, "projects");

  if (admin && !admin.master && !admin.allProjects) {
    projects = projects.filter(project => admin.projectIds.includes(project.id));
  }

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

function publicLicenseView(project, license, extra = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    valid: true,
    type: "license",
    projectId: project.id,
    integrationCode: project.integrationCode,
    licenseId: license.id,
    status: "active",
    planName: license.planName,
    customerName: license.customerName,
    customerEmail: license.customerEmail,
    issuedAt: license.createdAt,
    activatedAt: license.activatedAt,
    expiresAt: license.expiresAt,
    startMode: license.startMode || "first_activation",
    durationDays: Number(license.durationDays || 0),
    lifetime: Boolean(license.lifetime),
    maxDevices: Number(license.maxDevices || 1),
    offlineDays: Number(project.offlineDays || 0),
    validationHours: Number(project.validationHours || 24),
    serverTime: nowIso(),
    ...extra
  };
}

async function publicActivate(env, body, origin = "") {
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!licenseKey || !deviceId) {
    throw Object.assign(new Error("licenseKey e deviceId são obrigatórios."), { status: 400, reason: "invalid_request" });
  }

  let license = await findLicenseByKey(env, projectId, licenseKey);
  if (!license) throw Object.assign(new Error("Licença inválida."), { status: 404, reason: "license_invalid" });

  if (["revoked", "suspended", "expired"].includes(license.status)) {
    throw Object.assign(new Error(`Licença ${license.status}.`), { status: 403, reason: license.status });
  }

  const deviceHash = await sha256Hex(deviceId);
  const devicePath = `projects/${projectId}/devices/${deviceHash}`;
  const existingDevice = await getDoc(env, devicePath);
  const devices = await listCollection(env, `projects/${projectId}/devices`);
  const activeDevices = devices.filter(device => device.licenseId === license.id && device.active !== false);
  const sameActiveDevice = Boolean(existingDevice?.active && existingDevice.licenseId === license.id);

  if (!sameActiveDevice && activeDevices.length >= Number(license.maxDevices || 1)) {
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
    firstActivatedAt: sameActiveDevice ? (existingDevice?.firstActivatedAt || now) : now,
    lastSeenAt: now,
    updatedAt: now
  });

  const activationId = randomId("act");
  await setDoc(env, `projects/${projectId}/activations/${activationId}`, {
    licenseId: license.id,
    customerId: license.customerId,
    deviceHash,
    type: sameActiveDevice ? "revalidate" : (existingDevice?.active ? "switch_license" : "activate"),
    createdAt: now
  });

  await writeLog(env, projectId, existingDevice?.active && existingDevice.licenseId !== license.id ? "device.license_reassigned" : "license.activated", {
    licenseId: license.id,
    previousLicenseId: existingDevice?.active && existingDevice.licenseId !== license.id ? existingDevice.licenseId : null,
    deviceHash
  }, "api");

  const trialPath = `projects/${projectId}/trials/${deviceHash}`;
  const existingTrial = await getDoc(env, trialPath);
  if (existingTrial && !["expired", "converted"].includes(existingTrial.status)) {
    await setDoc(env, trialPath, {
      ...existingTrial,
      status: "converted",
      convertedAt: now,
      convertedLicenseId: license.id,
      lastSeenAt: now,
      updatedAt: now
    });
    await writeLog(env, projectId, "trial.converted", { deviceHash, licenseId: license.id }, "api");
  }

  const view = publicLicenseView(project, license, {
    activeDevices: sameActiveDevice ? activeDevices.length : activeDevices.length + 1,
    serverTime: now
  });
  return await attachSignedEntitlement(env, project, view, deviceHash);
}

async function publicValidate(env, body, origin = "") {
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!licenseKey || !deviceId) {
    throw Object.assign(new Error("licenseKey e deviceId são obrigatórios."), { status: 400, reason: "invalid_request" });
  }

  const license = await findLicenseByKey(env, projectId, licenseKey);
  if (!license) throw Object.assign(new Error("Licença inválida."), { status: 404, reason: "license_invalid" });

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

  const view = publicLicenseView(project, license, { serverTime: now });
  return await attachSignedEntitlement(env, project, view, deviceHash);
}

async function publicDeactivate(env, body, origin = "") {
  const { projectId } = await resolvePublicProject(env, body, origin);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!licenseKey || !deviceId) {
    throw Object.assign(new Error("licenseKey e deviceId são obrigatórios."), { status: 400, reason: "invalid_request" });
  }

  const license = await findLicenseByKey(env, projectId, licenseKey);
  if (!license) throw Object.assign(new Error("Licença inválida."), { status: 404, reason: "license_invalid" });

  const deviceHash = await sha256Hex(deviceId);
  const path = `projects/${projectId}/devices/${deviceHash}`;
  const device = await getDoc(env, path);
  if (!device || device.licenseId !== license.id) {
    throw Object.assign(new Error("Dispositivo não autorizado para esta licença."), { status: 403, reason: "device_not_authorized" });
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

  return { protocolVersion: PROTOCOL_VERSION, ok: true, deactivated: true, serverTime: now };
}


function publicTrialView(project, trial, extra = {}) {
  const now = nowIso();
  const expired = isPast(trial.expiresAt) || trial.status === "expired";
  const converted = trial.status === "converted";
  const remainingMs = Math.max(0, new Date(trial.expiresAt).getTime() - new Date(now).getTime());

  return {
    protocolVersion: PROTOCOL_VERSION,
    valid: !expired && !converted,
    type: "trial",
    projectId: project.id,
    integrationCode: project.integrationCode,
    status: converted ? "converted" : (expired ? "expired" : "active"),
    startedAt: trial.startedAt,
    expiresAt: trial.expiresAt,
    durationDays: Number(trial.durationDays || 0),
    remainingSeconds: converted ? 0 : Math.floor(remainingMs / 1000),
    validationHours: Math.max(1, Number(trial.validationHours || project.trialValidationHours || project.validationHours || 24)),
    offlineHours: Math.max(0, Number(trial.offlineHours ?? project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24)),
    convertedAt: trial.convertedAt || null,
    convertedLicenseId: trial.convertedLicenseId || null,
    serverTime: now,
    ...extra
  };
}

async function publicProjectConfig(env, body, origin = "") {
  const { project } = await resolvePublicProject(env, body, origin);
  return publicProjectConfigView(project);
}

async function publicTrialStart(env, body, origin = "") {
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) {
    throw Object.assign(new Error("deviceId é obrigatório para iniciar o trial."), { status: 400, reason: "invalid_request" });
  }

  const deviceHash = await sha256Hex(deviceId);
  const path = `projects/${projectId}/trials/${deviceHash}`;
  let trial = await getDoc(env, path);
  const now = nowIso();

  // A política atual vale para NOVOS trials. Um trial já iniciado mantém o snapshot original,
  // mesmo se o administrador reduzir a duração ou desativar novas avaliações depois.
  if (trial) {
    if (trial.status === "converted") {
      throw Object.assign(new Error("Este trial foi convertido em licença paga."), {
        status: 403,
        reason: "trial_converted",
        details: { convertedAt: trial.convertedAt || null, licenseId: trial.convertedLicenseId || null }
      });
    }

    if (isPast(trial.expiresAt) || trial.status === "expired") {
      if (trial.status !== "expired") {
        trial = await setDoc(env, path, { ...trial, status: "expired", lastSeenAt: now, updatedAt: now });
      }
      throw Object.assign(new Error("O período de avaliação deste dispositivo já expirou."), {
        status: 403,
        reason: "trial_expired",
        details: { startedAt: trial.startedAt, expiresAt: trial.expiresAt }
      });
    }

    trial = await setDoc(env, path, {
      ...trial,
      lastSeenAt: now,
      deviceName: String(body.deviceName || trial.deviceName || "Dispositivo").trim(),
      platform: String(body.platform || trial.platform || "").trim(),
      appVersion: String(body.appVersion || trial.appVersion || "").trim(),
      updatedAt: now
    });
    return await attachSignedEntitlement(env, project, publicTrialView(project, trial), deviceHash);
  }

  if (!project.trialEnabled || Number(project.trialDays || 0) <= 0) {
    throw Object.assign(new Error("Este projeto não oferece avaliação gratuita."), { status: 403, reason: "trial_unavailable" });
  }

  const durationDays = Math.max(1, Number(project.trialDays || 0));
  trial = await setDoc(env, path, {
    deviceHash,
    status: "active",
    startedAt: now,
    expiresAt: plusDays(now, durationDays),
    durationDays,
    validationHours: Math.max(1, Number(project.trialValidationHours || project.validationHours || 24)),
    offlineHours: Math.max(0, Number(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24)),
    deviceName: String(body.deviceName || "Dispositivo").trim(),
    platform: String(body.platform || "").trim(),
    appVersion: String(body.appVersion || "").trim(),
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now
  });

  await writeLog(env, projectId, "trial.started", {
    deviceHash,
    durationDays,
    expiresAt: trial.expiresAt
  }, "api");

  return await attachSignedEntitlement(env, project, publicTrialView(project, trial, { firstStart: true }), deviceHash);
}

async function publicTrialValidate(env, body, origin = "") {
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) {
    throw Object.assign(new Error("deviceId é obrigatório para validar o trial."), { status: 400, reason: "invalid_request" });
  }

  const deviceHash = await sha256Hex(deviceId);
  const path = `projects/${projectId}/trials/${deviceHash}`;
  let trial = await getDoc(env, path);
  if (!trial) {
    throw Object.assign(new Error("Nenhum trial foi iniciado para este dispositivo."), { status: 404, reason: "trial_not_started" });
  }

  const now = nowIso();
  if (trial.status === "converted") {
    throw Object.assign(new Error("Este trial foi convertido em licença paga."), {
      status: 403,
      reason: "trial_converted",
      details: { convertedAt: trial.convertedAt || null, licenseId: trial.convertedLicenseId || null }
    });
  }

  if (isPast(trial.expiresAt) || trial.status === "expired") {
    if (trial.status !== "expired") {
      trial = await setDoc(env, path, { ...trial, status: "expired", lastSeenAt: now, updatedAt: now });
      await writeLog(env, projectId, "trial.expired", { deviceHash, expiresAt: trial.expiresAt }, "api");
    }
    throw Object.assign(new Error("O período de avaliação expirou."), {
      status: 403,
      reason: "trial_expired",
      details: { startedAt: trial.startedAt, expiresAt: trial.expiresAt }
    });
  }

  trial = await setDoc(env, path, {
    ...trial,
    lastSeenAt: now,
    appVersion: String(body.appVersion || trial.appVersion || "").trim(),
    updatedAt: now
  });

  return await attachSignedEntitlement(env, project, publicTrialView(project, trial), deviceHash);
}

async function publicCatalog(env) {
  const projects = (await listCollection(env, "projects"))
    .filter(project => project.status === "active" && project.publicCatalog === true);

  const items = [];
  for (let project of projects) {
    project = await ensureProjectIntegrationCode(env, project);
    const plans = (await listCollection(env, `projects/${project.id}/plans`))
      .filter(plan => plan.active !== false && plan.publicCatalog === true)
      .map(plan => ({
        id: plan.id,
        name: plan.name,
        description: plan.description || "",
        price: Number(plan.price || 0),
        durationDays: Number(plan.durationDays || 0),
        lifetime: Boolean(plan.lifetime),
        deviceLimit: Number(plan.deviceLimit || 1),
        startMode: plan.startMode || "first_activation"
      }));

    items.push({
      projectId: project.id,
      integrationCode: project.integrationCode,
      name: project.name,
      slug: project.slug,
      prefix: project.prefix,
      description: project.description || "",
      trial: {
        enabled: Boolean(project.trialEnabled && Number(project.trialDays || 0) > 0),
        days: Number(project.trialDays || 0)
      },
      plans
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { protocolVersion: PROTOCOL_VERSION, projects: items, serverTime: nowIso() };
}

async function listAdminRecords(env) {
  const items = await listCollection(env, "admins");
  items.sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "pt-BR"));
  return items;
}

async function saveAdminRecord(env, body, existing = null) {
  const email = String(body.email ?? existing?.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Informe um e-mail válido para o administrador."), { status: 400 });
  }

  const id = await sha256Hex(email);
  const now = nowIso();
  const record = {
    name: String(body.name ?? existing?.name ?? "").trim(),
    email,
    status: body.status != null
      ? (body.status === "inactive" ? "inactive" : "active")
      : (existing?.status === "inactive" ? "inactive" : "active"),
    allProjects: body.allProjects != null
      ? Boolean(body.allProjects)
      : Boolean(existing?.allProjects),
    projectIds: Array.isArray(body.projectIds)
      ? [...new Set(body.projectIds.map(String).filter(Boolean))]
      : (Array.isArray(existing?.projectIds) ? existing.projectIds : []),
    permissions: normalizeAdminPermissions(body.permissions ?? existing?.permissions ?? {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  return await setDoc(env, `admins/${id}`, record);
}

async function handleAdmin(request, env, origin, url, admin) {
  const method = request.method;
  const path = url.pathname.replace(/^\/api\/v1\/admin\/?/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts.length === 1 && parts[0] === "me" && method === "GET") {
    return json({ ok: true, authorized: true, administrator: admin }, 200, origin);
  }

  if (parts[0] === "admins") {
    if (!admin.master) {
      return errorResponse(origin, 403, "master_required", "Somente o administrador master pode gerenciar administradores.");
    }

    if (parts.length === 1 && method === "GET") {
      return json({ ok: true, admins: await listAdminRecords(env) }, 200, origin);
    }

    if (parts.length === 1 && method === "POST") {
      const body = await readJson(request);
      if (String(body.email || "").trim().toLowerCase() === String(admin.email || "").trim().toLowerCase()) {
        return errorResponse(origin, 409, "master_account", "A conta master não precisa ser cadastrada novamente.");
      }
      return json({ ok: true, admin: await saveAdminRecord(env, body) }, 201, origin);
    }

    const adminId = parts[1];
    if (adminId && parts.length === 2) {
      const path = `admins/${adminId}`;
      const existing = await getDoc(env, path);
      if (!existing) return errorResponse(origin, 404, "admin_not_found", "Administrador não encontrado.");

      if (method === "PATCH") {
        const body = await readJson(request);
        if (body.email && String(body.email).trim().toLowerCase() !== existing.email) {
          return errorResponse(origin, 400, "email_immutable", "O e-mail do administrador não pode ser alterado. Exclua e cadastre novamente.");
        }
        return json({ ok: true, admin: await saveAdminRecord(env, body, existing) }, 200, origin);
      }

      if (method === "DELETE") {
        await deleteDoc(env, path);
        return json({ ok: true, deleted: true }, 200, origin);
      }
    }

    return errorResponse(origin, 404, "not_found", "Rota de administradores não encontrada.");
  }

  if (parts.length === 1 && parts[0] === "dashboard" && method === "GET") {
    requirePermission(admin, "viewDashboard", "Você não possui permissão para visualizar o dashboard.");
    const requestedProjectId = url.searchParams.get("projectId") || "";
    if (requestedProjectId) requireProjectAccess(admin, requestedProjectId);
    return json({ ok: true, dashboard: await dashboard(env, requestedProjectId, admin) }, 200, origin);
  }

  if (parts[0] === "projects") {
    if (parts.length === 1) {
      if (method === "GET") {
        let projects = await listCollection(env, "projects");
        if (!admin.master && !admin.allProjects) {
          projects = projects.filter(project => admin.projectIds.includes(project.id));
        }
        projects = await Promise.all(projects.map(project => ensureProjectIntegrationCode(env, project)));
        projects.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
        return json({ ok: true, projects }, 200, origin);
      }
      if (method === "POST") {
        requirePermission(admin, "manageProjects", "Você não possui permissão para criar projetos.");
        if (!admin.master && !admin.allProjects) {
          return errorResponse(origin, 403, "all_projects_required", "Para criar projetos, este administrador precisa ter acesso a todos os projetos.");
        }
        return json({ ok: true, project: await createProject(env, await readJson(request), admin) }, 201, origin);
      }
    }

    const projectId = parts[1];
    if (!projectId || !(await projectExists(env, projectId))) {
      return errorResponse(origin, 404, "project_not_found", "Projeto não encontrado.");
    }

    requireProjectAccess(admin, projectId);

    if (parts.length === 2) {
      if (method === "GET") {
        const project = await ensureProjectIntegrationCode(env, await getDoc(env, projectPath(projectId)));
        return json({ ok: true, project }, 200, origin);
      }
      if (method === "PATCH") {
        requirePermission(admin, "manageProjectSettings", "Você não possui permissão para alterar as configurações deste projeto.");
        const current = await getDoc(env, projectPath(projectId));
        const body = await readJson(request);
        const next = {
          ...current,
          ...body,
          id: projectId,
          name: String(body.name ?? current.name).trim(),
          slug: slugify(body.slug ?? current.slug),
          prefix: normalizePrefix(body.prefix ?? current.prefix),
          status: body.status != null
            ? (body.status === "inactive" ? "inactive" : "active")
            : (current.status === "inactive" ? "inactive" : "active"),
          integrationCode: current.integrationCode || generateIntegrationCode(),
          signingKeyId: current.signingKeyId || null,
          signingAlgorithm: current.signingAlgorithm || "ES256",
          signingPublicJwk: current.signingPublicJwk || null,
          publicCatalog: body.publicCatalog != null ? Boolean(body.publicCatalog) : Boolean(current.publicCatalog),
          allowedOrigins: body.allowedOrigins != null ? normalizeAllowedOrigins(body.allowedOrigins) : normalizeAllowedOrigins(current.allowedOrigins || []),
          trialEnabled: body.trialEnabled != null
            ? Boolean(body.trialEnabled)
            : Boolean(current.trialEnabled ?? Number(body.trialDays ?? current.trialDays ?? 0) > 0),
          trialDays: Math.max(0, Number(body.trialDays ?? current.trialDays ?? 0)),
          trialValidationHours: Math.max(1, Number(body.trialValidationHours ?? current.trialValidationHours ?? body.validationHours ?? current.validationHours ?? 24)),
          trialOfflineHours: Math.max(0, Number(body.trialOfflineHours ?? current.trialOfflineHours ?? body.trialValidationHours ?? current.trialValidationHours ?? body.validationHours ?? current.validationHours ?? 24)),
          offlineDays: Math.max(0, Number(body.offlineDays ?? current.offlineDays ?? 7)),
          validationHours: Math.max(1, Number(body.validationHours ?? current.validationHours ?? 24)),
          createdAt: current.createdAt,
          updatedAt: nowIso()
        };
        const saved = await setDoc(env, projectPath(projectId), next);
        const integrationLookupId = await sha256Hex(saved.integrationCode);
        await setDoc(env, `integrationCodes/${integrationLookupId}`, { projectId, createdAt: current.createdAt || nowIso() });
        await writeLog(env, projectId, "project.updated", { name: saved.name }, admin.email || admin.uid);
        return json({ ok: true, project: saved }, 200, origin);
      }
      if (method === "DELETE") {
        requirePermission(admin, "manageProjects", "Você não possui permissão para arquivar projetos.");
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

    const entityPermission = permissionForEntity(entity);
    if (entityPermission) {
      requirePermission(admin, entityPermission, "Você não possui permissão para acessar este módulo.");
    }

    if (parts.length === 3) {
      if (method === "GET") {
        let items;
        if (entity === "customers") {
          items = await listCustomersWithLicenseStatus(env, projectId, admin);
        } else {
          items = await listCollection(env, entityPath(projectId, entity));
          if (entity === "licenses") items = items.map(normalizeLicenseStatus);
          items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        }
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

    if (entity === "trials" && parts.length === 5 && parts[4] === "reset" && method === "POST") {
      const path = `${entityPath(projectId, "trials")}/${entityId}`;
      const trial = await getDoc(env, path);
      if (!trial) return errorResponse(origin, 404, "trial_not_found", "Trial não encontrado.");
      await deleteDoc(env, path);
      await writeLog(env, projectId, "trial.reset", { deviceHash: entityId }, admin.email || admin.uid);
      return json({ ok: true, reset: true }, 200, origin);
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

        if (entity === "customers") {
          const licenses = (await listCollection(env, entityPath(projectId, "licenses")))
            .map(normalizeLicenseStatus)
            .filter(license => license.customerId === entityId);

          if (licenses.length > 0) {
            return errorResponse(
              origin,
              409,
              "customer_has_licenses",
              "Este cliente possui licença(s) vinculada(s) e não pode ser excluído. Desative o cadastro para preservar o histórico.",
              { licenseCount: licenses.length }
            );
          }
        }

        await deleteDoc(env, path);
        await writeLog(env, projectId, `${entity.slice(0, -1)}.deleted`, { id: entityId }, admin.email || admin.uid);
        return json({ ok: true, deleted: true }, 200, origin);
      }
    }
  }

  return errorResponse(origin, 404, "not_found", "Rota administrativa não encontrada.");
}

function isPublicApiPath(pathname) {
  return [
    "/api/v1/catalog",
    "/api/v1/project/config",
    "/api/v1/trial/start",
    "/api/v1/trial/validate",
    "/api/v1/license/activate",
    "/api/v1/license/validate",
    "/api/v1/license/deactivate"
  ].includes(pathname);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const publicApi = isPublicApiPath(url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, publicApi) });
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          name: "GuiaSys Licensing API",
          status: "online",
          version: API_VERSION,
          protocolVersion: PROTOCOL_VERSION
        }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "guiasys-licensing-api",
          version: API_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          firebaseProject: env.FIREBASE_PROJECT_ID || null,
          serviceAccountConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON),
          adminConfigured: Boolean(env.ADMIN_FIREBASE_UID),
          offlineEntitlements: "ES256"
        }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/v1/catalog") {
        await enforceRateLimit(env, request, "catalog", 120, 60);
        return json({ ok: true, catalog: await publicCatalog(env) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/project/config") {
        await enforceRateLimit(env, request, "project-config", 120, 60);
        const body = await readJson(request);
        return json({ ok: true, project: await publicProjectConfig(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/trial/start") {
        await enforceRateLimit(env, request, "trial-start", 20, 600);
        const body = await readJson(request);
        return json({ ok: true, trial: await publicTrialStart(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/trial/validate") {
        await enforceRateLimit(env, request, "trial-validate", 120, 300);
        const body = await readJson(request);
        return json({ ok: true, trial: await publicTrialValidate(env, body, origin) }, 200, origin, true);
      }

      if (url.pathname.startsWith("/api/v1/admin/")) {
        const auth = await requireAdmin(request, env);
        if (!auth.ok) return errorResponse(origin, auth.status, auth.error, auth.message);
        return await handleAdmin(request, env, origin, url, auth.user);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/license/activate") {
        await enforceRateLimit(env, request, "license-activate", 30, 600);
        const body = await readJson(request);
        return json({ ok: true, license: await publicActivate(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/license/validate") {
        await enforceRateLimit(env, request, "license-validate", 180, 300);
        const body = await readJson(request);
        return json({ ok: true, license: await publicValidate(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/license/deactivate") {
        await enforceRateLimit(env, request, "license-deactivate", 30, 600);
        const body = await readJson(request);
        return json({ ok: true, result: await publicDeactivate(env, body, origin) }, 200, origin, true);
      }

      return errorResponse(origin, 404, "not_found", "Rota não encontrada.", null, publicApi);
    } catch (error) {
      console.error(error);
      return errorResponse(
        origin,
        Number(error.status || 500),
        error.reason || "internal_error",
        error.message || "Erro interno do servidor.",
        error.status >= 500 ? null : error.details || null,
        publicApi
      );
    }
  }
};
