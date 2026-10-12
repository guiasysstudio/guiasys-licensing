function base64UrlBytes(value) {
  const text = String(value || "");
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) {
    throw new TypeError("Invalid base64url JWS segment.");
  }
  const padding = "=".repeat((4 - (text.length % 4)) % 4);
  const base64 = (text + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJwsJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function isoMillis(value) {
  // Reject date-only and loosely parsed values; server emits full ISO timestamps.
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return NaN;
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : NaN;
}

export async function sha256HexText(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function validateEntitlementClaims(header, claims, expected = {}) {
  const errors = [];
  // Validar uma assinatura não significa que ela ainda autorize o uso offline.
  // "now" só é injetado em testes determinísticos; em produção usa o relógio atual.
  const now = expected.now == null
    ? Date.now()
    : expected.now instanceof Date
      ? expected.now.getTime()
      : isoMillis(expected.now);
  const maxClockSkewMs = 5 * 60 * 1000;

  for (const field of ["protocolVersion", "type", "projectId", "integrationCode", "deviceHash", "keyId"]) {
    if (!expected[field]) errors.push(`missing_expected_${field}`);
  }

  if (header?.alg !== "ES256") errors.push("unexpected_algorithm");
  if (header?.crit !== undefined || header?.b64 !== undefined) {
    errors.push("unsupported_jws_critical_header");
  }
  if (header?.typ !== "GSL-ENT") errors.push("unexpected_token_type");
  if (!header?.kid) errors.push("missing_key_id");
  if (expected.keyId && header?.kid !== expected.keyId) errors.push("key_id_mismatch");

  if (claims?.protocolVersion !== expected.protocolVersion) errors.push("protocol_mismatch");
  if (claims?.type !== expected.type) errors.push("entitlement_type_mismatch");
  if (!["license", "trial"].includes(claims?.type)) errors.push("invalid_entitlement_type");
  if (claims?.projectId !== expected.projectId) errors.push("project_mismatch");
  if (claims?.integrationCode !== expected.integrationCode) errors.push("integration_code_mismatch");
  if (claims?.deviceHash !== expected.deviceHash) errors.push("device_mismatch");
  if (claims?.status !== "active") errors.push("inactive_entitlement");
  if (expected.status && claims?.status !== expected.status) errors.push("status_mismatch");

  if (claims?.type === "license" && !claims?.licenseId) {
    errors.push("missing_license_id");
  }

  const serverTime = isoMillis(claims?.serverTime);
  if (!Number.isFinite(serverTime)) errors.push("invalid_server_time");
  if (!Number.isFinite(now)) errors.push("invalid_current_time");
  if (Number.isFinite(now) && Number.isFinite(serverTime) && serverTime > now + maxClockSkewMs) {
    errors.push("server_time_in_future");
  }

  const expiresAt = claims?.expiresAt == null ? null : isoMillis(claims.expiresAt);
  if (claims?.expiresAt != null && !Number.isFinite(expiresAt)) {
    errors.push("invalid_expires_at");
  }
  // Somente uma licença vitalícia pode omitir a expiração.
  if (typeof claims?.lifetime !== "boolean") errors.push("missing_or_invalid_lifetime");
  if (claims?.type === "trial" && claims?.lifetime !== false) {
    errors.push("invalid_trial_lifetime");
  }
  if (claims?.type === "license" && claims?.lifetime === true && claims?.expiresAt != null) {
    errors.push("lifetime_with_expires_at");
  }
  if (claims?.type === "trial" || (claims?.type === "license" && claims?.lifetime !== true)) {
    if (!Number.isFinite(expiresAt)) errors.push("missing_expires_at");
  }
  if (claims?.type === "trial") {
    const startedAt = isoMillis(claims?.startedAt);
    if (!Number.isFinite(startedAt)) errors.push("invalid_trial_started_at");
    if (Number.isFinite(startedAt) && Number.isFinite(serverTime) && startedAt > serverTime) {
      errors.push("trial_start_after_server_time");
    }
    if (Number.isFinite(startedAt) && Number.isFinite(expiresAt) && startedAt >= expiresAt) {
      errors.push("trial_expiry_before_start");
    }
  }

  const offlineUntil = claims?.offlineUntil == null ? null : isoMillis(claims.offlineUntil);
  if (!Number.isFinite(offlineUntil)) errors.push("missing_or_invalid_offline_until");

  if (Number.isFinite(serverTime) && Number.isFinite(expiresAt) && expiresAt < serverTime) {
    errors.push("entitlement_already_expired");
  }
  if (Number.isFinite(serverTime) && Number.isFinite(offlineUntil) && offlineUntil < serverTime) {
    errors.push("offline_window_in_past");
  }
  if (Number.isFinite(expiresAt) && Number.isFinite(offlineUntil) && offlineUntil > expiresAt) {
    errors.push("offline_window_exceeds_expiry");
  }

  if (Number.isFinite(now) && Number.isFinite(offlineUntil) && now >= offlineUntil) {
    errors.push("offline_window_elapsed");
  }
  if (Number.isFinite(now) && Number.isFinite(expiresAt) && now >= expiresAt) {
    errors.push("entitlement_expired");
  }

  // Um cliente pode persistir uma referência temporal confiável para detectar
  // retrocesso de relógio. Sem essa referência, só a assinatura não o detecta.
  if (expected.lastTrustedTime != null) {
    const lastTrustedTime = isoMillis(expected.lastTrustedTime);
    if (!Number.isFinite(lastTrustedTime)) {
      errors.push("invalid_last_trusted_time");
    } else if (Number.isFinite(now) && now + maxClockSkewMs < lastTrustedTime) {
      errors.push("clock_rollback_detected");
    }
  }

  return {
    claimsValid: errors.length === 0,
    errors
  };
}

export async function verifyEntitlementToken(token, publicJwk, expected = {}) {
  if (!token || !publicJwk) {
    return {
      valid: false,
      signatureValid: false,
      claimsValid: false,
      errors: ["missing_token_or_public_key"]
    };
  }

  const parts = String(token).split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      signatureValid: false,
      claimsValid: false,
      errors: ["invalid_jws"]
    };
  }

  try {
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeJwsJson(headerPart);
    const claims = decodeJwsJson(payloadPart);

    if (
      publicJwk.kty !== "EC" ||
      publicJwk.crv !== "P-256" ||
      header?.alg !== "ES256"
    ) {
      const validation = validateEntitlementClaims(header, claims, expected);
      return {
        valid: false,
        signatureValid: false,
        claimsValid: validation.claimsValid,
        errors: [...new Set(["invalid_public_key_or_algorithm", ...validation.errors])],
        header,
        claims
      };
    }

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const signatureValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64UrlBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    );

    const validation = validateEntitlementClaims(header, claims, expected);
    const errors = [...validation.errors];
    if (!signatureValid) errors.unshift("invalid_signature");

    return {
      valid: signatureValid && validation.claimsValid,
      signatureValid,
      claimsValid: validation.claimsValid,
      errors,
      header,
      claims
    };
  } catch (error) {
    return {
      valid: false,
      signatureValid: false,
      claimsValid: false,
      errors: ["verification_error"],
      error: error?.message || String(error)
    };
  }
}
