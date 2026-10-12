import test from "node:test";
import assert from "node:assert/strict";
import {
  sha256HexText,
  verifyEntitlementToken
} from "../../assets/js/entitlement-verifier.js";

const now = "2026-10-05T00:00:00.000Z";
const localDevice = "DEVICE-INT04-PERSISTED-001";
const b64 = value => Buffer.from(value).toString("base64url");
const encode = value => b64(JSON.stringify(value));

async function fixture(claimPatch = {}, headerPatch = {}) {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const claims = {
    protocolVersion: "GSL-v1",
    type: "license",
    projectId: "prj_0123456789abcdefabcd",
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    deviceHash: await sha256HexText(localDevice),
    status: "active",
    licenseId: "lic_0123456789abcdefabcd",
    lifetime: false,
    issuedAt: "2026-10-04T23:00:00.000Z",
    activatedAt: "2026-10-04T23:00:00.000Z",
    startedAt: null,
    expiresAt: "2026-11-05T00:00:00.000Z",
    serverTime: "2026-10-04T23:00:00.000Z",
    offlineUntil: "2026-10-11T00:00:00.000Z",
    ...claimPatch
  };
  const header = { alg: "ES256", typ: "GSL-ENT", kid: "sig_int04", ...headerPatch };
  const input = `${encode(header)}.${encode(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, keys.privateKey, Buffer.from(input)
  );
  const expected = {
    protocolVersion: "GSL-v1",
    type: claims.type,
    projectId: claims.projectId,
    integrationCode: claims.integrationCode,
    deviceHash: claims.deviceHash,
    keyId: "sig_int04",
    status: "active",
    now,
    trustedPublicJwk: publicJwk
  };
  return { token: `${input}.${b64(Buffer.from(signature))}`, publicJwk, expected };
}

test("INT04: entitlement ES256 autêntico, contexto fixado, dentro do prazo", async () => {
  const { token, publicJwk, expected } = await fixture();
  const r = await verifyEntitlementToken(token, publicJwk, expected);
  assert.equal(r.valid, true);
  assert.equal(r.signatureValid, true);
  assert.equal(r.claimsValid, true);
});

test("INT04: rejeita substituição da chave mesmo com token ES256 assinado pelo invasor", async () => {
  const trusted = await fixture();
  const other = await fixture();
  const r = await verifyEntitlementToken(other.token, other.publicJwk, {
    ...other.expected, trustedPublicJwk: trusted.publicJwk
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes("untrusted_signing_key"));
});

test("INT04: troca de dispositivo, projeto ou protocolo não autoriza cache", async () => {
  const data = await fixture();
  for (const patch of [
    { deviceHash: await sha256HexText("OTHER_DEVICE") },
    { projectId: "prj_outro" },
    { protocolVersion: "GSL-v2" },
    { integrationCode: "GSLI-OTHER-CODE-0001" }
  ]) {
    const r = await verifyEntitlementToken(data.token, data.publicJwk, { ...data.expected, ...patch });
    assert.equal(r.valid, false, JSON.stringify(patch));
  }
});

test("INT04: assinatura adulterada e JWS incompleto não são aceitos", async () => {
  const d = await fixture();
  const parts = d.token.split(".");
  const last = parts[2];
  const modified = `${parts[0]}.${parts[1]}.${last[0] === "A" ? "B" : "A"}${last.slice(1)}`;
  const samples = [modified, "x.y", "", "x..y", "x y.z.w", "x=.y.z", "x".repeat(16385)];
  for (const token of samples) {
    const r = await verifyEntitlementToken(token, d.publicJwk, d.expected);
    assert.equal(r.valid, false, token.slice(0, 35));
  }
});

test("INT04: rejeita assinatura ES256 sem 64 bytes", async () => {
  const d = await fixture();
  const parts = d.token.split(".");
  const invalid = `${parts[0]}.${parts[1]}.${b64(Buffer.alloc(63))}`;
  const r = await verifyEntitlementToken(invalid, d.publicJwk, d.expected);
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes("invalid_jws_structure"));
});

test("INT04: bloqueia exatamente no limite offline e na data de expiração", async () => {
  const d = await fixture();
  const offline = await verifyEntitlementToken(d.token, d.publicJwk, {
    ...d.expected, now: "2026-10-11T00:00:00.000Z"
  });
  assert.ok(offline.errors.includes("offline_window_elapsed"));
  const expired = await verifyEntitlementToken(d.token, d.publicJwk, {
    ...d.expected, now: "2026-11-05T00:00:00.000Z"
  });
  assert.ok(expired.errors.includes("entitlement_expired"));
});

test("INT04: licença vitalícia deve ter expiresAt nulo e janela offline vigente", async () => {
  const bad = await fixture({ lifetime: true });
  const r = await verifyEntitlementToken(bad.token, bad.publicJwk, bad.expected);
  assert.ok(r.errors.includes("lifetime_with_expires_at"));
  const good = await fixture({ lifetime: true, expiresAt: null });
  assert.equal((await verifyEntitlementToken(good.token, good.publicJwk, good.expected)).valid, true);
});

test("INT04: trial exige início válido, duração real e lifetime=false", async () => {
  const base = {
    type: "trial", licenseId: null, lifetime: false,
    startedAt: "2026-10-04T23:00:00.000Z",
    expiresAt: "2026-10-11T23:00:00.000Z"
  };
  const valid = await fixture(base);
  assert.equal((await verifyEntitlementToken(valid.token, valid.publicJwk, valid.expected)).valid, true);
  const cases = [
    [{ ...base, startedAt: null }, "invalid_trial_started_at"],
    [{ ...base, lifetime: true }, "invalid_trial_lifetime"],
    [{ ...base, startedAt: "2026-10-06T00:00:00.000Z" }, "trial_start_after_server_time"],
    [{ ...base, expiresAt: "2026-10-03T00:00:00.000Z" }, "trial_expiry_before_start"]
  ];
  for (const [patch, code] of cases) {
    const d = await fixture(patch);
    const r = await verifyEntitlementToken(d.token, d.publicJwk, d.expected);
    assert.equal(r.valid, false);
    assert.ok(r.errors.includes(code), code);
  }
});

test("INT04: rejeita timestamps sem fuso ou de parse permissivo", async () => {
  for (const patch of [
    { serverTime: "1" },
    { offlineUntil: "2026-10-11T00:00:00" },
    { expiresAt: "2030-01-01" }
  ]) {
    const d = await fixture(patch);
    const r = await verifyEntitlementToken(d.token, d.publicJwk, d.expected);
    assert.equal(r.valid, false);
  }
});

test("INT04: JWS com extensões críticas não suportadas não autoriza", async () => {
  const d = await fixture({}, { crit: ["b64"], b64: false });
  const r = await verifyEntitlementToken(d.token, d.publicJwk, d.expected);
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes("unsupported_jws_critical_header"));
});

test("INT04: clock rollback em relação à última referência confiável bloqueia cache", async () => {
  const d = await fixture();
  const r = await verifyEntitlementToken(d.token, d.publicJwk, {
    ...d.expected, lastTrustedTime: "2026-10-06T00:00:00.000Z"
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes("clock_rollback_detected"));
});
