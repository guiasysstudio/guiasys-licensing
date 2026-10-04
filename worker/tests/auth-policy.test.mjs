import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAccountTokenStillValid,
  assertRecentAuthentication,
  parseCacheMaxAge,
  validateFirebaseClaims
} from "../src/auth-policy.js";

const NOW = 1791154800;
const PROJECT = "guiasys-licensing";

function token(overrides = {}) {
  return {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: "uid-admin-123",
    exp: NOW + 3600,
    iat: NOW - 60,
    auth_time: NOW - 60,
    firebase: { sign_in_provider: "google.com" },
    ...overrides
  };
}

test("Firebase claims exige auth_time e provedor permitido", () => {
  const result = validateFirebaseClaims(token(), PROJECT, NOW);
  assert.equal(result.uid, "uid-admin-123");
  assert.equal(result.signInProvider, "google.com");

  assert.throws(
    () => validateFirebaseClaims(token({ auth_time: undefined }), PROJECT, NOW),
    error => error?.reason === "invalid_token"
  );

  assert.throws(
    () => validateFirebaseClaims(token({ firebase: { sign_in_provider: "anonymous" } }), PROJECT, NOW),
    error => error?.reason === "provider_not_allowed"
  );
});

test("Firebase claims aceita password além de Google", () => {
  const result = validateFirebaseClaims(
    token({ firebase: { sign_in_provider: "password" } }),
    PROJECT,
    NOW
  );
  assert.equal(result.signInProvider, "password");
});

test("cache-control usa max-age e limita valor absurdo", () => {
  assert.equal(parseCacheMaxAge("public, max-age=2345, must-revalidate"), 2345);
  assert.equal(parseCacheMaxAge("no-cache", 300), 300);
  assert.equal(parseCacheMaxAge("max-age=999999"), 86400);
});

test("estado real da conta bloqueia disabled e token revogado", () => {
  assert.equal(
    assertAccountTokenStillValid(
      { localId: "uid-admin-123", disabled: false, validSince: String(NOW - 120) },
      token()
    ),
    true
  );

  assert.throws(
    () => assertAccountTokenStillValid(
      { localId: "uid-admin-123", disabled: true, validSince: "0" },
      token()
    ),
    error => error?.reason === "firebase_account_disabled"
  );

  assert.throws(
    () => assertAccountTokenStillValid(
      { localId: "uid-admin-123", disabled: false, validSince: String(NOW) },
      token()
    ),
    error => error?.reason === "firebase_token_revoked"
  );
});

test("ações críticas exigem autenticação recente", () => {
  assert.equal(assertRecentAuthentication({ authTime: NOW - 120 }, 900, NOW), true);
  assert.throws(
    () => assertRecentAuthentication({ authTime: NOW - 901 }, 900, NOW),
    error => error?.reason === "recent_auth_required"
  );
});
