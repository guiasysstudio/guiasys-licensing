function base64UrlBytes(value) {
  const text = String(value || "");
  const padding = "=".repeat((4 - (text.length % 4)) % 4);
  const base64 = (text + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJwsJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function isoMillis(value) {
  const millis = value ? new Date(value).getTime() : NaN;
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

  if (header?.alg !== "ES256") errors.push("unexpected_algorithm");
  if (header?.typ !== "GSL-ENT") errors.push("unexpected_token_type");
  if (!header?.kid) errors.push("missing_key_id");
  if (expected.keyId && header?.kid !== expected.keyId) errors.push("key_id_mismatch");

  if (claims?.protocolVersion !== expected.protocolVersion) errors.push("protocol_mismatch");
  if (claims?.type !== expected.type) errors.push("entitlement_type_mismatch");
  if (claims?.projectId !== expected.projectId) errors.push("project_mismatch");
  if (claims?.integrationCode !== expected.integrationCode) errors.push("integration_code_mismatch");
  if (claims?.deviceHash !== expected.deviceHash) errors.push("device_mismatch");

  if (expected.status && claims?.status !== expected.status) {
    errors.push("status_mismatch");
  }

  if (claims?.type === "license" && !claims?.licenseId) {
    errors.push("missing_license_id");
  }

  const serverTime = isoMillis(claims?.serverTime);
  if (!Number.isFinite(serverTime)) errors.push("invalid_server_time");

  const expiresAt = claims?.expiresAt == null ? null : isoMillis(claims.expiresAt);
  if (claims?.expiresAt != null && !Number.isFinite(expiresAt)) {
    errors.push("invalid_expires_at");
  }

  const offlineUntil = claims?.offlineUntil == null ? null : isoMillis(claims.offlineUntil);
  if (claims?.offlineUntil != null && !Number.isFinite(offlineUntil)) {
    errors.push("invalid_offline_until");
  }

  if (Number.isFinite(serverTime) && Number.isFinite(expiresAt) && expiresAt < serverTime) {
    errors.push("entitlement_already_expired");
  }

  if (Number.isFinite(serverTime) && Number.isFinite(offlineUntil) && offlineUntil < serverTime) {
    errors.push("offline_window_in_past");
  }

  if (Number.isFinite(expiresAt) && Number.isFinite(offlineUntil) && offlineUntil > expiresAt) {
    errors.push("offline_window_exceeds_expiry");
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
