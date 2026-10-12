// INT-08.2: rate-limit subject is a resource selector, NOT authenticated identity.
// The coarse ingress guard always runs before accepting a caller-controlled subject.
// Never log or persist raw license keys, device IDs or Firebase UIDs: callers hash
// these scope strings before building Firestore keys.
function textField(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : "";
}

export function publicRateLimitSubject(body, kind) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const projectId = textField(body.projectId, 96);
  const integrationCode = textField(body.integrationCode, 96).toUpperCase();
  const project = projectId || integrationCode;
  const deviceId = textField(body.deviceId, 256);
  if (!project || !deviceId) return null;

  if (kind === "trial") {
    return JSON.stringify(["trial", project, deviceId]);
  }
  if (kind === "license") {
    const licenseKey = textField(body.licenseKey, 128).toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    if (!licenseKey) return null;
    return JSON.stringify(["license", project, licenseKey, deviceId]);
  }
  return null;
}

export function authenticatedRateLimitSubject(user) {
  const uid = textField(user?.uid, 128);
  // This UID must come from requireFirebaseUser after token verification;
  // never pass request.body.uid or unverified JWT claims.
  return uid ? JSON.stringify(["firebase-uid", uid]) : null;
}
