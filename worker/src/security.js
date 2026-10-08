const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STORAGE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_STORAGE_OBJECT_PATH_LENGTH = 1024;
const PROJECT_ID_PATTERN = /^prj_[a-f0-9]{20}$/;
const ADMIN_ID_PATTERN = /^[a-f0-9]{64}$/;
const ENTITY_ID_PATTERNS = Object.freeze({
  plans: /^plan_[a-f0-9]{20}$/,
  customers: /^cus_[a-f0-9]{20}$/,
  licenses: /^lic_[a-f0-9]{20}$/,
  trials: /^[a-f0-9]{64}$/,
  devices: /^[a-f0-9]{64}$/,
  activations: /^act_[a-f0-9]{20}$/,
  logs: /^log_[a-f0-9]{20}$/
});

const COMMERCE_ID_PATTERNS = Object.freeze({
  accounts: /^acct_[a-f0-9]{20}$/,
  orders: /^ord_[a-f0-9]{20}$/,
  payments: /^pay_[a-f0-9]{20}$/,
  paymentEvents: /^pevt_[a-f0-9]{20}$/
});

function invalidIdentifier(label) {
  return Object.assign(new Error(`${label} inválido.`), {
    status: 400,
    reason: "invalid_identifier"
  });
}

export function assertSafePathSegment(value, label = "Identificador") {
  const segment = String(value ?? "").trim();
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    !SAFE_PATH_SEGMENT_PATTERN.test(segment)
  ) {
    throw invalidIdentifier(label);
  }
  return segment;
}

export function assertProjectId(value) {
  const projectId = assertSafePathSegment(value, "projectId");
  if (!PROJECT_ID_PATTERN.test(projectId)) throw invalidIdentifier("projectId");
  return projectId;
}

export function assertAdminId(value) {
  const adminId = assertSafePathSegment(value, "adminId");
  if (!ADMIN_ID_PATTERN.test(adminId)) throw invalidIdentifier("adminId");
  return adminId;
}

export function assertEntityId(entity, value) {
  const safeEntity = assertSafePathSegment(entity, "Entidade");
  const pattern = ENTITY_ID_PATTERNS[safeEntity];
  if (!pattern) throw invalidIdentifier("Entidade");

  const entityId = assertSafePathSegment(value, `${safeEntity}Id`);
  if (!pattern.test(entityId)) throw invalidIdentifier(`${safeEntity}Id`);
  return entityId;
}

export function assertCommerceId(entity, value) {
  const safeEntity = assertSafePathSegment(entity, "Entidade comercial");
  const pattern = COMMERCE_ID_PATTERNS[safeEntity];
  if (!pattern) throw invalidIdentifier("Entidade comercial");

  const id = assertSafePathSegment(value, `${safeEntity}Id`);
  if (!pattern.test(id)) throw invalidIdentifier(`${safeEntity}Id`);
  return id;
}

export function assertFirestorePath(path) {
  const raw = String(path ?? "");
  if (
    !raw ||
    raw.startsWith("/") ||
    raw.endsWith("/") ||
    raw.includes("//")
  ) {
    throw invalidIdentifier("Path do Firestore");
  }

  const segments = raw.split("/");
  for (let index = 0; index < segments.length; index++) {
    assertSafePathSegment(segments[index], `Segmento Firestore ${index + 1}`);
  }

  return segments.join("/");
}

export function assertStorageObjectPath(path) {
  const raw = String(path ?? "");
  if (
    !raw ||
    raw.length > MAX_STORAGE_OBJECT_PATH_LENGTH ||
    raw.startsWith("/") ||
    raw.endsWith("/") ||
    raw.includes("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    throw invalidIdentifier("Path do Storage");
  }

  const segments = raw.split("/");
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      !STORAGE_PATH_SEGMENT_PATTERN.test(segment)
    ) {
      throw invalidIdentifier(`Segmento Storage ${index + 1}`);
    }
  }

  return segments.join("/");
}

export function decodeAdminPathSegments(path) {
  const rawSegments = String(path ?? "").split("/").filter(Boolean);

  return rawSegments.map((segment, index) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidIdentifier(`Segmento da rota ${index + 1}`);
    }

    return assertSafePathSegment(decoded, `Segmento da rota ${index + 1}`);
  });
}
