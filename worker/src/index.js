import {
  assertAdminId,
  assertCommerceId,
  assertEntityId,
  assertFirestorePath,
  assertProjectId,
  assertSafePathSegment,
  decodeAdminPathSegments
} from "./security.js";
import { assertCents, moneyToCents, transitionOrderStatus, transitionPaymentStatus } from "./commerce-policy.js";
import { issueLicenseInTransaction } from "./license-service.js";
import { fetchWithTimeout } from "./network.js";
import { PagBankProvider } from "./payments/payment-provider.js";
import {
  DEFAULT_PAYMENT_SETTINGS,
  MANUAL_PIX_PROVIDER,
  buildManualPixPresentation,
  manualPixWhatsappUrl,
  pixTxidForOrder,
  publicPaymentSettings,
  validatePaymentSettings
} from "./payments/manual-pix.js";
import {
  claimPaymentSubmission,
  createPaymentAttempt,
  linkPaymentProviderResult,
  recordPaymentEvent,
  recordPaymentSubmissionFailure
} from "./payments/payment-service.js";
import { createFirestoreAtomicClient } from "./firestore-atomic.js";
import {
  assertLicenseCanActivate,
  effectiveLicenseStatus,
  totalActivationDays,
  transitionLicense
} from "./license-policy.js";
import {
  summarizeActivity,
  validationMutation
} from "./activity-policy.js";
import {
  assertAccountTokenStillValid,
  assertRecentAuthentication,
  parseCacheMaxAge,
  validateFirebaseClaims
} from "./auth-policy.js";
import {
  readJsonBody,
  isValidCpf,
  validateAdminPayload,
  validateCartPayload,
  validateCustomerProfilePayload,
  validateCustomerPayload,
  validateLicenseActionPayload,
  validateLicenseCreatePayload,
  validateOrderCreatePayload,
  validatePaymentCreatePayload,
  validatePaymentReconcilePayload,
  validateMediaPayload,
  validatePlanPayload,
  validateProjectPayload,
  validatePublicLicensePayload,
  validatePublicProjectPayload,
  validatePublicTrialPayload,
  validateRenewalOrderPayload
} from "./validation.js";

const MAX_MEDIA_JSON_BYTES = 7 * 1024 * 1024;

// GuiaSys Licensing API — runtime principal em Firebase Functions v2; Worker legado somente para rollback
const PROTOCOL_VERSION = "GSL-v1";
const API_VERSION = "2.1.0";
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5500",
  "http://localhost:5501",
  "https://licencas.guiasys.online",
  "https://guiasys-licensing.web.app",
  "https://guiasys-licensing.firebaseapp.com",
  "https://painel.licencas.guiasys.online",
  "https://guiasys-licensing-admin.web.app",
  "https://guiasys-licensing-admin.firebaseapp.com"
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
  viewOrders: false,
  manageOrders: false,
  viewPayments: false,
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

const googleTokenCache = new Map();
const firebaseAccountCache = new Map();
const pagBankProviderCache = new Map();
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

function isInternalHostingOrigin(origin) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return true;

  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      /^guiasys-licensing(?:-admin)?--[a-z0-9-]+\.web\.app$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function assertProjectOrigin(project, origin) {
  if (isInternalHostingOrigin(origin)) return;

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
  return await readJsonBody(request);
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

async function getFirebasePublicKeys(forceRefresh = false) {
  if (!forceRefresh && firebaseKeyCache.keys && firebaseKeyCache.expiresAt > Date.now()) {
    return firebaseKeyCache.keys;
  }

  const response = await fetchWithTimeout(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    {},
    8_000
  );

  if (!response.ok) {
    throw Object.assign(new Error("Serviço de autenticação temporariamente indisponível."), {
      status: 502,
      reason: "upstream_error"
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!Array.isArray(data.keys)) {
    throw Object.assign(new Error("Resposta inválida das chaves públicas do Firebase."), {
      status: 502,
      reason: "upstream_error"
    });
  }

  const maxAge = parseCacheMaxAge(response.headers.get("Cache-Control"), 300);
  firebaseKeyCache = {
    keys: data.keys,
    expiresAt: Date.now() + maxAge * 1000
  };

  return data.keys;
}

async function verifyFirebaseIdToken(idToken, env) {
  if (!idToken) throw new Error("Token Firebase não informado.");

  if (env.__services?.verifyIdToken) {
    const payload = await env.__services.verifyIdToken(idToken);
    validateFirebaseClaims(payload, env.FIREBASE_PROJECT_ID);
    return payload;
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Token Firebase inválido.");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Cabeçalho do token Firebase inválido.");
  }

  let keys = await getFirebasePublicKeys(false);
  let jwk = keys.find(key => key.kid === header.kid);

  if (!jwk) {
    keys = await getFirebasePublicKeys(true);
    jwk = keys.find(key => key.kid === header.kid);
  }

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

  validateFirebaseClaims(payload, env.FIREBASE_PROJECT_ID);
  return payload;
}

function bearerToken(request) {
  return request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function bindAdminIdentity(env, adminId, baseUser) {
  const uidLookupId = await sha256Hex(baseUser.uid);

  return await atomicClient(env).runTransaction(async tx => {
    const path = `admins/${adminId}`;
    const uidPath = `adminUids/${uidLookupId}`;
    const current = await tx.get(path);
    const uidLookup = await tx.get(uidPath);

    if (!current || current.status !== "active") {
      throw Object.assign(new Error("Esta conta não possui acesso administrativo."), {
        status: 403,
        reason: "admin_required"
      });
    }

    if (current.firebaseUid && current.firebaseUid !== baseUser.uid) {
      throw Object.assign(new Error("Esta conta Firebase não corresponde ao administrador cadastrado."), {
        status: 403,
        reason: "admin_identity_mismatch"
      });
    }

    if (uidLookup?.adminId && uidLookup.adminId !== adminId) {
      throw Object.assign(new Error("UID Firebase já vinculado a outro administrador."), {
        status: 403,
        reason: "admin_identity_mismatch"
      });
    }

    const firstBinding = !current.firebaseUid;
    const now = nowIso();
    const next = firstBinding
      ? {
          ...current,
          firebaseUid: baseUser.uid,
          identityBoundAt: now,
          updatedAt: now
        }
      : current;

    if (firstBinding) tx.set(path, next);
    if (!uidLookup) {
      tx.create(uidPath, {
        adminId,
        createdAt: now
      });
    }

    if (firstBinding || !uidLookup) {
      queuePlatformLogInTransaction(
        tx,
        "admin.identity_bound",
        {
          adminId,
          email: current.email,
          signInProvider: baseUser.signInProvider
        },
        baseUser.email || baseUser.uid,
        now
      );
    }

    return next;
  });
}

async function resolveAdminIdentity(env, baseUser) {
  const uidLookupId = await sha256Hex(baseUser.uid);
  const lookup = await getDoc(env, `adminUids/${uidLookupId}`);

  if (lookup?.adminId) {
    const adminId = assertAdminId(lookup.adminId);
    const record = await getDoc(env, `admins/${adminId}`);

    if (
      !record ||
      record.status !== "active" ||
      record.firebaseUid !== baseUser.uid
    ) {
      throw Object.assign(new Error("Esta conta não possui acesso administrativo."), {
        status: 403,
        reason: "admin_required"
      });
    }

    return { adminId, record };
  }

  if (!baseUser.email || !baseUser.emailVerified) {
    throw Object.assign(new Error("Esta conta não possui e-mail verificado para acesso administrativo."), {
      status: 403,
      reason: "admin_required"
    });
  }

  const adminId = await sha256Hex(baseUser.email.toLowerCase());
  const record = await bindAdminIdentity(env, adminId, baseUser);
  return { adminId, record };
}

async function requireFirebaseUser(request, env) {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, error: "authentication_required", message: "Autenticação Firebase obrigatória." };
  }

  try {
    const user = await verifyFirebaseIdToken(token, env);
    const account = await getFirebaseAccountState(env, user.sub);
    assertAccountTokenStillValid(account, user);

    const baseUser = {
      uid: user.sub,
      email: user.email || account?.email || null,
      name: user.name || account?.displayName || null,
      picture: user.picture || account?.photoUrl || null,
      emailVerified: Boolean(account?.emailVerified ?? user.email_verified),
      authTime: Number(user.auth_time),
      issuedAt: Number(user.iat),
      signInProvider: String(user.firebase?.sign_in_provider || "")
    };

    return { ok: true, user: baseUser };
  } catch (error) {
    if (Number(error?.status) >= 500) {
      return { ok: false, status: Number(error.status), error: error.reason || "auth_unavailable", message: "Serviço de autenticação temporariamente indisponível." };
    }
    return { ok: false, status: 401, error: error.reason || "invalid_token", message: error.message };
  }
}

async function requireAdmin(request, env) {
  const auth = await requireFirebaseUser(request, env);
  if (!auth.ok) return auth;

  try {
    const baseUser = auth.user;
    if (baseUser.uid === env.ADMIN_FIREBASE_UID) {
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
      return {
        ok: false,
        status: 403,
        error: "admin_required",
        message: "Esta conta não possui e-mail verificado para acesso administrativo."
      };
    }

    const { adminId, record } = await resolveAdminIdentity(env, baseUser);

    return {
      ok: true,
      user: {
        ...baseUser,
        adminId,
        master: false,
        role: "admin",
        allProjects: Boolean(record.allProjects),
        projectIds: Array.isArray(record.projectIds) ? record.projectIds : [],
        permissions: normalizeAdminPermissions(record.permissions),
        identityBound: Boolean(record.firebaseUid)
      }
    };
  } catch (error) {
    if (error?.status === 403) {
      return {
        ok: false,
        status: 403,
        error: error.reason || "admin_required",
        message: error.message
      };
    }
    if (Number(error?.status) >= 500) {
      return {
        ok: false,
        status: Number(error.status),
        error: error.reason || "auth_unavailable",
        message: "Serviço de autenticação temporariamente indisponível."
      };
    }
    return {
      ok: false,
      status: 401,
      error: error.reason || "invalid_token",
      message: error.message
    };
  }
}

async function getGoogleAccessToken(env, scope = "https://www.googleapis.com/auth/datastore") {
  const cached = googleTokenCache.get(scope);
  if (cached?.token && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
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

  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedToken}.${base64UrlEncode(signature)}`
    })
  }, 8_000);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw Object.assign(new Error("Não foi possível autenticar o backend no Google."), {
      status: 502,
      reason: "upstream_error"
    });
  }

  const entry = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  };
  googleTokenCache.set(scope, entry);
  return entry.token;
}

async function getFirebaseAccountState(env, uid, forceRefresh = false) {
  const cached = firebaseAccountCache.get(uid);
  if (!forceRefresh && cached?.expiresAt > Date.now()) {
    return cached.account;
  }

  if (env.__services?.getAccountState) {
    const account = await env.__services.getAccountState(uid);
    firebaseAccountCache.set(uid, {
      account,
      expiresAt: Date.now() + 60_000
    });
    return account;
  }

  const token = await getGoogleAccessToken(env, "https://www.googleapis.com/auth/identitytoolkit");
  const response = await fetchWithTimeout(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ localId: [uid] })
    },
    8_000
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error("Não foi possível consultar a conta Firebase."), {
      status: 502,
      reason: "upstream_error"
    });
  }

  const account = Array.isArray(data.users) ? data.users[0] || null : null;
  firebaseAccountCache.set(uid, {
    account,
    expiresAt: Date.now() + 60_000
  });
  return account;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw Object.assign(new Error("Valor numérico interno inválido."), {
        status: 500,
        reason: "invalid_internal_value"
      });
    }
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

function decodeFirestoreDocument(data) {
  if (!data) return null;
  const decoded = { id: docIdFromName(data.name), ...fromFirestoreFields(data.fields || {}) };
  Object.defineProperty(decoded, "__updateTime", {
    value: data.updateTime || "",
    enumerable: false,
    configurable: false
  });
  return decoded;
}

async function firestoreRequest(env, path, options = {}) {
  const token = await getGoogleAccessToken(env);
  const safePath = assertFirestorePath(path);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${safePath}`;

  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  }, 10_000);

  if (response.status === 404) return null;

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Falha ao acessar o Firestore."), {
      status: 502,
      reason: "upstream_error",
      firestoreStatus: response.status
    });
  }

  return data;
}

async function getDoc(env, path) {
  const safePath = assertFirestorePath(path);
  if (env.__services?.getDoc) return await env.__services.getDoc(safePath);

  const data = await firestoreRequest(env, safePath);
  return decodeFirestoreDocument(data);
}

async function setDoc(env, path, value) {
  const safePath = assertFirestorePath(path);
  if (env.__services?.setDoc) return await env.__services.setDoc(safePath, value);

  const data = await firestoreRequest(env, safePath, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFirestoreFields(value) })
  });
  return { id: docIdFromName(data.name), ...fromFirestoreFields(data.fields || {}) };
}

async function deleteDoc(env, path) {
  const safePath = assertFirestorePath(path);
  if (env.__services?.deleteDoc) {
    await env.__services.deleteDoc(safePath);
    return;
  }

  const token = await getGoogleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${safePath}`;
  const response = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  }, 10_000);
  if (![200, 204, 404].includes(response.status)) {
    throw Object.assign(new Error("Falha ao acessar o Firestore."), {
      status: 502,
      reason: "upstream_error",
      firestoreStatus: response.status
    });
  }
}

async function listCollection(env, path) {
  const safePath = assertFirestorePath(path);
  if (env.__services?.listCollection) return await env.__services.listCollection(safePath);

  const token = await getGoogleAccessToken(env);
  let pageToken = "";
  const result = [];

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${safePath}`
    );
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetchWithTimeout(
      url,
      { headers: { "Authorization": `Bearer ${token}` } },
      10_000
    );

    if (response.status === 404) return [];

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error("Falha ao acessar o Firestore."), {
        status: 502,
        reason: "upstream_error",
        firestoreStatus: response.status
      });
    }

    for (const doc of data.documents || []) {
      result.push(decodeFirestoreDocument(doc));
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return result;
}

function atomicClient(env) {
  if (env.__services?.atomicClient) return env.__services.atomicClient();

  return createFirestoreAtomicClient({
    projectId: env.FIREBASE_PROJECT_ID,
    getAccessToken: () => getGoogleAccessToken(env),
    encodeFields: toFirestoreFields,
    encodeValue: toFirestoreValue,
    decodeFields: fromFirestoreFields,
    docIdFromName
  });
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
  const clientHash = await sha256Hex(clientId);
  const now = Date.now();

  await atomicClient(env).runTransaction(async tx => {
    const current = await tx.get(path);
    const windowStartedMs = current?.windowStartedAt ? new Date(current.windowStartedAt).getTime() : 0;
    const sameWindow = current && Number.isFinite(windowStartedMs) && now - windowStartedMs < windowSeconds * 1000;
    const count = sameWindow ? Number(current.count || 0) : 0;

    if (count >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowSeconds * 1000 - (now - windowStartedMs)) / 1000)
      );
      throw Object.assign(new Error("Muitas requisições. Aguarde e tente novamente."), {
        status: 429,
        reason: "rate_limited",
        details: { retryAfterSeconds }
      });
    }

    tx.set(path, {
      bucket,
      clientHash,
      count: count + 1,
      windowStartedAt: sameWindow ? current.windowStartedAt : new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    });
  });
}

async function generateSigningMaterial() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const keyId = randomId("sig");
  const createdAt = nowIso();

  return {
    keyId,
    algorithm: "ES256",
    privateJwk,
    publicJwk,
    createdAt,
    updatedAt: createdAt
  };
}

async function ensureProjectSigningKey(env, project) {
  if (!project) return null;

  return await atomicClient(env).runTransaction(async tx => {
    const projectPathValue = projectPath(project.id);
    const signingPath = `projects/${project.id}/internal/signing`;
    const currentProject = await tx.get(projectPathValue);
    if (!currentProject) {
      throw Object.assign(new Error("Projeto não encontrado."), {
        status: 404,
        reason: "project_not_found"
      });
    }

    const stored = await tx.get(signingPath);
    if (stored?.privateJwk && stored?.publicJwk && stored?.keyId) {
      if (
        currentProject.signingKeyId === stored.keyId &&
        currentProject.signingPublicJwk?.x &&
        currentProject.signingPublicJwk?.y
      ) {
        return currentProject;
      }

      const synced = {
        ...currentProject,
        signingKeyId: stored.keyId,
        signingAlgorithm: "ES256",
        signingPublicJwk: stored.publicJwk,
        updatedAt: nowIso()
      };
      tx.set(projectPathValue, synced);
      return synced;
    }

    const material = await generateSigningMaterial();
    tx.create(signingPath, material);

    const synced = {
      ...currentProject,
      signingKeyId: material.keyId,
      signingAlgorithm: "ES256",
      signingPublicJwk: material.publicJwk,
      updatedAt: material.createdAt
    };
    tx.set(projectPathValue, synced);
    return synced;
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

async function writePlatformLog(env, action, details = {}, actor = "admin") {
  const id = randomId("plog");
  await setDoc(env, `platformLogs/${id}`, {
    action,
    actor,
    details,
    createdAt: nowIso()
  });
}

function queueLogInTransaction(tx, projectId, action, details = {}, actor = "admin", createdAt = nowIso()) {
  const id = randomId("log");
  tx.create(`projects/${projectId}/logs/${id}`, {
    action,
    actor,
    details,
    createdAt
  });
}

function queuePlatformLogInTransaction(tx, action, details = {}, actor = "admin", createdAt = nowIso()) {
  const id = randomId("plog");
  tx.create(`platformLogs/${id}`, {
    action,
    actor,
    details,
    createdAt
  });
}

function projectPath(projectId) {
  return `projects/${assertProjectId(projectId)}`;
}

function entityPath(projectId, entity) {
  const safeEntity = assertSafePathSegment(entity, "Entidade");
  if (!ENTITY_NAMES.has(safeEntity)) {
    throw Object.assign(new Error("Entidade inválida."), { status: 400, reason: "invalid_identifier" });
  }
  return `${projectPath(projectId)}/${safeEntity}`;
}

async function ensureProjectIntegrationCode(env, project) {
  if (!project) return null;

  const next = await atomicClient(env).runTransaction(async tx => {
    const current = await tx.get(projectPath(project.id));
    if (!current) {
      throw Object.assign(new Error("Projeto não encontrado."), {
        status: 404,
        reason: "project_not_found"
      });
    }

    let updated = current;
    let changed = false;
    let integrationCreated = false;

    if (!updated.integrationCode) {
      updated = { ...updated, integrationCode: generateIntegrationCode() };
      changed = true;
      integrationCreated = true;
    }

    const defaults = {
      trialEnabled: Boolean(updated.trialEnabled ?? Number(updated.trialDays || 0) > 0),
      trialDays: Math.max(0, Number(updated.trialDays || 0)),
      trialValidationHours: Math.max(1, Number(updated.trialValidationHours || updated.validationHours || 24)),
      trialOfflineHours: Math.max(0, Number(updated.trialOfflineHours ?? updated.trialValidationHours ?? updated.validationHours ?? 24)),
      publicCatalog: Boolean(updated.publicCatalog),
      allowedOrigins: normalizeAllowedOrigins(updated.allowedOrigins || [])
    };

    for (const [key, value] of Object.entries(defaults)) {
      if (JSON.stringify(updated[key]) !== JSON.stringify(value)) {
        updated = { ...updated, [key]: value };
        changed = true;
      }
    }

    if (changed) {
      updated = { ...updated, updatedAt: nowIso() };
      tx.set(projectPath(updated.id), updated);
    }

    if (integrationCreated) {
      const lookupId = await sha256Hex(updated.integrationCode);
      tx.create(`integrationCodes/${lookupId}`, {
        projectId: updated.id,
        createdAt: updated.updatedAt || nowIso()
      });
    }

    return updated;
  });

  return await ensureProjectSigningKey(env, next);
}

async function resolvePublicProject(env, body = {}, origin = "") {
  const directProjectIdRaw = String(body.projectId || "").trim();
  const directProjectId = directProjectIdRaw ? assertProjectId(directProjectIdRaw) : "";
  const integrationCode = String(body.integrationCode || "").trim().toUpperCase();

  let projectId = directProjectId;
  if (!projectId && integrationCode) {
    const lookupId = await sha256Hex(integrationCode);
    const lookup = await getDoc(env, `integrationCodes/${lookupId}`);
    projectId = String(lookup?.projectId || "");
    if (projectId) projectId = assertProjectId(projectId);
  }

  if (!projectId) {
    throw Object.assign(new Error("Informe projectId ou integrationCode."), { status: 400, reason: "invalid_request" });
  }

  let project = await getDoc(env, projectPath(projectId));
  if (!project) {
    throw Object.assign(new Error("Projeto não encontrado."), { status: 404, reason: "project_not_found" });
  }

  if (project.status !== "active") {
    throw Object.assign(new Error("Projeto inativo."), { status: 403, reason: "project_inactive" });
  }

  assertProjectOrigin(project, origin);
  project = await ensureProjectIntegrationCode(env, project);
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
      offlineHours: Math.max(0, Number(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24)),
      deviceIdentity: "stable_installation_id",
      restartPolicy: "same_project_device_hash_never_restarts",
      requestIdSupported: true
    },
    license: {
      validationHours: Math.max(1, Number(project.validationHours || 24)),
      offlineDays: Math.max(0, Number(project.offlineDays || 0))
    },
    serverTime: nowIso()
  };
}

function normalizeLicenseStatus(license) {
  if (!license) return license;
  const status = effectiveLicenseStatus(license, nowIso());
  return status === license.status ? license : { ...license, status };
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

  const licenseId = assertEntityId("licenses", lookup.licenseId);
  const license = await getDoc(env, `${entityPath(projectId, "licenses")}/${licenseId}`);
  return license ? normalizeLicenseStatus(license) : null;
}

async function transactionFindLicenseByKey(tx, projectId, licenseKey) {
  const normalizedKey = normalizeLicenseKey(licenseKey);
  if (!normalizedKey) return null;

  const lookupId = await sha256Hex(normalizedKey);
  const lookup = await tx.get(`projects/${projectId}/licenseKeys/${lookupId}`);
  if (!lookup?.licenseId) return null;

  const licenseId = assertEntityId("licenses", lookup.licenseId);
  return await tx.get(`${entityPath(projectId, "licenses")}/${licenseId}`);
}

async function projectExists(env, projectId) {
  return Boolean(await getDoc(env, projectPath(projectId)));
}

function projectSummaryView(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug || "",
    prefix: project.prefix || "",
    description: project.description || "",
    shortDescription: project.shortDescription || "",
    imageUrl: project.imageUrl || "",
    logoUrl: project.logoUrl || "",
    iconUrl: project.iconUrl || "",
    bannerUrl: project.bannerUrl || "",
    tagline: project.tagline || "",
    fullDescription: project.fullDescription || "",
    screenshots: Array.isArray(project.screenshots) ? project.screenshots : [],
    features: Array.isArray(project.features) ? project.features : [],
    requirements: Array.isArray(project.requirements) ? project.requirements : [],
    additionalInfo: project.additionalInfo || "",
    commercialText: project.commercialText || "",
    seoTitle: project.seoTitle || "",
    seoDescription: project.seoDescription || "",
    status: project.status || "inactive",
    publicCatalog: Boolean(project.publicCatalog),
    featured: Boolean(project.featured),
    featuredOrder: Math.max(0, Number(project.featuredOrder ?? project.displayOrder ?? 0)),
    catalogOrder: Math.max(0, Number(project.catalogOrder ?? project.displayOrder ?? 0)),
    displayOrder: Math.max(0, Number(project.displayOrder || 0)),
    trialEnabled: Boolean(project.trialEnabled),
    trialDays: Math.max(0, Number(project.trialDays || 0)),
    offlineDays: Math.max(0, Number(project.offlineDays || 0)),
    validationHours: Math.max(1, Number(project.validationHours || 24)),
    createdAt: project.createdAt || null,
    updatedAt: project.updatedAt || null
  };
}

function projectDetailView(project, admin) {
  const view = projectSummaryView(project);
  const permissions = admin?.permissions || {};
  const canSettings = Boolean(admin?.master || permissions.manageProjectSettings);
  const canTrial = Boolean(admin?.master || permissions.manageTrial || canSettings);
  const canIntegration = Boolean(admin?.master || permissions.viewIntegration);
  const canUsePublicEntitlement = Boolean(
    canIntegration ||
    permissions.manageLicenses ||
    permissions.manageTrial
  );

  if (canSettings || canIntegration) {
    view.allowedOrigins = normalizeAllowedOrigins(project.allowedOrigins || []);
  }

  if (canTrial || canIntegration) {
    view.trialValidationHours = Math.max(1, Number(project.trialValidationHours || project.validationHours || 24));
    view.trialOfflineHours = Math.max(0, Number(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24));
  }

  if (canUsePublicEntitlement) {
    view.integrationCode = project.integrationCode || "";
    view.signingKeyId = project.signingKeyId || null;
    view.signingAlgorithm = project.signingAlgorithm || "ES256";
    view.signingPublicJwk = project.signingPublicJwk || null;
  }

  return view;
}

async function assertAvailableProjectSlug(env, slug, projectId = "") {
  const duplicate = (await listCollection(env, "projects"))
    .find(project => project.id !== projectId && slugify(project.slug) === slug);
  if (duplicate) {
    throw Object.assign(new Error("Este slug já está em uso por outro projeto."), {
      status: 409,
      reason: "project_slug_exists"
    });
  }
}

async function createProject(env, body, admin) {
  body = validateProjectPayload(body);
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("Informe o nome do projeto."), { status: 400 });
  const requestedSlug = slugify(body.slug || name);
  await assertAvailableProjectSlug(env, requestedSlug);

  return await atomicClient(env).runTransaction(async tx => {
    const id = randomId("prj");
    const createdAt = nowIso();
    const validationHours = Math.max(1, Number(body.validationHours || 24));
    const offlineDays = Math.max(0, Number(body.offlineDays ?? 7));
    const trialDays = Math.max(0, Number(body.trialDays || 0));
    const integrationCode = generateIntegrationCode();
    const signing = await generateSigningMaterial();

    const project = {
      name,
      slug: requestedSlug || id,
      prefix: normalizePrefix(body.prefix || name.slice(0, 4)) || "GSS",
      integrationCode,
      description: String(body.description || "").trim(),
      shortDescription: String(body.shortDescription || "").trim(),
      imageUrl: String(body.imageUrl || "").trim(),
      logoUrl: String(body.logoUrl || "").trim(),
      iconUrl: String(body.iconUrl || "").trim(),
      bannerUrl: String(body.bannerUrl || "").trim(),
      tagline: String(body.tagline || "").trim(),
      fullDescription: String(body.fullDescription || "").trim(),
      screenshots: body.screenshots || [],
      features: body.features || [],
      requirements: body.requirements || [],
      additionalInfo: String(body.additionalInfo || "").trim(),
      commercialText: String(body.commercialText || "").trim(),
      seoTitle: String(body.seoTitle || "").trim(),
      seoDescription: String(body.seoDescription || "").trim(),
      status: body.status === "inactive" ? "inactive" : "active",
      publicCatalog: Boolean(body.publicCatalog),
      featured: Boolean(body.featured),
      featuredOrder: Math.max(0, Number(body.featuredOrder ?? body.displayOrder ?? 0)),
      catalogOrder: Math.max(0, Number(body.catalogOrder ?? body.displayOrder ?? 0)),
      displayOrder: Math.max(0, Number(body.displayOrder || 0)),
      allowedOrigins: normalizeAllowedOrigins(body.allowedOrigins || []),
      trialEnabled: Boolean(body.trialEnabled ?? trialDays > 0),
      trialDays,
      trialValidationHours: Math.max(1, Number(body.trialValidationHours || validationHours)),
      trialOfflineHours: Math.max(0, Number(body.trialOfflineHours ?? body.trialValidationHours ?? validationHours)),
      offlineDays,
      validationHours,
      signingKeyId: signing.keyId,
      signingAlgorithm: "ES256",
      signingPublicJwk: signing.publicJwk,
      createdAt,
      updatedAt: createdAt
    };

    const lookupId = await sha256Hex(integrationCode);
    const slugLookupId = await sha256Hex(project.slug);
    tx.create(projectPath(id), project);
    tx.create(`integrationCodes/${lookupId}`, { projectId: id, createdAt });
    tx.create(`catalogSlugs/${slugLookupId}`, { projectId: id, slug: project.slug, createdAt });
    tx.create(`projects/${id}/internal/signing`, signing);
    queueLogInTransaction(
      tx,
      id,
      "project.created",
      { name: project.name, integrationCode },
      admin.email || admin.uid,
      createdAt
    );

    return { id, ...project };
  });
}

async function createPlan(env, projectId, body, admin) {
  body = validatePlanPayload(body);
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("Informe o nome do plano."), { status: 400 });

  return await atomicClient(env).runTransaction(async tx => {
    const id = randomId("plan");
    const createdAt = nowIso();
    const lifetime = Boolean(body.lifetime);
    const requestedDurationDays = body.durationDays == null ? 30 : Number(body.durationDays);
    if (!lifetime && requestedDurationDays < 1) {
      throw Object.assign(
        new Error("Planos temporários precisam ter duração mínima de 1 dia."),
        { status: 400, reason: "invalid_plan_duration" }
      );
    }

    const startMode = ["first_activation", "immediate"].includes(body.startMode)
      ? body.startMode
      : "first_activation";

    const plan = {
      name,
      description: String(body.description || "").trim(),
      price: Math.max(0, Number(body.price || 0)),
      priceCents: moneyToCents(body.price || 0),
      durationDays: lifetime ? 0 : requestedDurationDays,
      lifetime,
      deviceLimit: Math.max(1, Number(body.deviceLimit || 1)),
      startMode,
      active: body.active !== false,
      publicCatalog: Boolean(body.publicCatalog),
      publishedInCatalog: body.publishedInCatalog != null
        ? Boolean(body.publishedInCatalog)
        : Boolean(body.publicCatalog),
      commercialDescription: String(body.commercialDescription || body.description || "").trim(),
      termsVersion: String(body.termsVersion || "").trim(),
      catalogOrder: Math.max(0, Number(body.catalogOrder ?? body.displayOrder ?? 0)),
      displayOrder: Math.max(0, Number(body.displayOrder || 0)),
      createdAt,
      updatedAt: createdAt
    };

    tx.create(`${entityPath(projectId, "plans")}/${id}`, plan);
    queueLogInTransaction(
      tx,
      projectId,
      "plan.created",
      { planId: id, name },
      admin.email || admin.uid,
      createdAt
    );
    return { id, ...plan };
  });
}

async function createCustomer(env, projectId, body, admin) {
  body = validateCustomerPayload(body);
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!name || !email) {
    throw Object.assign(new Error("Informe nome e e-mail do cliente."), { status: 400 });
  }

  return await atomicClient(env).runTransaction(async tx => {
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

    tx.create(`${entityPath(projectId, "customers")}/${id}`, customer);
    queueLogInTransaction(
      tx,
      projectId,
      "customer.created",
      { customerId: id, name, email },
      admin.email || admin.uid,
      createdAt
    );
    return { id, ...customer };
  });
}

async function createLicense(env, projectId, body, admin) {
  body = validateLicenseCreatePayload(body);
  const customerId = assertEntityId("customers", body.customerId);
  const idempotencyHash = body.idempotencyKey
    ? await sha256Hex(body.idempotencyKey)
    : "";
  const requestHash = idempotencyHash
    ? await sha256Hex(JSON.stringify({
        customerId,
        planId: body.planId || "",
        planName: body.planName || "",
        durationDays: body.durationDays ?? null,
        lifetime: body.lifetime ?? null,
        maxDevices: body.maxDevices ?? null,
        startMode: body.startMode || "",
        notes: body.notes || "",
        source: body.source || "admin",
        externalOrderId: body.externalOrderId || ""
      }))
    : "";

  return await atomicClient(env).runTransaction(async tx => {
    const idempotencyPath = idempotencyHash
      ? `projects/${projectId}/licenseRequests/${idempotencyHash}`
      : "";

    if (idempotencyPath) {
      const existingRequest = await tx.get(idempotencyPath);
      if (existingRequest) {
        if (existingRequest.requestHash !== requestHash) {
          throw Object.assign(new Error("A chave de idempotência já foi usada com outro payload."), {
            status: 409,
            reason: "idempotency_conflict"
          });
        }

        const existingLicenseId = assertEntityId("licenses", existingRequest.licenseId);
        const existingLicense = await tx.get(
          `${entityPath(projectId, "licenses")}/${existingLicenseId}`
        );
        if (!existingLicense) {
          throw Object.assign(new Error("Registro idempotente inconsistente."), {
            status: 500,
            reason: "idempotency_orphan"
          });
        }

        return {
          id: existingLicenseId,
          ...existingLicense,
          idempotentReplay: true
        };
      }
    }

    const project = await tx.get(projectPath(projectId));
    if (!project) {
      throw Object.assign(new Error("Projeto não encontrado."), {
        status: 404,
        reason: "project_not_found"
      });
    }
    if (project.status !== "active") {
      throw Object.assign(new Error("Novas licenças só podem ser emitidas para projeto ativo."), {
        status: 409,
        reason: "project_not_active"
      });
    }

    const customer = await tx.get(`${entityPath(projectId, "customers")}/${customerId}`);
    if (!customer) {
      throw Object.assign(new Error("Cliente não encontrado."), {
        status: 404,
        reason: "customer_not_found"
      });
    }
    if (customer.status === "inactive") {
      throw Object.assign(new Error("Cliente inativo não pode receber nova licença."), {
        status: 409,
        reason: "customer_inactive"
      });
    }

    let plan = null;
    if (body.planId) {
      const planId = assertEntityId("plans", body.planId);
      plan = await tx.get(`${entityPath(projectId, "plans")}/${planId}`);
      if (!plan) {
        throw Object.assign(new Error("Plano não encontrado."), {
          status: 404,
          reason: "plan_not_found"
        });
      }
      if (plan.active === false) {
        throw Object.assign(new Error("Plano inativo não pode gerar nova licença."), {
          status: 409,
          reason: "plan_inactive"
        });
      }
    }

    const id = randomId("lic");
    const createdAt = nowIso();
    const selectedPlan = plan || {
      id: "",
      name: String(body.planName || "Personalizada"),
      lifetime: Boolean(body.lifetime),
      durationDays: body.durationDays || 30,
      deviceLimit: body.maxDevices || 1,
      startMode: body.startMode || "first_activation"
    };
    const result = await issueLicenseInTransaction({
      tx,
      project,
      projectId,
      customer,
      customerId,
      plan: selectedPlan,
      now: createdAt,
      source: String(body.source || "admin"),
      externalOrderId: String(body.externalOrderId || ""),
      notes: body.notes,
      id,
      key: generateLicenseKey(project.prefix),
      hashLicenseKey: value => sha256Hex(normalizeLicenseKey(value)),
      plusDays,
      queueLog: queueLogInTransaction,
      actor: admin?.email || admin?.uid || "admin"
    });

    if (idempotencyPath) {
      tx.create(idempotencyPath, {
        licenseId: id,
        requestHash,
        source: result.source,
        externalOrderId: result.externalOrderId,
        createdAt
      });
    }

    return { ...result, idempotentReplay: false };
  });
}

async function updateEntity(env, projectId, entity, id, body, admin) {
  const path = `${entityPath(projectId, entity)}/${id}`;
  const clean = entity === "plans"
    ? validatePlanPayload(body, { partial: true })
    : validateCustomerPayload(body, { partial: true });

  return await atomicClient(env).runTransaction(async tx => {
    const current = await tx.get(path);
    if (!current) {
      throw Object.assign(new Error("Registro não encontrado."), { status: 404 });
    }

    if (entity === "plans") {
      if ("price" in clean) {
        clean.price = Math.max(0, Number(clean.price || 0));
        clean.priceCents = moneyToCents(clean.price);
      }
      if ("deviceLimit" in clean) clean.deviceLimit = Math.max(1, Number(clean.deviceLimit || 1));
      if ("startMode" in clean && !["first_activation", "immediate"].includes(clean.startMode)) {
        clean.startMode = "first_activation";
      }
      if ("publicCatalog" in clean) clean.publicCatalog = Boolean(clean.publicCatalog);
      if ("publishedInCatalog" in clean) {
        clean.publishedInCatalog = Boolean(clean.publishedInCatalog);
        clean.publicCatalog = clean.publishedInCatalog;
      }

      const nextLifetime = "lifetime" in clean ? Boolean(clean.lifetime) : Boolean(current.lifetime);
      if (nextLifetime) {
        clean.durationDays = 0;
      } else {
        if (
          current.lifetime === true &&
          clean.lifetime === false &&
          !("durationDays" in clean)
        ) {
          throw Object.assign(
            new Error("Informe a duração em dias ao converter um plano vitalício em temporário."),
            { status: 400, reason: "invalid_plan_duration" }
          );
        }

        if ("durationDays" in clean && Number(clean.durationDays) < 1) {
          throw Object.assign(
            new Error("Planos temporários precisam ter duração mínima de 1 dia."),
            { status: 400, reason: "invalid_plan_duration" }
          );
        }
      }
    }

    const saved = { ...current, ...clean, updatedAt: nowIso() };
    tx.set(path, saved);
    queueLogInTransaction(
      tx,
      projectId,
      `${entity.slice(0, -1)}.updated`,
      { id },
      admin.email || admin.uid,
      saved.updatedAt
    );

    return { id, ...saved };
  });
}

async function licenseAction(env, projectId, licenseId, action, body, admin) {
  body = validateLicenseActionPayload(action, body);
  const path = `${entityPath(projectId, "licenses")}/${licenseId}`;

  return await atomicClient(env).runTransaction(async tx => {
    const current = await tx.get(path);
    if (!current) {
      throw Object.assign(new Error("Licença não encontrada."), {
        status: 404,
        reason: "license_not_found"
      });
    }

    const now = nowIso();
    const result = transitionLicense(current, action, body, now, plusDays);

    if (!result.changed) {
      return normalizeLicenseStatus({ id: licenseId, ...result.license });
    }

    tx.set(path, result.license);
    queueLogInTransaction(
      tx,
      projectId,
      result.event,
      {
        licenseId,
        ...body,
        previousStatus: current.status,
        nextStatus: result.license.status
      },
      admin.email || admin.uid,
      now
    );

    return normalizeLicenseStatus({ id: licenseId, ...result.license });
  });
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
  let validationsToday = 0;
  let deactivationsToday = 0;
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

    const activity = summarizeActivity(activations, todayInBrazil, today);
    activationsToday += activity.activations;
    validationsToday += activity.revalidations;
    deactivationsToday += activity.deactivations;

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
    validationsToday,
    deactivationsToday,
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
    renewalDaysTotal: Number(license.renewalDaysTotal || 0),
    renewalCount: Number(license.renewalCount || 0),
    totalTermDays: license.lifetime ? 0 : totalActivationDays(license),
    lifetime: Boolean(license.lifetime),
    maxDevices: Number(license.maxDevices || 1),
    offlineDays: Number(project.offlineDays || 0),
    validationHours: Number(project.validationHours || 24),
    serverTime: nowIso(),
    ...extra
  };
}

async function publicActivate(env, body, origin = "") {
  body = validatePublicLicensePayload(body);
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!licenseKey || !deviceId) {
    throw Object.assign(new Error("licenseKey e deviceId são obrigatórios."), {
      status: 400,
      reason: "invalid_request"
    });
  }

  const deviceHash = await sha256Hex(deviceId);
  const outcome = await atomicClient(env).runTransaction(async tx => {
    let license = await transactionFindLicenseByKey(tx, projectId, licenseKey);
    if (!license) {
      throw Object.assign(new Error("Licença inválida."), {
        status: 404,
        reason: "license_invalid"
      });
    }

    const now = nowIso();
    const licensePath = `projects/${projectId}/licenses/${license.id}`;
    const effectiveStatus = effectiveLicenseStatus(license, now);

    if (effectiveStatus === "expired") {
      if (license.status !== "expired") {
        tx.set(licensePath, {
          ...license,
          status: "expired",
          updatedAt: now
        });
      }
      return { expired: true };
    }

    assertLicenseCanActivate({ ...license, status: effectiveStatus }, now);

    const devicePath = `projects/${projectId}/devices/${deviceHash}`;
    const trialPath = `projects/${projectId}/trials/${deviceHash}`;

    const existingDevice = await tx.get(devicePath);
    const devicesForLicense = await tx.queryByField(
      `projects/${projectId}`,
      "devices",
      "licenseId",
      license.id
    );
    const existingTrial = await tx.get(trialPath);

    const activeDevices = devicesForLicense.filter(device => device.active !== false);
    const sameActiveDevice = Boolean(
      existingDevice?.active &&
      existingDevice.licenseId === license.id
    );
    const activeOtherLicense = Boolean(
      existingDevice?.active &&
      existingDevice.licenseId &&
      existingDevice.licenseId !== license.id
    );

    if (activeOtherLicense) {
      throw Object.assign(
        new Error("Este dispositivo está ativo em outra licença. Desative-o antes de reutilizar o mesmo Device ID."),
        {
          status: 409,
          reason: "device_bound_to_other_license",
          details: { previousLicenseId: existingDevice.licenseId }
        }
      );
    }

    if (!sameActiveDevice && activeDevices.length >= Number(license.maxDevices || 1)) {
      throw Object.assign(new Error("Limite de dispositivos atingido."), {
        status: 409,
        reason: "device_limit"
      });
    }

    if (license.status === "pending") {
      license = {
        ...license,
        status: "active",
        activatedAt: now,
        expiresAt: license.lifetime ? null : plusDays(now, totalActivationDays(license)),
        updatedAt: now
      };
      tx.set(licensePath, license);
    }

    const sameLicenseBefore = existingDevice?.licenseId === license.id;
    const reboundFromLicense = Boolean(
      existingDevice &&
      existingDevice.active === false &&
      existingDevice.licenseId &&
      existingDevice.licenseId !== license.id
    );

    tx.set(devicePath, {
      ...(existingDevice || {}),
      licenseId: license.id,
      customerId: license.customerId,
      deviceHash,
      name: String(body.deviceName || existingDevice?.name || "Dispositivo").trim(),
      platform: String(body.platform || existingDevice?.platform || "").trim(),
      appVersion: String(body.appVersion || existingDevice?.appVersion || "").trim(),
      active: true,
      firstActivatedAt: sameLicenseBefore
        ? (existingDevice?.firstActivatedAt || now)
        : now,
      lastSeenAt: now,
      deactivatedAt: null,
      updatedAt: now
    });

    if (!sameActiveDevice) {
      const activationId = randomId("act");
      const activationType = sameLicenseBefore
        ? "reactivate_device"
        : (reboundFromLicense ? "rebind_license" : "activate");

      tx.create(`projects/${projectId}/activations/${activationId}`, {
        licenseId: license.id,
        customerId: license.customerId,
        deviceHash,
        type: activationType,
        requestId: body.requestId || null,
        createdAt: now
      });

      queueLogInTransaction(
        tx,
        projectId,
        reboundFromLicense ? "device.license_rebound" : "license.activated",
        {
          licenseId: license.id,
          previousLicenseId: reboundFromLicense ? existingDevice.licenseId : null,
          deviceHash,
          activationType,
          requestId: body.requestId || null
        },
        "api",
        now
      );
    }

    if (existingTrial && !["expired", "converted"].includes(existingTrial.status)) {
      tx.set(trialPath, {
        ...existingTrial,
        status: "converted",
        convertedAt: now,
        convertedLicenseId: license.id,
        lastSeenAt: now,
        updatedAt: now
      });

      queueLogInTransaction(
        tx,
        projectId,
        "trial.converted",
        { deviceHash, licenseId: license.id },
        "api",
        now
      );
    }

    return {
      expired: false,
      license,
      activeDevices: sameActiveDevice ? activeDevices.length : activeDevices.length + 1,
      activationPerformed: !sameActiveDevice,
      alreadyActive: sameActiveDevice,
      serverTime: now
    };
  });

  if (outcome.expired) {
    throw Object.assign(new Error("Licença expirada."), {
      status: 403,
      reason: "expired"
    });
  }

  const view = publicLicenseView(project, outcome.license, {
    activeDevices: outcome.activeDevices,
    activationPerformed: outcome.activationPerformed,
    alreadyActive: outcome.alreadyActive,
    serverTime: outcome.serverTime
  });
  return await attachSignedEntitlement(env, project, view, deviceHash);
}

async function publicValidate(env, body, origin = "") {
  body = validatePublicLicensePayload(body);
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!licenseKey || !deviceId) {
    throw Object.assign(new Error("licenseKey e deviceId são obrigatórios."), {
      status: 400,
      reason: "invalid_request"
    });
  }

  const deviceHash = await sha256Hex(deviceId);
  const outcome = await atomicClient(env).runTransaction(async tx => {
    const license = await transactionFindLicenseByKey(tx, projectId, licenseKey);
    if (!license) {
      throw Object.assign(new Error("Licença inválida."), {
        status: 404,
        reason: "license_invalid"
      });
    }

    const now = nowIso();
    const licensePath = `projects/${projectId}/licenses/${license.id}`;
    const effectiveStatus = effectiveLicenseStatus(license, now);

    if (effectiveStatus === "expired") {
      if (license.status !== "expired") {
        tx.set(licensePath, {
          ...license,
          status: "expired",
          updatedAt: now
        });
      }
      return { expired: true };
    }

    if (["revoked", "suspended", "pending"].includes(effectiveStatus)) {
      throw Object.assign(new Error(`Licença ${effectiveStatus}.`), {
        status: 403,
        reason: effectiveStatus
      });
    }

    const devicePath = `projects/${projectId}/devices/${deviceHash}`;
    const device = await tx.get(devicePath);
    if (!device || device.licenseId !== license.id || device.active === false) {
      throw Object.assign(new Error("Dispositivo não autorizado."), {
        status: 403,
        reason: "device_not_authorized"
      });
    }

    const validation = validationMutation(device, body.requestId, now);

    tx.set(devicePath, {
      ...device,
      ...validation.patch,
      lastSeenAt: now,
      appVersion: String(body.appVersion || device.appVersion || "").trim(),
      updatedAt: now
    });

    if (!validation.replay) {
      const activationId = randomId("act");
      tx.create(`projects/${projectId}/activations/${activationId}`, {
        licenseId: license.id,
        customerId: license.customerId,
        deviceHash,
        type: "revalidate",
        requestId: body.requestId || null,
        createdAt: now
      });
    }

    return {
      expired: false,
      license,
      serverTime: now,
      revalidationReplay: validation.replay,
      validationCount: validation.validationCount
    };
  });

  if (outcome.expired) {
    throw Object.assign(new Error("Licença expirada."), {
      status: 403,
      reason: "expired"
    });
  }

  const view = publicLicenseView(project, outcome.license, {
    serverTime: outcome.serverTime,
    revalidationReplay: outcome.revalidationReplay,
    validationCount: outcome.validationCount
  });
  return await attachSignedEntitlement(env, project, view, deviceHash);
}

async function publicDeactivate(env, body, origin = "") {
  body = validatePublicLicensePayload(body);
  const { projectId } = await resolvePublicProject(env, body, origin);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const deviceId = String(body.deviceId || "");
  if (!licenseKey || !deviceId) {
    throw Object.assign(new Error("licenseKey e deviceId são obrigatórios."), {
      status: 400,
      reason: "invalid_request"
    });
  }

  const deviceHash = await sha256Hex(deviceId);
  const outcome = await atomicClient(env).runTransaction(async tx => {
    const license = await transactionFindLicenseByKey(tx, projectId, licenseKey);
    if (!license) {
      throw Object.assign(new Error("Licença inválida."), {
        status: 404,
        reason: "license_invalid"
      });
    }

    const path = `projects/${projectId}/devices/${deviceHash}`;
    const device = await tx.get(path);
    if (!device || device.licenseId !== license.id) {
      throw Object.assign(new Error("Dispositivo não autorizado para esta licença."), {
        status: 403,
        reason: "device_not_authorized"
      });
    }

    if (device.active === false) {
      return { alreadyInactive: true, serverTime: nowIso() };
    }

    const now = nowIso();
    tx.set(path, {
      ...device,
      active: false,
      deactivatedAt: now,
      updatedAt: now
    });

    const activationId = randomId("act");
    tx.create(`projects/${projectId}/activations/${activationId}`, {
      licenseId: license.id,
      customerId: license.customerId,
      deviceHash,
      type: "deactivate",
      createdAt: now
    });

    queueLogInTransaction(
      tx,
      projectId,
      "device.deactivated",
      { licenseId: license.id, deviceHash },
      "api",
      now
    );

    return { alreadyInactive: false, serverTime: now };
  });

  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    deactivated: true,
    alreadyInactive: Boolean(outcome.alreadyInactive),
    serverTime: outcome.serverTime
  };
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
    validationCount: Math.max(0, Number(trial.validationCount || 0)),
    lastValidatedAt: trial.lastValidatedAt || null,
    serverTime: now,
    ...extra
  };
}

async function publicProjectConfig(env, body, origin = "") {
  body = validatePublicProjectPayload(body);
  const { project } = await resolvePublicProject(env, body, origin);
  return publicProjectConfigView(project);
}

async function publicTrialStart(env, body, origin = "") {
  body = validatePublicTrialPayload(body);
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) {
    throw Object.assign(new Error("deviceId é obrigatório para iniciar o trial."), {
      status: 400,
      reason: "invalid_request"
    });
  }

  const deviceHash = await sha256Hex(deviceId);
  const path = `projects/${projectId}/trials/${deviceHash}`;
  const devicePath = `projects/${projectId}/devices/${deviceHash}`;

  const outcome = await atomicClient(env).runTransaction(async tx => {
    let trial = await tx.get(path);
    const licensedDevice = await tx.get(devicePath);
    const now = nowIso();

    if (licensedDevice?.licenseId) {
      const licenseId = assertEntityId("licenses", licensedDevice.licenseId);

      if (trial && trial.status !== "converted") {
        trial = {
          ...trial,
          status: "converted",
          convertedAt: trial.convertedAt || now,
          convertedLicenseId: licenseId,
          lastSeenAt: now,
          updatedAt: now
        };
        tx.set(path, trial);
        queueLogInTransaction(
          tx,
          projectId,
          "trial.converted",
          { deviceHash, licenseId, recoveredFromDeviceBinding: true },
          "api",
          now
        );
      }

      return {
        blockedByLicense: true,
        trial,
        licenseId
      };
    }

    if (trial) {
      if (trial.status === "converted") {
        throw Object.assign(new Error("Este trial foi convertido em licença paga."), {
          status: 403,
          reason: "trial_converted",
          details: {
            convertedAt: trial.convertedAt || null,
            licenseId: trial.convertedLicenseId || null
          }
        });
      }

      if (isPast(trial.expiresAt) || trial.status === "expired") {
        if (trial.status !== "expired") {
          trial = {
            ...trial,
            status: "expired",
            lastSeenAt: now,
            updatedAt: now
          };
          tx.set(path, trial);
          queueLogInTransaction(
            tx,
            projectId,
            "trial.expired",
            { deviceHash, expiresAt: trial.expiresAt },
            "api",
            now
          );
        }
        return { expired: true, trial };
      }

      trial = {
        ...trial,
        lastSeenAt: now,
        deviceName: String(body.deviceName || trial.deviceName || "Dispositivo").trim(),
        platform: String(body.platform || trial.platform || "").trim(),
        appVersion: String(body.appVersion || trial.appVersion || "").trim(),
        updatedAt: now
      };
      tx.set(path, trial);
      return { expired: false, firstStart: false, trial };
    }

    if (!project.trialEnabled || Number(project.trialDays || 0) <= 0) {
      throw Object.assign(new Error("Este projeto não oferece avaliação gratuita."), {
        status: 403,
        reason: "trial_unavailable"
      });
    }

    const durationDays = Math.max(1, Number(project.trialDays || 0));
    trial = {
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
      validationCount: 0,
      lastValidatedAt: null,
      lastValidationRequestId: null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    };

    tx.create(path, trial);
    queueLogInTransaction(
      tx,
      projectId,
      "trial.started",
      { deviceHash, durationDays, expiresAt: trial.expiresAt },
      "api",
      now
    );

    return { expired: false, firstStart: true, trial };
  });

  if (outcome.blockedByLicense) {
    throw Object.assign(new Error("Este dispositivo já foi vinculado a uma licença paga e não pode iniciar um trial."), {
      status: 403,
      reason: "trial_converted",
      details: {
        convertedAt: outcome.trial?.convertedAt || null,
        licenseId: outcome.licenseId
      }
    });
  }

  if (outcome.expired) {
    throw Object.assign(new Error("O período de avaliação deste dispositivo já expirou."), {
      status: 403,
      reason: "trial_expired",
      details: {
        startedAt: outcome.trial.startedAt,
        expiresAt: outcome.trial.expiresAt
      }
    });
  }

  return await attachSignedEntitlement(
    env,
    project,
    publicTrialView(project, outcome.trial, { firstStart: outcome.firstStart }),
    deviceHash
  );
}

async function publicTrialValidate(env, body, origin = "") {
  body = validatePublicTrialPayload(body);
  const { projectId, project } = await resolvePublicProject(env, body, origin);
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) {
    throw Object.assign(new Error("deviceId é obrigatório para validar o trial."), {
      status: 400,
      reason: "invalid_request"
    });
  }

  const deviceHash = await sha256Hex(deviceId);
  const path = `projects/${projectId}/trials/${deviceHash}`;

  const outcome = await atomicClient(env).runTransaction(async tx => {
    let trial = await tx.get(path);
    if (!trial) {
      throw Object.assign(new Error("Nenhum trial foi iniciado para este dispositivo."), {
        status: 404,
        reason: "trial_not_started"
      });
    }

    const now = nowIso();

    if (trial.status === "converted") {
      throw Object.assign(new Error("Este trial foi convertido em licença paga."), {
        status: 403,
        reason: "trial_converted",
        details: {
          convertedAt: trial.convertedAt || null,
          licenseId: trial.convertedLicenseId || null
        }
      });
    }

    if (isPast(trial.expiresAt) || trial.status === "expired") {
      if (trial.status !== "expired") {
        trial = {
          ...trial,
          status: "expired",
          lastSeenAt: now,
          updatedAt: now
        };
        tx.set(path, trial);
        queueLogInTransaction(
          tx,
          projectId,
          "trial.expired",
          { deviceHash, expiresAt: trial.expiresAt },
          "api",
          now
        );
      }
      return { expired: true, trial };
    }

    const validation = validationMutation(trial, body.requestId, now);
    trial = {
      ...trial,
      ...validation.patch,
      lastSeenAt: now,
      appVersion: String(body.appVersion || trial.appVersion || "").trim(),
      updatedAt: now
    };
    tx.set(path, trial);
    return {
      expired: false,
      trial,
      revalidationReplay: validation.replay,
      validationCount: validation.validationCount
    };
  });

  if (outcome.expired) {
    throw Object.assign(new Error("O período de avaliação expirou."), {
      status: 403,
      reason: "trial_expired",
      details: {
        startedAt: outcome.trial.startedAt,
        expiresAt: outcome.trial.expiresAt
      }
    });
  }

  return await attachSignedEntitlement(
    env,
    project,
    publicTrialView(project, outcome.trial, {
      revalidationReplay: outcome.revalidationReplay,
      validationCount: outcome.validationCount
    }),
    deviceHash
  );
}

function compareCatalogItems(a, b, idField = "id") {
  return (
    Number(a.catalogOrder ?? a.displayOrder ?? 0) - Number(b.catalogOrder ?? b.displayOrder ?? 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "pt-BR") ||
    String(a[idField] || "").localeCompare(String(b[idField] || ""))
  );
}

function catalogNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function catalogImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function publicCatalogPlanView(plan) {
  const priceCents = planPriceCents(plan);
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description || "",
    commercialDescription: plan.commercialDescription || plan.description || "",
    termsVersion: plan.termsVersion || "",
    price: priceCents / 100,
    durationDays: catalogNonNegativeNumber(plan.durationDays),
    lifetime: Boolean(plan.lifetime),
    deviceLimit: Math.max(1, catalogNonNegativeNumber(plan.deviceLimit, 1)),
    startMode: plan.startMode || "first_activation",
    catalogOrder: catalogNonNegativeNumber(plan.catalogOrder ?? plan.displayOrder),
    displayOrder: catalogNonNegativeNumber(plan.displayOrder)
  };
}

function publicCatalogProjectView(project, plans) {
  return {
    projectId: project.id,
    integrationCode: project.integrationCode,
    name: project.name,
    slug: project.slug,
    prefix: project.prefix,
    description: project.description || "",
    shortDescription: project.shortDescription || "",
    tagline: project.tagline || "",
    fullDescription: project.fullDescription || project.description || "",
    commercialText: project.commercialText || "",
    additionalInfo: project.additionalInfo || "",
    features: Array.isArray(project.features) ? project.features : [],
    requirements: Array.isArray(project.requirements) ? project.requirements : [],
    screenshots: (Array.isArray(project.screenshots) ? project.screenshots : []).map(catalogImageUrl).filter(Boolean),
    imageUrl: catalogImageUrl(project.imageUrl),
    logoUrl: catalogImageUrl(project.logoUrl || project.imageUrl),
    iconUrl: catalogImageUrl(project.iconUrl || project.imageUrl),
    bannerUrl: catalogImageUrl(project.bannerUrl || project.imageUrl),
    seoTitle: project.seoTitle || "",
    seoDescription: project.seoDescription || "",
    featured: Boolean(project.featured),
    featuredOrder: catalogNonNegativeNumber(project.featuredOrder ?? project.displayOrder),
    catalogOrder: catalogNonNegativeNumber(project.catalogOrder ?? project.displayOrder),
    displayOrder: catalogNonNegativeNumber(project.displayOrder),
    trial: {
      enabled: Boolean(project.trialEnabled && Number(project.trialDays || 0) > 0),
      days: catalogNonNegativeNumber(project.trialDays)
    },
    plans
  };
}

function planPublishedInCatalog(plan) {
  return plan.publishedInCatalog === true ||
    (plan.publishedInCatalog == null && plan.publicCatalog === true);
}

async function catalogProjectCandidate(env, project) {
  project = await ensureProjectIntegrationCode(env, project);
  const plans = (await listCollection(env, `projects/${project.id}/plans`))
    .filter(plan => plan.active !== false && planPublishedInCatalog(plan))
    .map(publicCatalogPlanView)
    .sort((a, b) => compareCatalogItems(a, b));
  return publicCatalogProjectView(project, plans);
}

async function publicCatalog(env) {
  const projects = (await listCollection(env, "projects"))
    .filter(project => project.status === "active");

  const items = [];
  for (const project of projects) {
    const candidate = await catalogProjectCandidate(env, project);
    if (candidate.plans.length) items.push(candidate);
  }
  items.sort((a, b) => compareCatalogItems(a, b, "projectId"));
  return { protocolVersion: PROTOCOL_VERSION, projects: items, serverTime: nowIso() };
}

async function publicCatalogProject(env, slug) {
  const normalized = slugify(slug);
  if (!normalized || normalized !== slug) {
    throw Object.assign(new Error("Programa não encontrado."), { status: 404, reason: "catalog_project_not_found" });
  }
  const catalog = await publicCatalog(env);
  const project = catalog.projects.find(item => item.slug === normalized);
  if (!project) {
    throw Object.assign(new Error("Programa não encontrado."), { status: 404, reason: "catalog_project_not_found" });
  }
  return project;
}

const PAYMENT_SETTINGS_PATH = "platformSettings/payments";

function runtimePaymentProvider(env) {
  return String(env.PAYMENT_PROVIDER || MANUAL_PIX_PROVIDER).trim().toLowerCase();
}

function pagBankEnabled(env) {
  return runtimePaymentProvider(env) === "pagbank" &&
    String(env.PAGBANK_ENABLED || "false").trim().toLowerCase() === "true";
}

function paymentSettingsInput(value = {}) {
  return Object.fromEntries(
    Object.keys(DEFAULT_PAYMENT_SETTINGS).map(key => [
      key,
      value[key] === undefined ? DEFAULT_PAYMENT_SETTINGS[key] : value[key]
    ])
  );
}

async function getPaymentSettings(env) {
  const stored = await getDoc(env, PAYMENT_SETTINGS_PATH);
  return validatePaymentSettings(paymentSettingsInput(stored || {}));
}

async function updatePaymentSettings(env, rawBody, admin) {
  const settings = validatePaymentSettings(rawBody);
  const timestamp = nowIso();
  const current = await getDoc(env, PAYMENT_SETTINGS_PATH);
  const record = {
    ...settings,
    createdAt: current?.createdAt || timestamp,
    updatedAt: timestamp,
    updatedByAdminUid: admin.uid
  };
  await setDoc(env, PAYMENT_SETTINGS_PATH, record);
  await writePlatformLog(env, "payment_settings_updated", {
    paymentProvider: settings.paymentProvider,
    pixEnabled: settings.pixEnabled,
    pixKeyType: settings.pixKeyType,
    manualConfirmationEnabled: settings.manualConfirmationEnabled
  }, admin.uid);
  return settings;
}

function assertManualPixOperational(env, settings) {
  if (runtimePaymentProvider(env) !== MANUAL_PIX_PROVIDER || pagBankEnabled(env)) {
    throw Object.assign(new Error("PIX manual não é o provider ativo."), {
      status: 503,
      reason: "manual_pix_not_active"
    });
  }
  if (settings.paymentProvider !== MANUAL_PIX_PROVIDER || !settings.pixEnabled) {
    throw Object.assign(new Error("Pagamento PIX está temporariamente indisponível."), {
      status: 503,
      reason: "manual_pix_disabled"
    });
  }
}

async function nextOrderNumberInTransaction(tx) {
  const path = "counters/orders";
  const counter = await tx.get(path);
  const current = Number(counter?.value || 0);
  if (!Number.isSafeInteger(current) || current < 0 || current >= 999_999_999) {
    throw Object.assign(new Error("Contador de pedidos inválido."), { status: 500, reason: "order_counter_invalid" });
  }
  const value = current + 1;
  const record = { value, updatedAt: nowIso() };
  counter ? tx.set(path, record) : tx.create(path, record);
  return `GS-${String(value).padStart(6, "0")}`;
}

function customerAccountView(account) {
  return {
    accountId: account.id || account.accountId,
    email: account.email || "",
    emailVerified: Boolean(account.emailVerified),
    displayName: account.displayName || "",
    phone: account.phone || "",
    taxId: account.taxId || "",
    postalCode: account.postalCode || "",
    street: account.street || "",
    number: account.number || "",
    complement: account.complement || "",
    neighborhood: account.neighborhood || "",
    city: account.city || "",
    state: account.state || "",
    photoUrl: account.photoUrl || "",
    profileComplete: customerProfileComplete(account),
    status: account.status || "active",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function customerOrderView(order) {
  const { firebaseUid: _uid, idempotencyKey: _key, ...safe } = order;
  return safe;
}

async function ensureCustomerAccount(env, user) {
  if (!user.email) throw Object.assign(new Error("A conta precisa possuir um e-mail."), { status: 403, reason: "email_required" });
  const accountId = `acct_${(await sha256Hex(user.uid)).slice(0, 20)}`;
  return await atomicClient(env).runTransaction(async tx => {
    const path = `customerAccounts/${accountId}`;
    const current = await tx.get(path);
    if (current && current.firebaseUid !== user.uid) {
      throw Object.assign(new Error("Identidade global inconsistente."), { status: 403, reason: "account_identity_mismatch" });
    }
    if (current?.status === "blocked") {
      throw Object.assign(new Error("Esta conta está bloqueada para compras."), { status: 403, reason: "account_blocked" });
    }
    const normalizedEmail = String(user.email).toLowerCase();
    const displayName = current?.displayName || user.name || "";
    if (
      current &&
      current.firebaseUid === user.uid &&
      current.email === normalizedEmail &&
      current.emailVerified === Boolean(user.emailVerified) &&
      current.displayName === displayName
    ) {
      return { id: accountId, ...current };
    }

    const now = nowIso();
    const account = {
      ...(current || {}),
      accountId,
      firebaseUid: user.uid,
      email: normalizedEmail,
      emailVerified: Boolean(user.emailVerified),
      displayName,
      phone: current?.phone || "",
      taxId: current?.taxId || "",
      postalCode: current?.postalCode || "",
      street: current?.street || "",
      number: current?.number || "",
      complement: current?.complement || "",
      neighborhood: current?.neighborhood || "",
      city: current?.city || "",
      state: current?.state || "",
      photoUrl: current?.photoUrl || user.picture || "",
      photoStoragePath: current?.photoStoragePath || "",
      status: current?.status || "active",
      createdAt: current?.createdAt || now,
      updatedAt: now
    };
    current ? tx.set(path, account) : tx.create(path, account);
    return { id: accountId, ...account };
  });
}

export async function lookupBrazilianPostalCode(value, fetchImpl = fetch) {
  const postalCode = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(postalCode)) {
    throw Object.assign(new Error("Informe um CEP válido."), { status: 400, reason: "invalid_postal_code" });
  }
  const response = await fetchWithTimeout(
    `https://viacep.com.br/ws/${postalCode}/json/`,
    { headers: { Accept: "application/json", "User-Agent": "GuiaSys-Licensing/2.1" } },
    5_000,
    fetchImpl
  );
  if (!response.ok) {
    throw Object.assign(new Error("Serviço de CEP temporariamente indisponível."), { status: 502, reason: "upstream_error" });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("Resposta inválida do serviço de CEP."), { status: 502, reason: "upstream_error" });
  }
  if (payload?.erro === true || payload?.erro === "true") {
    throw Object.assign(new Error("CEP não encontrado."), { status: 404, reason: "postal_code_not_found" });
  }
  const clean = (field, max) => String(payload?.[field] || "").trim().slice(0, max);
  const state = clean("uf", 2).toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) {
    throw Object.assign(new Error("Resposta inválida do serviço de CEP."), { status: 502, reason: "upstream_error" });
  }
  return {
    postalCode,
    street: clean("logradouro", 160),
    neighborhood: clean("bairro", 100),
    city: clean("localidade", 100),
    state
  };
}

async function updateCustomerProfile(env, account, rawBody) {
  if ("photoUrl" in rawBody || "photoStoragePath" in rawBody) {
    throw Object.assign(new Error("Use a rota de upload para alterar a foto."), { status: 400, reason: "invalid_request" });
  }
  const body = validateCustomerProfilePayload(rawBody);
  const next = { ...account, ...body, updatedAt: nowIso() };
  delete next.id;
  await setDoc(env, `customerAccounts/${account.id}`, next);
  return { id: account.id, ...next };
}

async function getCustomerCart(env, accountId) {
  const stored = await getDoc(env, `customerAccounts/${accountId}/state/cart`);
  return { items: Array.isArray(stored?.items) ? stored.items : [], updatedAt: stored?.updatedAt || null };
}

async function saveCustomerCart(env, accountId, rawBody) {
  const cart = validateCartPayload(rawBody);
  const record = { ...cart, updatedAt: nowIso() };
  await setDoc(env, `customerAccounts/${accountId}/state/cart`, record);
  return record;
}

async function listCustomerFavorites(env, accountId) {
  const items = await listCollection(env, `customerAccounts/${accountId}/favorites`);
  return items.map(item => item.projectId || item.id).filter(Boolean);
}

async function addCustomerFavorite(env, accountId, projectId) {
  projectId = assertProjectId(projectId);
  const project = (await publicCatalog(env)).projects.find(item => item.projectId === projectId);
  if (!project) throw Object.assign(new Error("Programa não encontrado."), { status: 404, reason: "catalog_project_not_found" });
  const record = { projectId, createdAt: nowIso() };
  await setDoc(env, `customerAccounts/${accountId}/favorites/${projectId}`, record);
  return record;
}

async function uploadCustomerPhoto(env, account, request) {
  const body = validateMediaPayload(await readJsonBody(request, MAX_MEDIA_JSON_BYTES), { maxBytes: 2 * 1024 * 1024 });
  if (typeof env.__services?.uploadStorageObject !== "function") {
    throw Object.assign(new Error("Upload indisponível neste runtime."), { status: 503, reason: "storage_unavailable" });
  }
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[body.contentType];
  const path = `profiles/${assertSafePathSegment(account.firebaseUid, "uid")}/avatar-${crypto.randomUUID()}.${extension}`;
  const bytes = Uint8Array.from(atob(body.dataBase64), character => character.charCodeAt(0));
  const uploaded = await env.__services.uploadStorageObject(path, { bytes, contentType: body.contentType });
  const next = { ...account, photoUrl: uploaded.url, photoStoragePath: uploaded.path, updatedAt: nowIso() };
  delete next.id;
  await setDoc(env, `customerAccounts/${account.id}`, next);
  if (account.photoStoragePath && account.photoStoragePath !== uploaded.path && typeof env.__services.deleteStorageObject === "function") {
    await env.__services.deleteStorageObject(account.photoStoragePath).catch(() => {});
  }
  return { account: { id: account.id, ...next }, upload: uploaded };
}

async function removeCustomerPhoto(env, account) {
  if (account.photoStoragePath && typeof env.__services?.deleteStorageObject === "function") {
    await env.__services.deleteStorageObject(account.photoStoragePath);
  }
  const next = { ...account, photoUrl: "", photoStoragePath: "", updatedAt: nowIso() };
  delete next.id;
  await setDoc(env, `customerAccounts/${account.id}`, next);
  return { id: account.id, ...next };
}

async function projectCustomerIdentity(accountId, projectId) {
  return `cus_${(await sha256Hex(`${accountId}|${projectId}`)).slice(0, 20)}`;
}

async function ensureProjectCustomerInTransaction(tx, account, projectId, now) {
  const mappingPath = `customerAccounts/${account.id}/projectCustomers/${projectId}`;
  const mapping = await tx.get(mappingPath);
  const customerId = mapping?.customerId || await projectCustomerIdentity(account.id, projectId);
  const customerPath = `projects/${projectId}/customers/${customerId}`;
  const customer = await tx.get(customerPath);
  if (mapping && mapping.customerId !== customerId) {
    throw Object.assign(new Error("Vínculo de cliente inconsistente."), { status: 500, reason: "customer_mapping_inconsistent" });
  }
  const record = customer || {
    name: account.displayName || account.email,
    email: account.email,
    phone: account.phone || "",
    notes: "Criado automaticamente pelo comércio.",
    status: "active",
    accountId: account.id,
    createdAt: now,
    updatedAt: now
  };
  if (customer?.accountId && customer.accountId !== account.id) {
    throw Object.assign(new Error("Cliente de projeto pertence a outra conta."), { status: 403, reason: "customer_ownership_mismatch" });
  }
  if (!customer) tx.create(customerPath, record);
  if (!mapping) tx.create(mappingPath, { projectId, customerId, createdAt: now, updatedAt: now });
  return { id: customerId, ...record };
}

function planPriceCents(plan) {
  const cents = Number.isSafeInteger(plan.priceCents) && plan.priceCents >= 0
    ? plan.priceCents
    : moneyToCents(plan.price);
  return assertCents(cents, "unitPriceCents");
}

function canonicalPlanPriceInTransaction(tx, path, plan) {
  const cents = planPriceCents(plan);
  if (!Number.isSafeInteger(plan.priceCents) || plan.priceCents < 0) {
    const { id: _id, ...storedPlan } = plan;
    tx.set(path, { ...storedPlan, priceCents: cents });
  }
  return cents;
}

async function buildNewOrderItem(tx, input) {
  const project = await tx.get(`projects/${input.projectId}`);
  if (!project || project.status !== "active") {
    throw Object.assign(new Error("Produto indisponível para compra."), { status: 409, reason: "project_not_purchasable" });
  }
  const planPath = `projects/${input.projectId}/plans/${input.planId}`;
  const plan = await tx.get(planPath);
  if (!plan) throw Object.assign(new Error("Plano não encontrado."), { status: 404, reason: "plan_not_found" });
  if (plan.active === false || !planPublishedInCatalog(plan)) {
    throw Object.assign(new Error("Plano indisponível para compra."), { status: 409, reason: "plan_not_purchasable" });
  }
  const unitPriceCents = canonicalPlanPriceInTransaction(tx, planPath, plan);
  return {
    orderItemId: randomId("item"),
    type: "new_license",
    projectId: input.projectId,
    planId: input.planId,
    projectNameSnapshot: project.name || "Produto GuiaSys",
    planNameSnapshot: plan.name || "Plano",
    unitPriceCents,
    unitPrice: unitPriceCents / 100,
    commercialDescriptionSnapshot: plan.commercialDescription || plan.description || "",
    purchasedTermsVersionSnapshot: plan.termsVersion || "",
    quantity: input.quantity,
    durationDaysSnapshot: Boolean(plan.lifetime) ? 0 : Math.max(1, Number(plan.durationDays || 30)),
    lifetimeSnapshot: Boolean(plan.lifetime),
    deviceLimitSnapshot: Math.max(1, Number(plan.deviceLimit || 1)),
    startModeSnapshot: plan.startMode === "immediate" ? "immediate" : "first_activation",
    lineTotalCents: unitPriceCents * input.quantity
  };
}

async function createCustomerOrder(env, account, rawBody) {
  requireCheckoutAccount(account);
  const body = validateOrderCreatePayload(rawBody);
  const idempotencyHash = await sha256Hex(body.idempotencyKey);
  const requestHash = await sha256Hex(JSON.stringify(body.items));
  return await atomicClient(env).runTransaction(async tx => {
    const requestPath = `customerAccounts/${account.id}/orderRequests/${idempotencyHash}`;
    const replay = await tx.get(requestPath);
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw Object.assign(new Error("A chave de idempotência já foi usada com outro pedido."), { status: 409, reason: "idempotency_conflict" });
      }
      const existing = await tx.get(`orders/${assertCommerceId("orders", replay.orderId)}`);
      if (!existing || existing.accountId !== account.id) {
        throw Object.assign(new Error("Registro idempotente inconsistente."), { status: 500, reason: "idempotency_orphan" });
      }
      return { ...customerOrderView(existing), idempotentReplay: true };
    }

    const items = [];
    for (const input of body.items) items.push(await buildNewOrderItem(tx, input));
    const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    assertCents(subtotalCents, "subtotalCents");
    const orderId = randomId("ord");
    const orderNumber = await nextOrderNumberInTransaction(tx);
    const now = nowIso();
    const firstItem = items[0];
    const order = {
      orderId,
      orderNumber,
      accountId: account.id,
      firebaseUid: account.firebaseUid,
      customerUid: account.firebaseUid,
      customerName: account.displayName || account.email,
      customerEmail: account.email,
      customerWhatsapp: account.phone || "",
      status: "pending_payment",
      currency: "BRL",
      subtotalCents,
      totalCents: subtotalCents,
      subtotal: subtotalCents / 100,
      total: subtotalCents / 100,
      items,
      productId: items.length === 1 ? firstItem.projectId : "multiple",
      productName: items.length === 1 ? firstItem.projectNameSnapshot : `${items.length} produtos`,
      planId: items.length === 1 ? firstItem.planId : "multiple",
      planName: items.length === 1 ? firstItem.planNameSnapshot : `${items.length} planos`,
      licenseDuration: items.length === 1 ? (firstItem.lifetimeSnapshot ? "lifetime" : firstItem.durationDaysSnapshot) : null,
      provider: pagBankEnabled(env) ? "pagbank" : MANUAL_PIX_PROVIDER,
      paymentProvider: pagBankEnabled(env) ? "pagbank" : MANUAL_PIX_PROVIDER,
      paymentMethod: "pix",
      providerOrderId: "",
      activePaymentId: "",
      pixTxid: pixTxidForOrder(orderId),
      paymentStatus: "pending",
      processingStatus: "pending",
      fulfillmentStatus: "pending",
      idempotencyKey: body.idempotencyKey,
      resultingLicenses: [],
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      cancelledAt: null
    };
    tx.create(`orders/${orderId}`, order);
    tx.create(`customerAccounts/${account.id}/orders/${orderId}`, { orderId, createdAt: now });
    tx.create(requestPath, { orderId, requestHash, createdAt: now });
    queuePlatformLogInTransaction(tx, "order_created", { orderId, orderNumber, accountId: account.id, totalCents: subtotalCents, itemCount: items.length, actorUid: account.firebaseUid }, account.firebaseUid, now);
    return { ...customerOrderView(order), idempotentReplay: false };
  });
}

async function getOwnedOrder(env, accountId, orderId) {
  orderId = assertCommerceId("orders", orderId);
  const reference = await getDoc(env, `customerAccounts/${accountId}/orders/${orderId}`);
  const order = reference ? await getDoc(env, `orders/${orderId}`) : null;
  if (!order || order.accountId !== accountId) {
    throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
  }
  return customerOrderView(order);
}

async function listOwnedOrders(env, accountId) {
  const refs = await listCollection(env, `customerAccounts/${accountId}/orders`);
  const orders = [];
  for (const ref of refs.slice(0, 100)) {
    const order = await getDoc(env, `orders/${assertCommerceId("orders", ref.orderId || ref.id)}`);
    if (order?.accountId === accountId) orders.push(customerOrderView(order));
  }
  return orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function pagBankCustomerFromAccount(account) {
  const name = String(account.displayName || "").trim();
  const email = String(account.email || "").trim().toLowerCase();
  const taxId = String(account.taxId || "").replace(/\D/g, "");
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validBrazilianTaxId(taxId)) {
    throw Object.assign(new Error("Complete nome, e-mail verificado e CPF/CNPJ no cadastro antes de pagar."), {
      status: 409,
      reason: "payment_customer_incomplete"
    });
  }

  const customer = { name, email, tax_id: taxId };
  const phone = String(account.phone || "").replace(/\D/g, "");
  if (phone) {
    const national = phone.startsWith("55") && phone.length >= 12 ? phone.slice(2) : phone;
    if (!/^\d{10,11}$/.test(national)) {
      throw Object.assign(new Error("O telefone do cadastro não possui formato brasileiro válido."), {
        status: 409,
        reason: "payment_customer_incomplete"
      });
    }
    customer.phones = [{
      country: "55",
      area: national.slice(0, 2),
      number: national.slice(2),
      type: national.length === 11 ? "MOBILE" : "LANDLINE"
    }];
  }
  return customer;
}

function validBrazilianTaxId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^(?:\d{11}|\d{14})$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;

  const checkDigit = (base, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  if (digits.length === 11) {
    const first = checkDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = checkDigit(`${digits.slice(0, 9)}${first}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return digits.endsWith(`${first}${second}`);
  }

  const first = checkDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(`${digits.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${first}${second}`);
}

function sandboxCheckoutTesterUids(env) {
  return new Set(
    String(env.PAGBANK_SANDBOX_TESTER_UIDS || "")
      .split(/[\s,;]+/)
      .map(value => value.trim())
      .filter(Boolean)
  );
}

function requireSandboxCheckoutAccess(env, account) {
  if (String(env.PAGBANK_SANDBOX_CHECKOUT_ENABLED || "").trim().toLowerCase() !== "true") {
    throw Object.assign(new Error("Checkout Sandbox está desabilitado."), {
      status: 403,
      reason: "sandbox_checkout_disabled"
    });
  }
  if (!sandboxCheckoutTesterUids(env).has(String(account.firebaseUid || ""))) {
    throw Object.assign(new Error("Esta conta não está autorizada para homologação Sandbox."), {
      status: 403,
      reason: "sandbox_checkout_forbidden"
    });
  }
}

function pagBankItemsFromOrder(order) {
  if (!Array.isArray(order.items) || !order.items.length) {
    throw Object.assign(new Error("Pedido não possui snapshots de itens válidos."), {
      status: 409,
      reason: "order_snapshot_orphan"
    });
  }
  let total = 0;
  const items = order.items.map((item, index) => {
    const quantity = Number(item.quantity);
    const unitAmount = Number(item.unitPriceCents);
    const lineTotal = Number(item.lineTotalCents);
    const name = [item.projectNameSnapshot, item.planNameSnapshot]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .join(" - ")
      .slice(0, 100);
    if (
      !name ||
      !Number.isSafeInteger(quantity) || quantity < 1 ||
      !Number.isSafeInteger(unitAmount) || unitAmount < 1 ||
      !Number.isSafeInteger(lineTotal) || lineTotal !== unitAmount * quantity
    ) {
      throw Object.assign(new Error("Snapshot de item do pedido é inválido."), {
        status: 409,
        reason: "order_snapshot_invalid"
      });
    }
    total += lineTotal;
    return {
      reference_id: `${order.orderId}-${index + 1}`,
      name,
      quantity,
      unit_amount: unitAmount
    };
  });
  if (!Number.isSafeInteger(total) || total !== order.totalCents || order.currency !== "BRL") {
    throw Object.assign(new Error("Total ou moeda do pedido é inválido."), {
      status: 409,
      reason: "payment_amount_mismatch"
    });
  }
  return items;
}

function pagBankPixPayload(order, account, paymentId) {
  return {
    reference_id: order.orderId,
    customer: pagBankCustomerFromAccount(account),
    items: pagBankItemsFromOrder(order),
    charges: [{
      reference_id: paymentId,
      description: `Pedido ${order.orderId}`,
      amount: {
        value: order.totalCents,
        currency: "BRL"
      },
      payment_method: {
        type: "PIX"
      }
    }]
  };
}

function customerProfileComplete(account) {
  return Boolean(
    String(account?.displayName || "").trim().length >= 2 &&
    isValidCpf(account?.taxId) &&
    /^\d{10,11}$/.test(String(account?.phone || "").replace(/\D/g, "")) &&
    /^\d{8}$/.test(String(account?.postalCode || "").replace(/\D/g, "")) &&
    ["street", "number", "neighborhood", "city", "state"].every(field => String(account?.[field] || "").trim()) &&
    /^[A-Z]{2}$/.test(String(account?.state || ""))
  );
}

function requireCheckoutAccount(account) {
  if (!account.emailVerified) {
    throw Object.assign(new Error("Confirme seu e-mail antes de realizar compras."), {
      status: 403,
      reason: "verified_email_required"
    });
  }
  if (!customerProfileComplete(account)) {
    throw Object.assign(new Error("Complete nome, CPF, telefone e endereço antes de finalizar a compra."), {
      status: 409,
      reason: "profile_incomplete"
    });
  }
}

function customerPaymentView(payment, idempotentReplay) {
  return {
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    status: payment.status,
    method: payment.method,
    amountCents: payment.amountCents,
    currency: payment.currency,
    providerOrderId: payment.providerOrderId,
    providerChargeId: payment.providerChargeId,
    pixCode: payment.pixCode || "",
    pixExpiration: payment.pixExpiration || null,
    pixQrCodeUrl: payment.pixQrCodeUrl || "",
    idempotentReplay: Boolean(idempotentReplay)
  };
}

async function linkPagBankPayment(env, provider, account, order, payment, payload) {
  const normalized = provider.normalizePayment(payload, {
    orderId: order.orderId,
    paymentId: payment.paymentId
  });
  return await linkPaymentProviderResult({
    atomicClient: atomicClient(env),
    paymentId: payment.paymentId,
    orderId: order.orderId,
    accountId: account.id,
    provider: "pagbank",
    providerEnvironment: "sandbox",
    result: normalized,
    now: nowIso
  });
}

async function startSandboxPixPayment(env, account, orderId, rawBody) {
  orderId = assertCommerceId("orders", orderId);
  const body = validatePaymentCreatePayload(rawBody);
  requireSandboxCheckoutAccess(env, account);
  await getOwnedOrder(env, account.id, orderId);
  const attempt = await createPaymentAttempt({
    atomicClient: atomicClient(env),
    orderId,
    accountId: account.id,
    provider: "pagbank",
    providerEnvironment: "sandbox",
    method: body.method,
    idempotencyKey: body.idempotencyKey,
    hash: sha256Hex,
    randomId,
    now: nowIso
  });
  const payment = attempt.payment;
  const order = await getDoc(env, `orders/${orderId}`);
  if (!order || order.accountId !== account.id) {
    throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
  }
  const provider = pagBankProvider(env, "sandbox");

  if (payment.providerOrderId) {
    const current = await provider.getPayment(payment.providerOrderId);
    const linked = await linkPagBankPayment(env, provider, account, order, payment, current);
    return customerPaymentView(linked.payment, true);
  }

  const providerPayload = pagBankPixPayload(order, account, payment.paymentId);
  await claimPaymentSubmission({
    atomicClient: atomicClient(env),
    paymentId: payment.paymentId,
    orderId,
    accountId: account.id,
    provider: "pagbank",
    providerEnvironment: "sandbox",
    now: nowIso
  });

  let providerResponse;
  try {
    providerResponse = await provider.createPayment(providerPayload);
  } catch (error) {
    const uncertain = error?.reason !== "pagbank_request_rejected";
    try {
      await recordPaymentSubmissionFailure({
        atomicClient: atomicClient(env),
        paymentId: payment.paymentId,
        orderId,
        accountId: account.id,
        provider: "pagbank",
        providerEnvironment: "sandbox",
        uncertain,
        providerHttpStatus: Number.isInteger(error?.details?.providerStatus)
          ? error.details.providerStatus
          : null,
        providerErrorCode: error?.details?.providerCode || "",
        providerErrorCategory: error?.details?.category || (uncertain ? "uncertain" : "definitive"),
        now: nowIso
      });
    } catch (recordError) {
      structuredLog(env, "error", "pagbank.payment_submission_state_write_failed", {
        paymentId: payment.paymentId,
        orderId,
        reason: recordError?.reason || "unknown"
      });
    }
    throw error;
  }

  try {
    const linked = await linkPagBankPayment(env, provider, account, order, payment, providerResponse);
    return customerPaymentView(linked.payment, attempt.idempotentReplay);
  } catch (error) {
    try {
      await recordPaymentSubmissionFailure({
        atomicClient: atomicClient(env),
        paymentId: payment.paymentId,
        orderId,
        accountId: account.id,
        provider: "pagbank",
        providerEnvironment: "sandbox",
        uncertain: true,
        now: nowIso
      });
    } catch (recordError) {
      structuredLog(env, "error", "pagbank.payment_link_state_write_failed", {
        paymentId: payment.paymentId,
        orderId,
        reason: recordError?.reason || "unknown"
      });
    }
    throw error;
  }
}

function manualPaymentView(payment, order, idempotentReplay = false) {
  return {
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    orderNumber: order.orderNumber,
    status: payment.status,
    paymentProvider: MANUAL_PIX_PROVIDER,
    paymentMethod: "pix",
    amountCents: payment.amountCents,
    currency: payment.currency,
    pixTxid: payment.pixTxid,
    pixCode: payment.pixCode,
    pixQrCodeDataUrl: payment.pixQrCodeDataUrl,
    pixKey: payment.pixKey,
    pixKeyType: payment.pixKeyType,
    pixDisplayName: payment.pixDisplayName,
    pixMerchantName: payment.pixMerchantName,
    pixMerchantCity: payment.pixMerchantCity,
    pixWhatsapp: payment.pixWhatsapp,
    whatsappUrl: manualPixWhatsappUrl({
      whatsapp: payment.pixWhatsapp,
      orderNumber: order.orderNumber,
      customerName: order.customerName || order.customerEmail,
      productName: order.productName || order.items?.[0]?.projectNameSnapshot || "Produto GuiaSys",
      planName: order.planName || order.items?.[0]?.planNameSnapshot || "Plano",
      totalFormatted: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(order.totalCents / 100)
    }),
    manualConfirmationEnabled: Boolean(payment.manualConfirmationEnabled),
    idempotentReplay: Boolean(idempotentReplay)
  };
}

async function startManualPixPayment(env, account, orderId, rawBody) {
  orderId = assertCommerceId("orders", orderId);
  const body = validatePaymentCreatePayload(rawBody);
  const settings = await getPaymentSettings(env);
  assertManualPixOperational(env, settings);
  const ownedOrder = await getOwnedOrder(env, account.id, orderId);
  const presentation = await buildManualPixPresentation({ settings, order: ownedOrder });
  const requestHash = await sha256Hex(`${account.id}|${body.idempotencyKey}`);

  const result = await atomicClient(env).runTransaction(async tx => {
    const requestPath = `paymentRequests/${requestHash}`;
    const replay = await tx.get(requestPath);
    if (replay) {
      if (replay.orderId !== orderId || replay.accountId !== account.id) {
        throw Object.assign(new Error("Chave de idempotência usada por outro pagamento."), { status: 409, reason: "idempotency_conflict" });
      }
      const payment = await tx.get(`payments/${replay.paymentId}`);
      const order = await tx.get(`orders/${orderId}`);
      if (!payment || !order || payment.provider !== MANUAL_PIX_PROVIDER) {
        throw Object.assign(new Error("Registro idempotente de pagamento inconsistente."), { status: 409, reason: "idempotency_orphan" });
      }
      return { payment, order, idempotentReplay: true };
    }

    const order = await tx.get(`orders/${orderId}`);
    const reference = await tx.get(`customerAccounts/${account.id}/orders/${orderId}`);
    if (!order || !reference || order.accountId !== account.id) {
      throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
    }
    if (order.paymentId) {
      const existing = await tx.get(`payments/${order.paymentId}`);
      if (existing?.provider === MANUAL_PIX_PROVIDER && existing.orderId === orderId) {
        return { payment: existing, order, idempotentReplay: true };
      }
      throw Object.assign(new Error("Pedido já possui outro pagamento."), { status: 409, reason: "payment_conflict" });
    }
    if (order.status !== "pending_payment") {
      throw Object.assign(new Error("Pedido não aceita geração de PIX."), { status: 409, reason: "payment_not_allowed" });
    }
    if (order.totalCents !== ownedOrder.totalCents || order.currency !== "BRL") {
      throw Object.assign(new Error("Valor ou moeda do pedido mudou."), { status: 409, reason: "payment_amount_mismatch" });
    }

    const paymentId = randomId("pay");
    const timestamp = nowIso();
    const payment = {
      paymentId,
      orderId,
      accountId: account.id,
      provider: MANUAL_PIX_PROVIDER,
      providerEnvironment: "local",
      providerOrderId: "",
      providerChargeId: "",
      providerPaymentId: "",
      providerStatus: "MANUAL_PENDING",
      submissionState: "linked",
      status: "pending",
      method: "pix",
      amountCents: order.totalCents,
      currency: "BRL",
      pixTxid: presentation.txid,
      pixCode: presentation.pixCode,
      pixQrCodeDataUrl: presentation.pixQrCodeDataUrl,
      pixKey: presentation.pixKey,
      pixKeyType: presentation.pixKeyType,
      pixDisplayName: presentation.pixDisplayName,
      pixMerchantName: presentation.pixMerchantName,
      pixMerchantCity: presentation.pixMerchantCity,
      pixWhatsapp: presentation.pixWhatsapp,
      manualConfirmationEnabled: presentation.manualConfirmationEnabled,
      createdAt: timestamp,
      updatedAt: timestamp,
      paidAt: null,
      failedAt: null,
      cancelledAt: null
    };
    const nextOrder = {
      ...order,
      provider: MANUAL_PIX_PROVIDER,
      paymentProvider: MANUAL_PIX_PROVIDER,
      paymentMethod: "pix",
      paymentId,
      activePaymentId: paymentId,
      pixTxid: presentation.txid,
      paymentStatus: "pending",
      updatedAt: timestamp
    };
    tx.create(`payments/${paymentId}`, payment);
    tx.create(requestPath, { paymentId, orderId, accountId: account.id, createdAt: timestamp });
    tx.set(`orders/${orderId}`, nextOrder);
    return { payment, order: nextOrder, idempotentReplay: false };
  });

  return manualPaymentView(result.payment, result.order, result.idempotentReplay);
}

async function reportManualPixPayment(env, account, orderId) {
  orderId = assertCommerceId("orders", orderId);
  const settings = await getPaymentSettings(env);
  assertManualPixOperational(env, settings);
  return await atomicClient(env).runTransaction(async tx => {
    const order = await tx.get(`orders/${orderId}`);
    const reference = await tx.get(`customerAccounts/${account.id}/orders/${orderId}`);
    if (!order || !reference || order.accountId !== account.id) {
      throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
    }
    if (["paid", "fulfilled"].includes(order.status) || order.fulfillmentStatus === "fulfilled") {
      return { ...customerOrderView(order), idempotentReplay: true };
    }
    if (order.status === "cancelled") {
      throw Object.assign(new Error("Pedido cancelado não aceita informação de pagamento."), { status: 409, reason: "order_cancelled" });
    }
    if (!order.paymentId || order.paymentProvider !== MANUAL_PIX_PROVIDER) {
      throw Object.assign(new Error("Gere o PIX manual antes de informar o pagamento."), { status: 409, reason: "manual_payment_missing" });
    }
    const payment = await tx.get(`payments/${order.paymentId}`);
    if (!payment || payment.orderId !== orderId || payment.accountId !== account.id || payment.provider !== MANUAL_PIX_PROVIDER) {
      throw Object.assign(new Error("Pagamento manual inconsistente."), { status: 409, reason: "payment_conflict" });
    }
    if (order.status === "payment_reported") {
      return { ...customerOrderView(order), idempotentReplay: true };
    }
    transitionOrderStatus(order.status, "payment_reported");
    const timestamp = nowIso();
    const nextOrder = {
      ...order,
      status: "payment_reported",
      paymentStatus: "reported",
      paymentReportedAt: order.paymentReportedAt || timestamp,
      updatedAt: timestamp
    };
    tx.set(`orders/${orderId}`, nextOrder);
    tx.set(`payments/${payment.paymentId}`, {
      ...payment,
      status: "reported",
      providerStatus: "MANUAL_REPORTED",
      paymentReportedAt: payment.paymentReportedAt || timestamp,
      updatedAt: timestamp
    });
    queuePlatformLogInTransaction(tx, "payment_reported", {
      orderId,
      paymentId: payment.paymentId,
      actorUid: account.firebaseUid
    }, account.firebaseUid, timestamp);
    return { ...customerOrderView(nextOrder), idempotentReplay: false };
  });
}

async function confirmManualPixOrder(env, admin, orderId) {
  orderId = assertCommerceId("orders", orderId);
  const settings = await getPaymentSettings(env);
  assertManualPixOperational(env, settings);
  if (!settings.manualConfirmationEnabled) {
    throw Object.assign(new Error("Confirmação manual está desabilitada."), { status: 409, reason: "manual_confirmation_disabled" });
  }
  const order = await getDoc(env, `orders/${orderId}`);
  if (!order || !adminCanViewCommerceOrder(admin, order)) {
    throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
  }
  if (order.fulfillmentStatus === "fulfilled") {
    return { order: customerOrderView(order), idempotentReplay: true };
  }
  if (order.status !== "payment_reported") {
    throw Object.assign(new Error("Somente pedidos com pagamento informado podem ser confirmados."), {
      status: 409,
      reason: "payment_not_reported"
    });
  }
  const payment = order.paymentId ? await getDoc(env, `payments/${assertCommerceId("payments", order.paymentId)}`) : null;
  if (
    !payment ||
    payment.orderId !== orderId ||
    payment.accountId !== order.accountId ||
    payment.provider !== MANUAL_PIX_PROVIDER ||
    payment.amountCents !== order.totalCents ||
    payment.currency !== "BRL"
  ) {
    throw Object.assign(new Error("Pagamento manual inconsistente."), { status: 409, reason: "payment_conflict" });
  }
  return await finalizePaidOrder(env, orderId, {
    paymentId: payment.paymentId,
    orderId,
    accountId: order.accountId,
    status: "paid",
    amountCents: order.totalCents,
    currency: "BRL",
    provider: MANUAL_PIX_PROVIDER,
    providerEnvironment: "local",
    method: "pix",
    manualConfirmed: true,
    paidByAdminUid: admin.uid
  });
}

function adminPaymentReconciliationView(payment) {
  return {
    ...customerPaymentView(payment, true),
    providerEnvironment: payment.providerEnvironment,
    providerStatus: payment.providerStatus || "",
    submissionState: payment.submissionState || "",
    pixQrCodeId: payment.pixQrCodeId || "",
    providerPaidAt: payment.providerPaidAt || null,
    updatedAt: payment.updatedAt
  };
}

async function reconcileSandboxPaymentAsAdmin(env, admin, paymentId, rawBody) {
  if (!pagBankEnabled(env)) {
    throw Object.assign(new Error("PagBank está congelado nesta versão."), { status: 409, reason: "pagbank_disabled" });
  }
  paymentId = assertCommerceId("payments", paymentId);
  const body = validatePaymentReconcilePayload(rawBody);
  const payment = await getDoc(env, `payments/${paymentId}`);
  const order = payment?.orderId
    ? await getDoc(env, `orders/${assertCommerceId("orders", payment.orderId)}`)
    : null;
  if (!payment || !order || !adminCanViewCommerceOrder(admin, order)) {
    throw Object.assign(new Error("Pagamento não encontrado."), { status: 404, reason: "payment_not_found" });
  }
  if (payment.provider !== "pagbank" || payment.providerEnvironment !== "sandbox") {
    throw Object.assign(new Error("Somente pagamentos PagBank Sandbox podem ser reconciliados nesta operação."), {
      status: 409,
      reason: "payment_environment_mismatch"
    });
  }
  if (!["unknown", "submitting", "linked"].includes(payment.submissionState)) {
    throw Object.assign(new Error("Pagamento não está em estado reconciliável."), {
      status: 409,
      reason: "payment_not_reconcilable"
    });
  }

  const suppliedProviderOrderId = String(body.providerOrderId || "");
  if (
    payment.providerOrderId &&
    suppliedProviderOrderId &&
    payment.providerOrderId !== suppliedProviderOrderId
  ) {
    throw Object.assign(new Error("O Order ID informado diverge do vínculo local."), {
      status: 409,
      reason: "payment_provider_order_mismatch"
    });
  }
  const providerOrderId = payment.providerOrderId || suppliedProviderOrderId;
  if (!providerOrderId) {
    throw Object.assign(new Error("Informe o ORDE_ identificado operacionalmente no PagBank."), {
      status: 409,
      reason: "provider_order_id_required"
    });
  }

  const provider = pagBankProvider(env, "sandbox");
  const remote = await provider.getPayment(providerOrderId);
  let linked;
  try {
    linked = await linkPagBankPayment(env, provider, { id: payment.accountId }, order, payment, remote);
  } catch (error) {
    if ([
      "payment_provider_order_mismatch",
      "payment_provider_charge_mismatch",
      "payment_amount_mismatch",
      "payment_method_mismatch",
      "invalid_pagbank_response"
    ].includes(error?.reason)) {
      throw Object.assign(error, { status: 409 });
    }
    throw error;
  }
  structuredLog(env, "info", "pagbank.sandbox_payment_reconciled", {
    paymentId,
    orderId: order.orderId,
    providerOrderId: linked.payment.providerOrderId,
    providerChargeId: linked.payment.providerChargeId,
    providerStatus: linked.payment.providerStatus,
    actor: admin.email || admin.uid
  });
  return adminPaymentReconciliationView(linked.payment);
}

async function cancelOwnedOrder(env, accountId, orderId, actor) {
  orderId = assertCommerceId("orders", orderId);
  return await atomicClient(env).runTransaction(async tx => {
    const order = await tx.get(`orders/${orderId}`);
    const reference = await tx.get(`customerAccounts/${accountId}/orders/${orderId}`);
    if (!order || !reference || order.accountId !== accountId) {
      throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
    }
    if (!["pending_payment", "payment_failed"].includes(order.status)) {
      throw Object.assign(new Error("Somente pedidos não pagos podem ser cancelados."), { status: 409, reason: "order_not_cancellable" });
    }
    transitionOrderStatus(order.status, "cancelled");
    const now = nowIso();
    const next = { ...order, status: "cancelled", paymentStatus: "cancelled", processingStatus: "cancelled", cancelledAt: now, updatedAt: now };
    if (order.paymentId) {
      const payment = await tx.get(`payments/${assertCommerceId("payments", order.paymentId)}`);
      if (payment && payment.orderId === orderId && payment.accountId === accountId && payment.status === "pending") {
        transitionPaymentStatus(payment.status, "cancelled");
        tx.set(`payments/${payment.paymentId}`, {
          ...payment,
          status: "cancelled",
          providerStatus: payment.provider === MANUAL_PIX_PROVIDER ? "MANUAL_CANCELLED" : payment.providerStatus,
          cancelledAt: now,
          updatedAt: now
        });
      }
    }
    tx.set(`orders/${orderId}`, next);
    queuePlatformLogInTransaction(tx, "order.cancelled", { orderId, accountId }, actor, now);
    return customerOrderView(next);
  });
}

async function listOwnedLicenses(env, accountId) {
  const refs = await listCollection(env, `customerAccounts/${accountId}/licenses`);
  const result = [];
  for (const ref of refs.slice(0, 200)) {
    const projectId = assertProjectId(ref.projectId);
    const licenseId = assertEntityId("licenses", ref.licenseId || ref.id);
    const license = await getDoc(env, `projects/${projectId}/licenses/${licenseId}`);
    if (license?.accountId === accountId) result.push(normalizeLicenseStatus({ id: licenseId, projectId, ...license }));
  }
  return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function createRenewalOrder(env, account, licenseId, rawBody) {
  requireCheckoutAccount(account);
  licenseId = assertEntityId("licenses", licenseId);
  const body = validateRenewalOrderPayload(rawBody);
  const owned = await getDoc(env, `customerAccounts/${account.id}/licenses/${licenseId}`);
  if (!owned) throw Object.assign(new Error("Licença não encontrada."), { status: 404, reason: "license_not_found" });
  const projectId = assertProjectId(owned.projectId);
  const idempotencyHash = await sha256Hex(body.idempotencyKey);
  const requestHash = await sha256Hex(JSON.stringify({ projectId, licenseId, planId: body.planId }));
  return await atomicClient(env).runTransaction(async tx => {
    const requestPath = `customerAccounts/${account.id}/orderRequests/${idempotencyHash}`;
    const replay = await tx.get(requestPath);
    if (replay) {
      if (replay.requestHash !== requestHash) throw Object.assign(new Error("A chave de idempotência já foi usada com outro pedido."), { status: 409, reason: "idempotency_conflict" });
      const existing = await tx.get(`orders/${assertCommerceId("orders", replay.orderId)}`);
      return { ...customerOrderView(existing), idempotentReplay: true };
    }
    const license = await tx.get(`projects/${projectId}/licenses/${licenseId}`);
    if (!license || license.accountId !== account.id) throw Object.assign(new Error("Licença não encontrada."), { status: 404, reason: "license_not_found" });
    if (license.status === "revoked") throw Object.assign(new Error("Licença revogada não pode ser renovada."), { status: 409, reason: "license_revoked" });
    if (license.lifetime) throw Object.assign(new Error("Licença vitalícia não precisa de renovação."), { status: 409, reason: "license_lifetime" });
    const project = await tx.get(`projects/${projectId}`);
    const planPath = `projects/${projectId}/plans/${body.planId}`;
    const plan = await tx.get(planPath);
    if (!project || project.status !== "active" || !plan || plan.active === false || !planPublishedInCatalog(plan)) {
      throw Object.assign(new Error("Oferta de renovação indisponível."), { status: 409, reason: "renewal_plan_not_purchasable" });
    }
    const unitPriceCents = canonicalPlanPriceInTransaction(tx, planPath, plan);
    const item = {
      orderItemId: randomId("item"), type: "renewal", projectId, planId: body.planId, licenseId,
      projectNameSnapshot: project.name || "Produto GuiaSys", planNameSnapshot: plan.name || "Renovação",
      unitPriceCents, unitPrice: unitPriceCents / 100,
      commercialDescriptionSnapshot: plan.commercialDescription || plan.description || "",
      purchasedTermsVersionSnapshot: plan.termsVersion || "",
      quantity: 1, durationDaysSnapshot: Boolean(plan.lifetime) ? 0 : Math.max(1, Number(plan.durationDays || 30)),
      lifetimeSnapshot: Boolean(plan.lifetime), deviceLimitSnapshot: Math.max(1, Number(plan.deviceLimit || 1)),
      startModeSnapshot: plan.startMode === "immediate" ? "immediate" : "first_activation", lineTotalCents: unitPriceCents
    };
    const orderId = randomId("ord");
    const orderNumber = await nextOrderNumberInTransaction(tx);
    const now = nowIso();
    const order = {
      orderId, orderNumber, accountId: account.id, firebaseUid: account.firebaseUid, customerUid: account.firebaseUid,
      customerName: account.displayName || account.email, customerEmail: account.email, customerWhatsapp: account.phone || "",
      status: "pending_payment", currency: "BRL", subtotalCents: unitPriceCents, totalCents: unitPriceCents,
      subtotal: unitPriceCents / 100, total: unitPriceCents / 100, items: [item],
      productId: projectId, productName: item.projectNameSnapshot, planId: body.planId, planName: item.planNameSnapshot,
      licenseDuration: item.lifetimeSnapshot ? "lifetime" : item.durationDaysSnapshot,
      provider: pagBankEnabled(env) ? "pagbank" : MANUAL_PIX_PROVIDER,
      paymentProvider: pagBankEnabled(env) ? "pagbank" : MANUAL_PIX_PROVIDER,
      paymentMethod: "pix", providerOrderId: "",
      pixTxid: pixTxidForOrder(orderId),
      activePaymentId: "", paymentStatus: "pending", processingStatus: "pending", fulfillmentStatus: "pending", idempotencyKey: body.idempotencyKey,
      resultingLicenses: [], createdAt: now, updatedAt: now, paidAt: null, cancelledAt: null
    };
    tx.create(`orders/${orderId}`, order);
    tx.create(`customerAccounts/${account.id}/orders/${orderId}`, { orderId, createdAt: now });
    tx.create(requestPath, { orderId, requestHash, createdAt: now });
    queuePlatformLogInTransaction(tx, "order_created", { orderId, orderNumber, accountId: account.id, type: "renewal", licenseId, totalCents: unitPriceCents, actorUid: account.firebaseUid }, account.firebaseUid, now);
    return { ...customerOrderView(order), idempotentReplay: false };
  });
}

export async function finalizePaidOrder(env, orderId, paymentContext) {
  orderId = assertCommerceId("orders", orderId);
  const paymentId = assertCommerceId("payments", paymentContext?.paymentId);
  if (paymentContext?.status !== "paid") {
    throw Object.assign(new Error("O fulfillment exige pagamento confirmado."), { status: 409, reason: "payment_not_paid" });
  }
  return await atomicClient(env).runTransaction(async tx => {
    const order = await tx.get(`orders/${orderId}`);
    if (!order) throw Object.assign(new Error("Pedido não encontrado."), { status: 404, reason: "order_not_found" });
    if (paymentContext.orderId && paymentContext.orderId !== orderId) throw Object.assign(new Error("Pagamento pertence a outro pedido."), { status: 409, reason: "payment_order_mismatch" });
    if (paymentContext.accountId && paymentContext.accountId !== order.accountId) throw Object.assign(new Error("Pagamento pertence a outra conta."), { status: 409, reason: "payment_account_mismatch" });
    assertCents(paymentContext.amountCents, "amountCents");
    if (paymentContext.amountCents !== order.totalCents || paymentContext.currency !== "BRL") {
      throw Object.assign(new Error("Valor ou moeda do pagamento não confere com o pedido."), { status: 409, reason: "payment_amount_mismatch" });
    }
    if (order.fulfillmentStatus === "fulfilled") {
      if (order.paymentId && order.paymentId !== paymentId) {
        throw Object.assign(new Error("Pedido já foi processado por outro pagamento."), { status: 409, reason: "payment_conflict" });
      }
      return { order: customerOrderView(order), idempotentReplay: true };
    }
    if (["cancelled", "refunded"].includes(order.status)) throw Object.assign(new Error("Pedido não pode ser processado."), { status: 409, reason: "order_not_fulfillable" });
    let fulfillmentTransition = order.status;
    if (["pending_payment", "payment_failed"].includes(fulfillmentTransition)) fulfillmentTransition = transitionOrderStatus(fulfillmentTransition, "payment_processing");
    if (fulfillmentTransition === "payment_processing") fulfillmentTransition = transitionOrderStatus(fulfillmentTransition, "paid");
    if (fulfillmentTransition === "payment_reported") fulfillmentTransition = transitionOrderStatus(fulfillmentTransition, "paid");
    if (fulfillmentTransition === "paid") fulfillmentTransition = transitionOrderStatus(fulfillmentTransition, "fulfilling");
    transitionOrderStatus(fulfillmentTransition, "fulfilled");
    const existingPayment = await tx.get(`payments/${paymentId}`);
    const manualConfirmation = Boolean(
      paymentContext.manualConfirmed === true &&
      paymentContext.provider === MANUAL_PIX_PROVIDER &&
      existingPayment?.provider === MANUAL_PIX_PROVIDER &&
      order.status === "payment_reported" &&
      ["pending", "reported"].includes(existingPayment.status)
    );
    if (existingPayment && (
      existingPayment.orderId !== orderId ||
      (existingPayment.status !== "paid" && !manualConfirmation)
    )) {
      throw Object.assign(new Error("Pagamento inconsistente."), { status: 409, reason: "payment_conflict" });
    }
    const accountRecord = await tx.get(`customerAccounts/${order.accountId}`);
    if (!accountRecord) throw Object.assign(new Error("Conta do pedido não encontrada."), { status: 500, reason: "account_not_found" });
    const account = { id: order.accountId, ...accountRecord };
    const now = nowIso();
    const results = [];
    const projectCustomers = new Map();
    for (const item of order.items) {
      const project = await tx.get(`projects/${item.projectId}`);
      if (!project) throw Object.assign(new Error("Produto do pedido não encontrado."), { status: 409, reason: "order_snapshot_orphan" });
      if (item.type === "new_license") {
        let customer = projectCustomers.get(item.projectId);
        if (!customer) {
          customer = await ensureProjectCustomerInTransaction(tx, account, item.projectId, now);
          projectCustomers.set(item.projectId, customer);
        }
        for (let index = 0; index < item.quantity; index++) {
          const id = randomId("lic");
          const license = await issueLicenseInTransaction({
            tx, project, projectId: item.projectId, customer, customerId: customer.id,
            plan: { id: item.planId, name: item.planNameSnapshot, lifetime: item.lifetimeSnapshot, durationDays: item.durationDaysSnapshot, deviceLimit: item.deviceLimitSnapshot, startMode: item.startModeSnapshot },
            now, source: "order", externalOrderId: orderId, accountId: order.accountId,
            customerUid: order.customerUid, orderItemId: item.orderItemId || "", paymentId, id,
            key: generateLicenseKey(project.prefix), hashLicenseKey: value => sha256Hex(normalizeLicenseKey(value)), plusDays,
            queueLog: queueLogInTransaction, actor: "payment.fulfillment"
          });
          tx.create(`customerAccounts/${order.accountId}/licenses/${id}`, {
            licenseId: id, projectId: item.projectId, planId: item.planId,
            customerId: customer.id, customerUid: order.customerUid,
            orderId, orderItemId: item.orderItemId || "", paymentId, createdAt: now
          });
          results.push({
            type: "new_license", projectId: item.projectId, planId: item.planId,
            orderItemId: item.orderItemId || "", unitIndex: index + 1,
            customerUid: order.customerUid, licenseId: id, key: license.key
          });
        }
      } else if (item.type === "renewal") {
        const licensePath = `projects/${item.projectId}/licenses/${item.licenseId}`;
        const license = await tx.get(licensePath);
        const ownership = await tx.get(`customerAccounts/${order.accountId}/licenses/${item.licenseId}`);
        if (!license || !ownership || license.accountId !== order.accountId) throw Object.assign(new Error("Licença de renovação não pertence à conta."), { status: 403, reason: "license_ownership_mismatch" });
        const renewal = transitionLicense(license, "renew", item.lifetimeSnapshot ? { lifetime: true } : { days: item.durationDaysSnapshot }, now, plusDays);
        const next = {
          ...renewal.license,
          orderId,
          orderItemId: item.orderItemId || "",
          customerUid: order.customerUid,
          paymentId,
          updatedAt: now
        };
        tx.set(licensePath, next);
        queueLogInTransaction(tx, item.projectId, "license.renewed_from_order", { licenseId: item.licenseId, orderId, paymentId, days: item.durationDaysSnapshot, lifetime: item.lifetimeSnapshot }, "payment.fulfillment", now);
        results.push({
          type: "renewal", projectId: item.projectId, planId: item.planId,
          orderItemId: item.orderItemId || "", unitIndex: 1,
          customerUid: order.customerUid, licenseId: item.licenseId, key: next.key
        });
      }
    }
    const payment = existingPayment ? {
      ...existingPayment,
      ...(manualConfirmation ? {
        status: "paid",
        providerStatus: "MANUAL_CONFIRMED",
        paidAt: now,
        paidByAdminUid: String(paymentContext.paidByAdminUid || "")
      } : {}),
      updatedAt: now
    } : {
      paymentId, orderId, accountId: order.accountId, provider: String(paymentContext.provider || "pagbank"),
      providerEnvironment: String(paymentContext.providerEnvironment || ""),
      providerOrderId: String(paymentContext.providerOrderId || ""),
      providerChargeId: String(paymentContext.providerChargeId || ""),
      // Legado/depreciado: não representa o PagBank Order ID.
      providerPaymentId: String(paymentContext.providerPaymentId || paymentContext.providerChargeId || ""),
      status: "paid", amountCents: order.totalCents,
      currency: "BRL", method: String(paymentContext.method || "unknown"), createdAt: now, updatedAt: now,
      providerPaidAt: paymentContext.providerPaidAt || paymentContext.paidAt || null,
      paidAt: paymentContext.paidAt ? String(paymentContext.paidAt) : null,
      failedAt: null, cancelledAt: null
    };
    existingPayment ? tx.set(`payments/${paymentId}`, payment) : tx.create(`payments/${paymentId}`, payment);
    const fulfilled = {
      ...order,
      status: "fulfilled",
      paymentStatus: "paid",
      processingStatus: "completed",
      fulfillmentStatus: "fulfilled",
      activePaymentId: "",
      paymentId,
      provider: payment.provider,
      providerOrderId: payment.providerOrderId || order.providerOrderId || "",
      providerChargeId: payment.providerChargeId || order.providerChargeId || "",
      paidAt: payment.paidAt || null,
      paidByAdminUid: String(paymentContext.paidByAdminUid || order.paidByAdminUid || ""),
      fulfilledAt: now,
      updatedAt: now,
      resultingLicenses: results,
      licenseId: results[0]?.licenseId || order.licenseId || null
    };
    tx.set(`orders/${orderId}`, fulfilled);
    queuePlatformLogInTransaction(tx, "order.fulfillment_started", { orderId, paymentId }, "payment.fulfillment", now);
    queuePlatformLogInTransaction(tx, "order.fulfilled", { orderId, paymentId, resultCount: results.length }, "payment.fulfillment", now);
    if (manualConfirmation) {
      queuePlatformLogInTransaction(tx, "payment_confirmed", {
        orderId,
        paymentId,
        actorUid: String(paymentContext.paidByAdminUid || ""),
        licenseId: results[0]?.licenseId || null
      }, String(paymentContext.paidByAdminUid || "admin"), now);
      for (const result of results) {
        queuePlatformLogInTransaction(tx, result.type === "renewal" ? "license_renewed" : "license_issued", {
          orderId,
          paymentId,
          licenseId: result.licenseId,
          actorUid: String(paymentContext.paidByAdminUid || "")
        }, String(paymentContext.paidByAdminUid || "admin"), now);
      }
    }
    return { order: customerOrderView(fulfilled), idempotentReplay: false };
  });
}

async function handleCustomer(request, env, origin, url, user) {
  const account = await ensureCustomerAccount(env, user);
  const path = url.pathname.replace(/^\/api\/v1\/customer\/?/, "");
  const parts = decodeAdminPathSegments(path);
  if (parts.length === 1 && parts[0] === "me" && request.method === "GET") {
    return json({ ok: true, account: customerAccountView(account) }, 200, origin);
  }
  if (parts.length === 1 && parts[0] === "me" && request.method === "PATCH") {
    const saved = await updateCustomerProfile(env, account, await readJson(request));
    return json({ ok: true, account: customerAccountView(saved) }, 200, origin);
  }
  if (parts.length === 2 && parts[0] === "me" && parts[1] === "photo" && request.method === "POST") {
    const saved = await uploadCustomerPhoto(env, account, request);
    return json({ ok: true, account: customerAccountView(saved.account), upload: saved.upload }, 200, origin);
  }
  if (parts.length === 2 && parts[0] === "me" && parts[1] === "photo" && request.method === "DELETE") {
    const saved = await removeCustomerPhoto(env, account);
    return json({ ok: true, account: customerAccountView(saved) }, 200, origin);
  }
  if (parts.length === 3 && parts[0] === "address" && parts[1] === "cep" && request.method === "GET") {
    await enforceRateLimit(env, request, "cep-lookup", 30, 60);
    return json({ ok: true, address: await lookupBrazilianPostalCode(parts[2]) }, 200, origin);
  }
  if (parts.length === 1 && parts[0] === "cart") {
    if (request.method === "GET") return json({ ok: true, cart: await getCustomerCart(env, account.id) }, 200, origin);
    if (request.method === "PUT") return json({ ok: true, cart: await saveCustomerCart(env, account.id, await readJson(request)) }, 200, origin);
  }
  if (parts.length === 1 && parts[0] === "favorites" && request.method === "GET") {
    return json({ ok: true, projectIds: await listCustomerFavorites(env, account.id) }, 200, origin);
  }
  if (parts.length === 2 && parts[0] === "favorites") {
    if (request.method === "POST") return json({ ok: true, favorite: await addCustomerFavorite(env, account.id, parts[1]) }, 201, origin);
    if (request.method === "DELETE") {
      await deleteDoc(env, `customerAccounts/${account.id}/favorites/${assertProjectId(parts[1])}`);
      return json({ ok: true, deleted: true }, 200, origin);
    }
  }
  if (parts.length === 1 && parts[0] === "orders") {
    if (request.method === "GET") return json({ ok: true, orders: await listOwnedOrders(env, account.id) }, 200, origin);
    if (request.method === "POST") return json({ ok: true, order: await createCustomerOrder(env, account, await readJson(request)) }, 201, origin);
  }
  if (parts[0] === "orders" && parts[1]) {
    if (parts.length === 2 && request.method === "GET") return json({ ok: true, order: await getOwnedOrder(env, account.id, parts[1]) }, 200, origin);
    if (parts.length === 3 && parts[2] === "cancel" && request.method === "POST") return json({ ok: true, order: await cancelOwnedOrder(env, account.id, parts[1], account.email) }, 200, origin);
    if (parts.length === 3 && parts[2] === "payment" && request.method === "POST") {
      const body = await readJson(request);
      const payment = pagBankEnabled(env)
        ? await startSandboxPixPayment(env, account, parts[1], body)
        : await startManualPixPayment(env, account, parts[1], body);
      return json({ ok: true, payment }, 201, origin);
    }
    if (parts.length === 3 && parts[2] === "payment-reported" && request.method === "POST") {
      const body = await readJson(request);
      if (Object.keys(body).length) {
        throw Object.assign(new Error("Esta operação não aceita campos enviados pelo cliente."), {
          status: 400,
          reason: "invalid_payload"
        });
      }
      return json({ ok: true, order: await reportManualPixPayment(env, account, parts[1]) }, 200, origin);
    }
  }
  if (parts.length === 1 && parts[0] === "licenses" && request.method === "GET") {
    return json({ ok: true, licenses: await listOwnedLicenses(env, account.id) }, 200, origin);
  }
  if (parts.length === 3 && parts[0] === "licenses" && parts[2] === "renewal-order" && request.method === "POST") {
    return json({ ok: true, order: await createRenewalOrder(env, account, parts[1], await readJson(request)) }, 201, origin);
  }
  return errorResponse(origin, 404, "not_found", "Rota do cliente não encontrada.");
}

function adminRecordView(record) {
  if (!record) return null;
  const {
    firebaseUid: _firebaseUid,
    ...safe
  } = record;
  return {
    ...safe,
    identityBound: Boolean(record.firebaseUid),
    identityBoundAt: record.identityBoundAt || null
  };
}

async function listAdminRecords(env) {
  const items = (await listCollection(env, "admins")).map(adminRecordView);
  items.sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "pt-BR"));
  return items;
}

function buildAdminRecord(body, existing = null, now = nowIso()) {
  const email = String(body.email ?? existing?.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Informe um e-mail válido para o administrador."), {
      status: 400,
      reason: "invalid_admin_email"
    });
  }

  return {
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
    firebaseUid: existing?.firebaseUid || null,
    identityBoundAt: existing?.identityBoundAt || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

async function createAdminRecord(env, body, actor) {
  body = validateAdminPayload(body);
  const email = String(body.email || "").trim().toLowerCase();
  const id = await sha256Hex(email);

  return await atomicClient(env).runTransaction(async tx => {
    const path = `admins/${id}`;
    const existing = await tx.get(path);
    if (existing) {
      throw Object.assign(new Error("Já existe um administrador cadastrado com este e-mail."), {
        status: 409,
        reason: "admin_exists"
      });
    }

    const now = nowIso();
    const record = buildAdminRecord(body, null, now);
    tx.create(path, record);
    queuePlatformLogInTransaction(
      tx,
      "admin.created",
      {
        adminId: id,
        email: record.email,
        status: record.status,
        allProjects: record.allProjects,
        projectIds: record.projectIds
      },
      actor,
      now
    );

    return { id, ...adminRecordView(record) };
  });
}

async function updateAdminRecord(env, adminId, body, actor) {
  body = validateAdminPayload(body, { partial: true });

  return await atomicClient(env).runTransaction(async tx => {
    const path = `admins/${adminId}`;
    const existing = await tx.get(path);
    if (!existing) {
      throw Object.assign(new Error("Administrador não encontrado."), {
        status: 404,
        reason: "admin_not_found"
      });
    }

    if (body.email && String(body.email).trim().toLowerCase() !== existing.email) {
      throw Object.assign(new Error("O e-mail do administrador não pode ser alterado. Exclua e cadastre novamente."), {
        status: 400,
        reason: "email_immutable"
      });
    }

    const now = nowIso();
    const next = buildAdminRecord(body, existing, now);
    tx.set(path, next);
    queuePlatformLogInTransaction(
      tx,
      "admin.updated",
      {
        adminId,
        email: next.email,
        status: next.status,
        allProjects: next.allProjects,
        projectIds: next.projectIds
      },
      actor,
      now
    );

    return { id: adminId, ...adminRecordView(next) };
  });
}

async function deleteAdminRecord(env, adminId, actor) {
  return await atomicClient(env).runTransaction(async tx => {
    const path = `admins/${adminId}`;
    const existing = await tx.get(path);
    if (!existing) {
      throw Object.assign(new Error("Administrador não encontrado."), {
        status: 404,
        reason: "admin_not_found"
      });
    }

    const now = nowIso();
    tx.delete(path);

    if (existing.firebaseUid) {
      const uidLookupId = await sha256Hex(existing.firebaseUid);
      const uidPath = `adminUids/${uidLookupId}`;
      const lookup = await tx.get(uidPath);
      if (lookup?.adminId === adminId) tx.delete(uidPath);
    }

    queuePlatformLogInTransaction(
      tx,
      "admin.deleted",
      {
        adminId,
        email: existing.email,
        identityBound: Boolean(existing.firebaseUid)
      },
      actor,
      now
    );

    return true;
  });
}

function adminCanViewCommerceOrder(admin, order) {
  if (admin?.master || admin?.allProjects) return true;
  const allowed = new Set(Array.isArray(admin?.projectIds) ? admin.projectIds : []);
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.length > 0 && items.every(item => allowed.has(item.projectId));
}

async function uploadProjectMedia(env, projectId, request, admin) {
  requirePermission(admin, "manageProjectSettings", "Você não possui permissão para enviar mídias deste projeto.");
  const body = validateMediaPayload(await readJsonBody(request, MAX_MEDIA_JSON_BYTES), { maxBytes: 5 * 1024 * 1024, allowKind: true });
  if (typeof env.__services?.uploadStorageObject !== "function") {
    throw Object.assign(new Error("Upload indisponível neste runtime."), { status: 503, reason: "storage_unavailable" });
  }
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[body.contentType];
  const path = `commerce/projects/${projectId}/${body.kind}/${crypto.randomUUID()}.${extension}`;
  const bytes = Uint8Array.from(atob(body.dataBase64), character => character.charCodeAt(0));
  const uploaded = await env.__services.uploadStorageObject(path, { bytes, contentType: body.contentType });
  const project = await getDoc(env, projectPath(projectId));
  const field = { logo: "logoUrl", icon: "iconUrl", banner: "bannerUrl" }[body.kind];
  const next = { ...project, updatedAt: nowIso() };
  if (field) {
    next[field] = uploaded.url;
    next[`${body.kind}StoragePath`] = uploaded.path;
  } else {
    const screenshots = Array.isArray(project.screenshots) ? project.screenshots : [];
    if (screenshots.length >= 12) {
      if (typeof env.__services?.deleteStorageObject === "function") {
        await env.__services.deleteStorageObject(uploaded.path).catch(() => {});
      }
      throw Object.assign(new Error("O limite de 12 screenshots foi atingido."), { status: 409, reason: "screenshot_limit" });
    }
    next.screenshots = [...screenshots, uploaded.url];
    next.screenshotStoragePaths = [...(Array.isArray(project.screenshotStoragePaths) ? project.screenshotStoragePaths : []), uploaded.path];
  }
  delete next.id;
  await setDoc(env, projectPath(projectId), next);
  return { ...uploaded, kind: body.kind, project: { id: projectId, ...next } };
}

async function handleAdmin(request, env, origin, url, admin) {
  const method = request.method;
  const path = url.pathname.replace(/^\/api\/v1\/admin\/?/, "");
  const parts = decodeAdminPathSegments(path);

  if (parts.length === 1 && parts[0] === "me") {
    if (method !== "GET") {
      return errorResponse(origin, 405, "method_not_allowed", "Use GET para esta rota.", { expectedMethods: ["GET"] });
    }
    return json({ ok: true, authorized: true, administrator: admin }, 200, origin);
  }

  if (parts[0] === "orders") {
    requirePermission(admin, "viewOrders", "Você não possui permissão para visualizar pedidos.");
    if (parts.length === 3 && parts[2] === "confirm-payment" && request.method === "POST") {
      requirePermission(admin, "manageOrders", "Você não possui permissão para confirmar pagamentos.");
      assertRecentAuthentication(admin);
      const body = await readJson(request);
      if (Object.keys(body).length) {
        throw Object.assign(new Error("A confirmação não aceita dados financeiros enviados pelo painel."), {
          status: 400,
          reason: "invalid_payload"
        });
      }
      const result = await confirmManualPixOrder(env, admin, parts[1]);
      return json({ ok: true, ...result }, 200, origin);
    }
    if (request.method !== "GET") return errorResponse(origin, 405, "method_not_allowed", "Pedidos são somente leitura no painel.", { expectedMethods: ["GET"] });
    if (parts.length === 1) {
      let orders = await listCollection(env, "orders");
      orders = orders.filter(order => adminCanViewCommerceOrder(admin, order));
      orders = orders.map(customerOrderView)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json({ ok: true, orders: orders.slice(0, 200) }, 200, origin);
    }
    const order = await getDoc(env, `orders/${assertCommerceId("orders", parts[1])}`);
    if (!order || !adminCanViewCommerceOrder(admin, order)) {
      return errorResponse(origin, 404, "order_not_found", "Pedido não encontrado.");
    }
    const audit = (await listCollection(env, "platformLogs"))
      .filter(log => log?.details?.orderId === order.orderId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 50);
    return json({ ok: true, order: customerOrderView(order), audit }, 200, origin);
  }

  if (parts[0] === "payments") {
    requirePermission(admin, "viewPayments", "Você não possui permissão para visualizar pagamentos.");
    if (parts.length === 3 && parts[2] === "reconcile" && request.method === "POST") {
      requirePermission(admin, "manageOrders", "Você não possui permissão para reconciliar pagamentos.");
      assertRecentAuthentication(admin);
      return json({
        ok: true,
        payment: await reconcileSandboxPaymentAsAdmin(env, admin, parts[1], await readJson(request))
      }, 200, origin);
    }
    if (request.method !== "GET") return errorResponse(origin, 405, "method_not_allowed", "Pagamentos são somente leitura no painel.", { expectedMethods: ["GET"] });
    if (parts.length === 1) {
      const visiblePayments = [];
      for (const payment of await listCollection(env, "payments")) {
        const orderId = payment.orderId ? assertCommerceId("orders", payment.orderId) : "";
        const order = orderId ? await getDoc(env, `orders/${orderId}`) : null;
        if (order && adminCanViewCommerceOrder(admin, order)) visiblePayments.push(payment);
      }
      visiblePayments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json({ ok: true, payments: visiblePayments.slice(0, 200) }, 200, origin);
    }
    const payment = await getDoc(env, `payments/${assertCommerceId("payments", parts[1])}`);
    const paymentOrder = payment?.orderId
      ? await getDoc(env, `orders/${assertCommerceId("orders", payment.orderId)}`)
      : null;
    if (!payment || !paymentOrder || !adminCanViewCommerceOrder(admin, paymentOrder)) {
      return errorResponse(origin, 404, "payment_not_found", "Pagamento não encontrado.");
    }
    return json({ ok: true, payment }, 200, origin);
  }

  if (parts[0] === "admins") {
    if (!admin.master) {
      return errorResponse(origin, 403, "master_required", "Somente o administrador master pode gerenciar administradores.");
    }

    if (parts.length === 1 && method === "GET") {
      return json({ ok: true, admins: await listAdminRecords(env) }, 200, origin);
    }

    if (parts.length === 1 && method === "POST") {
      assertRecentAuthentication(admin);
      const body = await readJson(request);
      if (String(body.email || "").trim().toLowerCase() === String(admin.email || "").trim().toLowerCase()) {
        return errorResponse(origin, 409, "master_account", "A conta master não precisa ser cadastrada novamente.");
      }
      const actor = admin.email || admin.uid;
      return json({ ok: true, admin: await createAdminRecord(env, body, actor) }, 201, origin);
    }

    if (parts.length === 1) {
      return errorResponse(origin, 405, "method_not_allowed", "Método não permitido para administradores.", { expectedMethods: ["GET", "POST"] });
    }

    const adminId = parts[1] ? assertAdminId(parts[1]) : "";
    if (adminId && parts.length === 2) {
      const actor = admin.email || admin.uid;

      if (method === "PATCH") {
        assertRecentAuthentication(admin);
        return json({
          ok: true,
          admin: await updateAdminRecord(env, adminId, await readJson(request), actor)
        }, 200, origin);
      }

      if (method === "DELETE") {
        assertRecentAuthentication(admin);
        await deleteAdminRecord(env, adminId, actor);
        return json({ ok: true, deleted: true }, 200, origin);
      }

      return errorResponse(origin, 405, "method_not_allowed", "Método não permitido para este administrador.", { expectedMethods: ["PATCH", "DELETE"] });
    }

    return errorResponse(origin, 404, "not_found", "Rota de administradores não encontrada.");
  }

  if (parts.length === 1 && parts[0] === "platform-logs") {
    if (!admin.master) {
      return errorResponse(origin, 403, "master_required", "Somente o administrador master pode visualizar a auditoria da plataforma.");
    }
    if (method !== "GET") {
      return errorResponse(origin, 405, "method_not_allowed", "Use GET para esta rota.", { expectedMethods: ["GET"] });
    }

    const logs = await listCollection(env, "platformLogs");
    logs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return json({ ok: true, logs: logs.slice(0, 100) }, 200, origin);
  }

  if (parts.length === 1 && parts[0] === "payment-settings") {
    requirePermission(admin, "managePlatformSettings", "Você não possui permissão para configurar pagamentos.");
    if (method === "GET") {
      return json({
        ok: true,
        settings: await getPaymentSettings(env),
        runtime: {
          paymentProvider: runtimePaymentProvider(env),
          pagbankEnabled: pagBankEnabled(env)
        }
      }, 200, origin);
    }
    if (method === "PATCH") {
      assertRecentAuthentication(admin);
      return json({ ok: true, settings: await updatePaymentSettings(env, await readJson(request), admin) }, 200, origin);
    }
    return errorResponse(origin, 405, "method_not_allowed", "Use GET ou PATCH para configurações de pagamento.", { expectedMethods: ["GET", "PATCH"] });
  }

  if (parts.length === 1 && parts[0] === "dashboard") {
    if (method !== "GET") {
      return errorResponse(origin, 405, "method_not_allowed", "Use GET para esta rota.", { expectedMethods: ["GET"] });
    }
    requirePermission(admin, "viewDashboard", "Você não possui permissão para visualizar o dashboard.");
    const requestedProjectIdRaw = url.searchParams.get("projectId") || "";
    const requestedProjectId = requestedProjectIdRaw ? assertProjectId(requestedProjectIdRaw) : "";
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
        projects = projects.map(projectSummaryView);
        projects.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
        return json({ ok: true, projects }, 200, origin);
      }
      if (method === "POST") {
        requirePermission(admin, "manageProjects", "Você não possui permissão para criar projetos.");
        if (!admin.master && !admin.allProjects) {
          return errorResponse(origin, 403, "all_projects_required", "Para criar projetos, este administrador precisa ter acesso a todos os projetos.");
        }
        const project = await createProject(env, await readJson(request), admin);
        return json({ ok: true, project: projectDetailView(project, admin) }, 201, origin);
      }

      return errorResponse(origin, 405, "method_not_allowed", "Método não permitido para projetos.", { expectedMethods: ["GET", "POST"] });
    }

    const projectId = parts[1] ? assertProjectId(parts[1]) : "";
    if (!projectId || !(await projectExists(env, projectId))) {
      return errorResponse(origin, 404, "project_not_found", "Projeto não encontrado.");
    }

    requireProjectAccess(admin, projectId);

    if (parts.length === 3 && parts[2] === "media" && method === "POST") {
      const upload = await uploadProjectMedia(env, projectId, request, admin);
      return json({ ok: true, upload, project: projectDetailView(upload.project, admin) }, 201, origin);
    }

    if (parts.length === 3 && parts[2] === "catalog-preview") {
      if (method !== "GET") {
        return errorResponse(origin, 405, "method_not_allowed", "Use GET para esta rota.", { expectedMethods: ["GET"] });
      }
      if (!can(admin, "managePlans") && !can(admin, "manageProjectSettings")) {
        return errorResponse(
          origin,
          403,
          "permission_denied",
          "Você não possui permissão para visualizar a prévia comercial deste projeto."
        );
      }
      const rawProject = await getDoc(env, projectPath(projectId));
      const candidate = await catalogProjectCandidate(env, rawProject);
      return json({
        ok: true,
        preview: {
          published: rawProject.status === "active" && candidate.plans.length > 0,
          project: candidate
        }
      }, 200, origin);
    }

    if (parts.length === 2) {
      if (method === "GET") {
        const rawProject = await getDoc(env, projectPath(projectId));
        const needsIntegration = Boolean(
          admin.master ||
          admin.permissions?.viewIntegration ||
          admin.permissions?.manageLicenses ||
          admin.permissions?.manageTrial
        );
        const project = needsIntegration
          ? await ensureProjectIntegrationCode(env, rawProject)
          : rawProject;
        return json({ ok: true, project: projectDetailView(project, admin) }, 200, origin);
      }
      if (method === "PATCH") {
        const body = validateProjectPayload(await readJson(request), { partial: true });
        if (body.slug) await assertAvailableProjectSlug(env, slugify(body.slug), projectId);
        const saved = await atomicClient(env).runTransaction(async tx => {
          const current = await tx.get(projectPath(projectId));
          if (!current) {
            throw Object.assign(new Error("Projeto não encontrado."), {
              status: 404,
              reason: "project_not_found"
            });
          }

          const integrationCreated = !current.integrationCode;
          const restoringArchived = current.status === "archived" && body.status != null;
          const changesSettings = Object.keys(body).some(key => key !== "status");

          if (restoringArchived) {
            requirePermission(
              admin,
              "manageProjects",
              "Somente quem gerencia projetos pode restaurar um projeto arquivado."
            );
            if (changesSettings) {
              requirePermission(
                admin,
                "manageProjectSettings",
                "Você não possui permissão para alterar as configurações deste projeto."
              );
            }
            assertRecentAuthentication(admin);
          } else {
            requirePermission(
              admin,
              "manageProjectSettings",
              "Você não possui permissão para alterar as configurações deste projeto."
            );
          }

          const nextStatus = body.status != null ? body.status : current.status;
          const next = {
            ...current,
            ...body,
            id: projectId,
            name: String(body.name ?? current.name).trim(),
            slug: slugify(body.slug ?? current.slug),
            prefix: normalizePrefix(body.prefix ?? current.prefix),
            status: nextStatus,
            archivedAt: restoringArchived ? null : (current.archivedAt || null),
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

          const nextSlugLookupId = await sha256Hex(next.slug);
          const nextSlugLookupPath = `catalogSlugs/${nextSlugLookupId}`;
          const slugOwner = await tx.get(nextSlugLookupPath);
          if (slugOwner && slugOwner.projectId !== projectId) {
            throw Object.assign(new Error("Este slug já está em uso por outro projeto."), {
              status: 409,
              reason: "project_slug_exists"
            });
          }

          tx.set(projectPath(projectId), next);
          slugOwner
            ? tx.set(nextSlugLookupPath, { ...slugOwner, projectId, slug: next.slug, updatedAt: next.updatedAt })
            : tx.create(nextSlugLookupPath, { projectId, slug: next.slug, createdAt: next.updatedAt });
          if (current.slug && slugify(current.slug) !== next.slug) {
            const previousSlugLookupPath = `catalogSlugs/${await sha256Hex(slugify(current.slug))}`;
            const previousOwner = await tx.get(previousSlugLookupPath);
            if (previousOwner?.projectId === projectId) tx.delete(previousSlugLookupPath);
          }
          if (integrationCreated) {
            const integrationLookupId = await sha256Hex(next.integrationCode);
            tx.create(`integrationCodes/${integrationLookupId}`, {
              projectId,
              createdAt: current.createdAt || next.updatedAt
            });
          }
          queueLogInTransaction(
            tx,
            projectId,
            restoringArchived ? "project.restored" : "project.updated",
            {
              name: next.name,
              previousStatus: current.status,
              nextStatus: next.status
            },
            admin.email || admin.uid,
            next.updatedAt
          );
          return { id: projectId, ...next };
        });
        return json({ ok: true, project: projectDetailView(saved, admin) }, 200, origin);
      }
      if (method === "DELETE") {
        requirePermission(admin, "manageProjects", "Você não possui permissão para arquivar projetos.");
        assertRecentAuthentication(admin);
        const saved = await atomicClient(env).runTransaction(async tx => {
          const current = await tx.get(projectPath(projectId));
          if (!current) {
            throw Object.assign(new Error("Projeto não encontrado."), {
              status: 404,
              reason: "project_not_found"
            });
          }
          if (current.status === "archived") {
            return { id: projectId, ...current };
          }

          const now = nowIso();
          const next = {
            ...current,
            status: "archived",
            archivedAt: now,
            updatedAt: now
          };
          tx.set(projectPath(projectId), next);
          queueLogInTransaction(tx, projectId, "project.archived", {}, admin.email || admin.uid, now);
          return { id: projectId, ...next };
        });
        return json({ ok: true, project: projectDetailView(saved, admin) }, 200, origin);
      }

      return errorResponse(origin, 405, "method_not_allowed", "Método não permitido para este projeto.", { expectedMethods: ["GET", "PATCH", "DELETE"] });
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

      return errorResponse(origin, 405, "method_not_allowed", "Método não permitido para esta coleção.", { expectedMethods: ["GET", "POST"] });
    }

    const rawEntityId = parts[3];
    if (!rawEntityId) return errorResponse(origin, 404, "not_found", "Registro não informado.");
    const entityId = assertEntityId(entity, rawEntityId);

    if (entity === "licenses" && parts.length === 5 && method === "POST") {
      const action = parts[4];
      const body = await readJson(request).catch(() => ({}));
      return json({ ok: true, license: await licenseAction(env, projectId, entityId, action, body, admin) }, 200, origin);
    }

    if (entity === "trials" && parts.length === 5 && parts[4] === "reset" && method === "POST") {
      const path = `${entityPath(projectId, "trials")}/${entityId}`;
      const reset = await atomicClient(env).runTransaction(async tx => {
        const trial = await tx.get(path);
        if (!trial) {
          throw Object.assign(new Error("Trial não encontrado."), {
            status: 404,
            reason: "trial_not_found"
          });
        }
        const now = nowIso();
        tx.delete(path);
        queueLogInTransaction(tx, projectId, "trial.reset", { deviceHash: entityId }, admin.email || admin.uid, now);
        return true;
      });
      return json({ ok: true, reset }, 200, origin);
    }

    if (entity === "devices" && parts.length === 5 && parts[4] === "deactivate" && method === "POST") {
      const path = `${entityPath(projectId, "devices")}/${entityId}`;
      const saved = await atomicClient(env).runTransaction(async tx => {
        const device = await tx.get(path);
        if (!device) {
          throw Object.assign(new Error("Dispositivo não encontrado."), {
            status: 404,
            reason: "device_not_found"
          });
        }
        if (device.active === false) return device;

        const now = nowIso();
        const next = { ...device, active: false, deactivatedAt: now, updatedAt: now };
        tx.set(path, next);

        const activationId = randomId("act");
        tx.create(`projects/${projectId}/activations/${activationId}`, {
          licenseId: device.licenseId || null,
          customerId: device.customerId || null,
          deviceHash: entityId,
          type: "deactivate",
          source: "admin",
          actor: admin.email || admin.uid,
          createdAt: now
        });

        queueLogInTransaction(
          tx,
          projectId,
          "device.deactivated.admin",
          { deviceId: entityId, licenseId: device.licenseId },
          admin.email || admin.uid,
          now
        );
        return { id: entityId, ...next };
      });
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

        await atomicClient(env).runTransaction(async tx => {
          const current = await tx.get(path);
          if (!current) {
            throw Object.assign(new Error("Registro não encontrado."), {
              status: 404,
              reason: "not_found"
            });
          }

          if (entity === "customers") {
            const licenses = await tx.queryByField(
              `projects/${projectId}`,
              "licenses",
              "customerId",
              entityId
            );

            if (licenses.length > 0) {
              throw Object.assign(
                new Error("Este cliente possui licença(s) vinculada(s) e não pode ser excluído. Desative o cadastro para preservar o histórico."),
                {
                  status: 409,
                  reason: "customer_has_licenses",
                  details: { licenseCount: licenses.length }
                }
              );
            }
          }

          const now = nowIso();
          tx.delete(path);
          queueLogInTransaction(
            tx,
            projectId,
            `${entity.slice(0, -1)}.deleted`,
            { id: entityId },
            admin.email || admin.uid,
            now
          );
        });

        return json({ ok: true, deleted: true }, 200, origin);
      }

      return errorResponse(origin, 405, "method_not_allowed", "Método não permitido para este registro.", { expectedMethods: ["GET", "PATCH", "DELETE"] });
    }
  }

  return errorResponse(origin, 404, "not_found", "Rota administrativa não encontrada.");
}


function pagBankToken(env, environment) {
  const token = environment === "production"
    ? env.PAGBANK_TOKEN
    : env.PAGBANK_SANDBOX_TOKEN;

  if (!String(token || "").trim()) {
    throw Object.assign(new Error("PagBank não está configurado para este ambiente."), {
      status: 503,
      reason: "payment_provider_not_configured"
    });
  }

  return String(token).trim();
}

function pagBankProvider(env, environment) {
  const token = pagBankToken(env, environment);
  const cached = pagBankProviderCache.get(environment);
  if (cached?.token === token) return cached.provider;

  const provider = new PagBankProvider({ environment, token });
  pagBankProviderCache.set(environment, { token, provider });
  return provider;
}

function parsePagBankWebhookBody(rawBody) {
  try {
    return JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw Object.assign(new Error("Payload PagBank inválido."), {
      status: 400,
      reason: "invalid_pagbank_webhook"
    });
  }
}

function webhookNoContent() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function handlePagBankWebhook(request, env, environment) {
  if (!pagBankEnabled(env)) {
    throw Object.assign(new Error("PagBank está congelado nesta versão."), { status: 404, reason: "pagbank_disabled" });
  }
  const provider = pagBankProvider(env, environment);
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const signatureHeader = request.headers.get("x-payload-signature");

  const authentic = await provider.verifyWebhook({
    rawBody,
    signatureHeader
  });

  if (!authentic) {
    throw Object.assign(new Error("Assinatura do webhook PagBank inválida."), {
      status: 401,
      reason: "invalid_webhook_signature"
    });
  }

  const payload = parsePagBankWebhookBody(rawBody);
  const productOrigin = String(request.headers.get("x-product-origin") || "").toUpperCase();
  const productId = String(request.headers.get("x-product-id") || "").trim();

  if (productOrigin && productOrigin !== "ORDER") {
    throw Object.assign(new Error("Origem do webhook PagBank incompatível."), {
      status: 400,
      reason: "invalid_pagbank_webhook"
    });
  }

  if (productId && productId !== String(payload?.id || "")) {
    throw Object.assign(new Error("Identificador do webhook PagBank não confere."), {
      status: 400,
      reason: "invalid_pagbank_webhook"
    });
  }

  const events = provider.normalizeEvents(payload);

  // O endpoint Sandbox existe somente para homologação. Mesmo um webhook
  // autenticamente assinado nunca pode alterar payments/orders/licenças reais.
  if (environment === "sandbox") {
    structuredLog(env, "info", "pagbank.sandbox_webhook_verified", {
      providerOrderId: String(payload?.id || ""),
      eventCount: events.length,
      statuses: events.map(event => event.providerStatus).slice(0, 10)
    });
    return webhookNoContent();
  }

  for (const normalized of events) {
    if (!normalized.status) {
      structuredLog(env, "warn", "pagbank.webhook_unknown_status", {
        providerOrderId: normalized.providerOrderId,
        providerChargeId: normalized.providerChargeId,
        providerStatus: normalized.providerStatus
      });
      continue;
    }
    let paymentId;
    try {
      paymentId = assertCommerceId("payments", normalized.paymentId);
    } catch {
      structuredLog(env, "warn", "pagbank.webhook_unknown_reference", {
        providerOrderId: normalized.providerOrderId,
        providerChargeId: normalized.providerChargeId
      });
      continue;
    }

    const payment = await getDoc(env, `payments/${paymentId}`);
    if (!payment) {
      structuredLog(env, "warn", "pagbank.webhook_payment_not_found", {
        paymentId,
        providerOrderId: normalized.providerOrderId,
        providerChargeId: normalized.providerChargeId
      });
      continue;
    }

    if (
      payment.provider !== "pagbank" ||
      payment.providerEnvironment !== "production"
    ) {
      throw Object.assign(new Error("Pagamento local não pertence ao ambiente de produção PagBank."), {
        status: 409,
        reason: "payment_environment_mismatch"
      });
    }

    if (
      payment.providerOrderId &&
      payment.providerOrderId !== normalized.providerOrderId
    ) {
      throw Object.assign(new Error("Pedido PagBank não corresponde ao pagamento local."), {
        status: 409,
        reason: "payment_provider_order_mismatch"
      });
    }

    if (
      payment.providerChargeId &&
      payment.providerChargeId !== normalized.providerChargeId
    ) {
      throw Object.assign(new Error("Cobrança PagBank não corresponde ao pagamento local."), {
        status: 409,
        reason: "payment_provider_charge_mismatch"
      });
    }

    if (
      !Number.isSafeInteger(normalized.amountCents) ||
      normalized.amountCents !== payment.amountCents ||
      normalized.currency !== payment.currency
    ) {
      throw Object.assign(new Error("Valor da notificação PagBank diverge do pagamento local."), {
        status: 409,
        reason: "payment_amount_mismatch"
      });
    }

    const event = {
      ...normalized,
      paymentId,
      orderId: payment.orderId
    };

    const recorded = await recordPaymentEvent({
      atomicClient: atomicClient(env),
      normalizedEvent: event,
      hash: sha256Hex,
      now: nowIso
    });

    if (recorded.payment?.status === "paid") {
      await finalizePaidOrder(env, payment.orderId, {
        ...recorded.payment,
        paymentId,
        orderId: payment.orderId,
        accountId: payment.accountId,
        status: "paid",
        amountCents: payment.amountCents,
        currency: payment.currency,
        provider: "pagbank",
        providerPaymentId: normalized.providerChargeId,
        providerOrderId: normalized.providerOrderId,
        providerChargeId: normalized.providerChargeId,
        method: normalized.method,
        providerPaidAt: normalized.providerPaidAt || recorded.payment.providerPaidAt,
        paidAt: normalized.providerPaidAt || recorded.payment.paidAt
      });
    }
  }

  return webhookNoContent();
}

const ROUTE_METHODS = Object.freeze({
  "/": "GET",
  "/health": "GET",
  "/api/v1/catalog": "GET",
  "/api/v1/payment-config": "GET",
  "/api/v1/project/config": "POST",
  "/api/v1/trial/start": "POST",
  "/api/v1/trial/validate": "POST",
  "/api/v1/license/activate": "POST",
  "/api/v1/license/validate": "POST",
  "/api/v1/license/deactivate": "POST",
  "/api/v1/webhooks/pagbank": "POST",
  "/api/v1/webhooks/pagbank/sandbox": "POST"
});

function isPublicApiPath(pathname) {
  return pathname.startsWith("/api/v1/catalog/") || [
    "/api/v1/catalog",
    "/api/v1/payment-config",
    "/api/v1/project/config",
    "/api/v1/trial/start",
    "/api/v1/trial/validate",
    "/api/v1/license/activate",
    "/api/v1/license/validate",
    "/api/v1/license/deactivate"
  ].includes(pathname);
}

async function routeRequest(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const publicApi = isPublicApiPath(url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, publicApi) });
    }

    const expectedMethod = ROUTE_METHODS[url.pathname];
    if (expectedMethod && request.method !== expectedMethod) {
      return errorResponse(
        origin,
        405,
        "method_not_allowed",
        `Use o método ${expectedMethod} para esta rota.`,
        { expectedMethod },
        publicApi
      );
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
          runtime: env.__services?.runtime || "cloudflare-worker",
          adminSdkConfigured: Boolean(env.__services),
          serviceAccountConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON),
          adminConfigured: Boolean(env.ADMIN_FIREBASE_UID),
          offlineEntitlements: "ES256"
        }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/v1/catalog") {
        await enforceRateLimit(env, request, "catalog", 120, 60);
        return json({ ok: true, catalog: await publicCatalog(env) }, 200, origin, true);
      }

      if (url.pathname.startsWith("/api/v1/catalog/")) {
        if (request.method !== "GET") {
          return errorResponse(origin, 405, "method_not_allowed", "Use o método GET para esta rota.", { expectedMethod: "GET" }, true);
        }
        await enforceRateLimit(env, request, "catalog-detail", 120, 60);
        const parts = decodeAdminPathSegments(url.pathname.replace(/^\/api\/v1\/catalog\/?/, ""));
        if (parts.length !== 1) return errorResponse(origin, 404, "not_found", "Programa não encontrado.", null, true);
        return json({ ok: true, project: await publicCatalogProject(env, parts[0]) }, 200, origin, true);
      }

      if (request.method === "GET" && url.pathname === "/api/v1/payment-config") {
        await enforceRateLimit(env, request, "payment-config", 120, 60);
        const settings = await getPaymentSettings(env);
        assertManualPixOperational(env, settings);
        return json({ ok: true, payment: publicPaymentSettings(settings) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/project/config") {
        await enforceRateLimit(env, request, "project-config", 120, 60);
        const body = await readJson(request);
        return json({ ok: true, project: await publicProjectConfig(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/trial/start") {
        await enforceRateLimit(env, request, "trial-start-burst", 10, 600);
        await enforceRateLimit(env, request, "trial-start-hourly", 30, 3600);
        const body = await readJson(request);
        return json({ ok: true, trial: await publicTrialStart(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/trial/validate") {
        await enforceRateLimit(env, request, "trial-validate", 120, 300);
        const body = await readJson(request);
        return json({ ok: true, trial: await publicTrialValidate(env, body, origin) }, 200, origin, true);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/webhooks/pagbank") {
        return await handlePagBankWebhook(request, env, "production");
      }

      if (request.method === "POST" && url.pathname === "/api/v1/webhooks/pagbank/sandbox") {
        return await handlePagBankWebhook(request, env, "sandbox");
      }

      if (url.pathname.startsWith("/api/v1/admin/")) {
        const auth = await requireAdmin(request, env);
        if (!auth.ok) return errorResponse(origin, auth.status, auth.error, auth.message);
        return await handleAdmin(request, env, origin, url, auth.user);
      }

      if (url.pathname.startsWith("/api/v1/customer/")) {
        await enforceRateLimit(env, request, "customer-api", 180, 60);
        const auth = await requireFirebaseUser(request, env);
        if (!auth.ok) return errorResponse(origin, auth.status, auth.error, auth.message);
        return await handleCustomer(request, env, origin, url, auth.user);
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
      const requestedStatus = Number(error?.status);
      const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
        ? requestedStatus
        : 500;
      const serverError = status >= 500;
      const safeError = serverError
        ? (["upstream_error", "upstream_timeout"].includes(error?.reason) ? error.reason : "internal_error")
        : (error?.reason || "invalid_request");
      const safeMessage = serverError
        ? (status === 504 ? "Serviço temporariamente indisponível." : "Erro interno do servidor.")
        : (error?.message || "Requisição inválida.");

      structuredLog(env, "error", "request.error", {
        requestId: requestIdFor(request),
        method: request.method,
        path: url.pathname,
        status,
        reason: safeError,
        errorName: error?.name || "Error"
      });

      return errorResponse(
        origin,
        status,
        safeError,
        safeMessage,
        serverError ? null : error?.details || null,
        publicApi
      );
    }
}

const requestIds = new WeakMap();

function requestIdFor(request) {
  if (requestIds.has(request)) return requestIds.get(request);

  const candidate = String(request.headers.get("X-Request-Id") || "").trim();
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(candidate)
    ? candidate
    : `req_${crypto.randomUUID().replace(/-/g, "")}`;

  requestIds.set(request, requestId);
  return requestId;
}

function structuredLog(env, level, event, details = {}) {
  if (typeof env?.__services?.log === "function") {
    env.__services.log(level, event, details);
    return;
  }

  const writer = console[level] || console.log;
  writer(JSON.stringify({ event, ...details }));
}

function responseWithRequestId(response, requestId) {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function handleRequest(request, env = {}) {
  const requestId = requestIdFor(request);
  const startedAt = Date.now();
  const url = new URL(request.url);

  const response = await routeRequest(request, env);

  structuredLog(env, "info", "request.completed", {
    requestId,
    method: request.method,
    path: url.pathname,
    status: response.status,
    durationMs: Date.now() - startedAt,
    runtime: env.__services?.runtime || "cloudflare-worker"
  });

  return responseWithRequestId(response, requestId);
}

export default {
  fetch: handleRequest
};
