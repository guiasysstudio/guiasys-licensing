import test from "node:test";
import assert from "node:assert/strict";

import {
  sha256HexText,
  validateEntitlementClaims,
  verifyEntitlementToken
} from "../../assets/js/entitlement-verifier.js";

function b64url(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64json(value) {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function fixture(overrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const deviceHash = await sha256HexText("DEVICE-001");
  const header = { alg: "ES256", typ: "GSL-ENT", kid: "sig_test" };
  const claims = {
    protocolVersion: "GSL-v1",
    type: "license",
    projectId: "prj_0123456789abcdefabcd",
    integrationCode: "GSL-TEST-001",
    deviceHash,
    status: "active",
    licenseId: "lic_0123456789abcdefabcd",
    expiresAt: "2026-12-01T00:00:00.000Z",
    serverTime: "2026-10-04T23:00:00.000Z",
    offlineUntil: "2026-10-11T23:00:00.000Z",
    ...overrides
  };
  const input = `${b64json(header)}.${b64json(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(input)
  );
  return {
    token: `${input}.${b64url(signature)}`,
    publicJwk,
    header,
    claims,
    expected: {
      protocolVersion: "GSL-v1",
      type: "license",
      projectId: claims.projectId,
      integrationCode: claims.integrationCode,
      deviceHash,
      status: "active",
      keyId: "sig_test",
      now: "2026-10-05T00:00:00.000Z"
    }
  };
}

test("verifica assinatura e claims corretas do entitlement", async () => {
  const data = await fixture();
  const result = await verifyEntitlementToken(data.token, data.publicJwk, data.expected);
  assert.equal(result.valid, true);
  assert.equal(result.signatureValid, true);
  assert.equal(result.claimsValid, true);
  assert.deepEqual(result.errors, []);
});

test("assinatura válida não aceita deviceHash de outro dispositivo", async () => {
  const data = await fixture();
  const result = await verifyEntitlementToken(data.token, data.publicJwk, {
    ...data.expected,
    deviceHash: await sha256HexText("DEVICE-OUTRO")
  });
  assert.equal(result.signatureValid, true);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("device_mismatch"));
});

test("valida kid, protocolo, projeto e integração", async () => {
  const data = await fixture();
  const result = await verifyEntitlementToken(data.token, data.publicJwk, {
    ...data.expected,
    keyId: "sig_other",
    protocolVersion: "GSL-v2",
    projectId: "prj_other",
    integrationCode: "OTHER"
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("key_id_mismatch"));
  assert.ok(result.errors.includes("protocol_mismatch"));
  assert.ok(result.errors.includes("project_mismatch"));
  assert.ok(result.errors.includes("integration_code_mismatch"));
});

test("rejeita offlineUntil posterior à expiração", async () => {
  const data = await fixture({ offlineUntil: "2027-01-01T00:00:00.000Z" });
  const result = await verifyEntitlementToken(data.token, data.publicJwk, data.expected);
  assert.equal(result.signatureValid, true);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("offline_window_exceeds_expiry"));
});

test("validador exige typ GSL-ENT e licença exige licenseId", () => {
  const validation = validateEntitlementClaims(
    { alg: "ES256", typ: "JWT", kid: "sig_test" },
    {
      protocolVersion: "GSL-v1",
      type: "license",
      projectId: "prj_1",
      integrationCode: "ABC",
      deviceHash: "hash",
      status: "active",
      licenseId: null,
      serverTime: "2026-10-04T23:00:00.000Z",
      expiresAt: null,
      offlineUntil: "2026-10-04T23:00:00.000Z"
    },
    {
      protocolVersion: "GSL-v1",
      type: "license",
      projectId: "prj_1",
      integrationCode: "ABC",
      deviceHash: "hash",
      status: "active",
      keyId: "sig_test"
    }
  );

  assert.equal(validation.claimsValid, false);
  assert.ok(validation.errors.includes("unexpected_token_type"));
  assert.ok(validation.errors.includes("missing_license_id"));
});

test("INT-02: rejeita token legítimo após o fim da tolerância offline", async () => {
  const data = await fixture();
  const result = await verifyEntitlementToken(data.token, data.publicJwk, {
    ...data.expected,
    now: "2026-10-12T00:00:00.000Z"
  });
  assert.equal(result.signatureValid, true);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("offline_window_elapsed"));
});

test("INT-02: rejeita token após expiresAt, mesmo dentro da janela offline", async () => {
  const data = await fixture({
    expiresAt: "2026-10-06T00:00:00.000Z",
    offlineUntil: "2026-10-06T00:00:00.000Z"
  });
  const result = await verifyEntitlementToken(data.token, data.publicJwk, {
    ...data.expected,
    now: "2026-10-07T00:00:00.000Z"
  });
  assert.equal(result.signatureValid, true);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("entitlement_expired"));
});

test("INT-02: rejeita entitlement sem janela offline ou sem expiração temporária", async () => {
  for (const claims of [
    { offlineUntil: null },
    { expiresAt: null, lifetime: false },
    { expiresAt: null, lifetime: true, type: "trial" }
  ]) {
    const data = await fixture(claims);
    const result = await verifyEntitlementToken(data.token, data.publicJwk, data.expected);
    assert.equal(result.signatureValid, true);
    assert.equal(result.valid, false);
  }
});

test("INT-02: rejeita estado suspenso e contexto de verificação incompleto", async () => {
  const data = await fixture({ status: "suspended" });
  const result = await verifyEntitlementToken(data.token, data.publicJwk, data.expected);
  assert.equal(result.signatureValid, true);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("inactive_entitlement"));

  const incomplete = await verifyEntitlementToken(data.token, data.publicJwk, {});
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.errors.includes("missing_expected_keyId"));
});

test("INT-02: detecta retrocesso de relógio e horário do servidor no futuro", async () => {
  const data = await fixture();
  const rollback = await verifyEntitlementToken(data.token, data.publicJwk, {
    ...data.expected,
    now: "2026-10-05T00:00:00.000Z",
    lastTrustedTime: "2026-10-06T00:00:00.000Z"
  });
  assert.equal(rollback.valid, false);
  assert.ok(rollback.errors.includes("clock_rollback_detected"));

  const future = await fixture({ serverTime: "2026-10-06T00:00:00.000Z" });
  const result = await verifyEntitlementToken(future.token, future.publicJwk, data.expected);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("server_time_in_future"));
});

test("INT-02: autoriza licença vitalícia íntegra somente durante a janela offline", async () => {
  const data = await fixture({
    lifetime: true,
    expiresAt: null
  });
  const valid = await verifyEntitlementToken(data.token, data.publicJwk, data.expected);
  assert.equal(valid.valid, true);

  const expiredCache = await verifyEntitlementToken(data.token, data.publicJwk, {
    ...data.expected,
    now: "2026-10-12T00:00:00.000Z"
  });
  assert.equal(expiredCache.valid, false);
  assert.ok(expiredCache.errors.includes("offline_window_elapsed"));
});
