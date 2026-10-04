const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
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
