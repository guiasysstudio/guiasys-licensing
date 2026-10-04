import test from "node:test";
import assert from "node:assert/strict";

import {
  assertLicenseCanActivate,
  effectiveLicenseStatus,
  totalActivationDays,
  transitionLicense
} from "../src/license-policy.js";

const NOW = "2026-10-04T22:00:00.000Z";
const plusDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86400000).toISOString();

function base(overrides = {}) {
  return {
    status: "active",
    activatedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-11-01T00:00:00.000Z",
    durationDays: 30,
    renewalDaysTotal: 0,
    lifetime: false,
    ...overrides
  };
}

test("status efetivo transforma active vencida em expired", () => {
  assert.equal(
    effectiveLicenseStatus(base({ expiresAt: "2026-10-01T00:00:00.000Z" }), NOW),
    "expired"
  );
});

test("revogada é terminal para reativação, renovação e suspensão", () => {
  for (const action of ["reactivate", "renew", "suspend"]) {
    assert.throws(
      () => transitionLicense(base({ status: "revoked" }), action, { days: 30 }, NOW, plusDays),
      error => error?.reason === "license_revoked_terminal"
    );
  }
});

test("revogar novamente é idempotente", () => {
  const result = transitionLicense(base({ status: "revoked" }), "revoke", {}, NOW, plusDays);
  assert.equal(result.changed, false);
  assert.equal(result.license.status, "revoked");
});

test("suspensão preserva estado anterior e reativação o restaura", () => {
  const suspended = transitionLicense(base(), "suspend", {}, NOW, plusDays);
  assert.equal(suspended.license.status, "suspended");
  assert.equal(suspended.license.statusBeforeSuspend, "active");

  const reactivated = transitionLicense(suspended.license, "reactivate", {}, NOW, plusDays);
  assert.equal(reactivated.license.status, "active");
});

test("pending suspensa volta para pending", () => {
  const pending = base({ status: "pending", activatedAt: null, expiresAt: null });
  const suspended = transitionLicense(pending, "suspend", {}, NOW, plusDays);
  const reactivated = transitionLicense(suspended.license, "reactivate", {}, NOW, plusDays);
  assert.equal(reactivated.license.status, "pending");
});

test("licença suspensa que venceu exige renovação antes da reativação", () => {
  const suspended = base({
    status: "suspended",
    statusBeforeSuspend: "active",
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  assert.throws(
    () => transitionLicense(suspended, "reactivate", {}, NOW, plusDays),
    error => error?.reason === "license_expired"
  );
});

test("renovação mantém durationDays original e acumula dias", () => {
  const result = transitionLicense(base(), "renew", { days: 15, lifetime: false }, NOW, plusDays);
  assert.equal(result.license.durationDays, 30);
  assert.equal(result.license.renewalDaysTotal, 15);
  assert.equal(result.license.renewalCount, 1);
  assert.equal(result.license.expiresAt, "2026-11-16T00:00:00.000Z");
});

test("renovação pending acumula dias para a primeira ativação sem iniciar validade", () => {
  const pending = base({
    status: "pending",
    activatedAt: null,
    expiresAt: null,
    durationDays: 30,
    renewalDaysTotal: 5
  });
  const result = transitionLicense(pending, "renew", { days: 10 }, NOW, plusDays);
  assert.equal(result.license.expiresAt, null);
  assert.equal(result.license.renewalDaysTotal, 15);
  assert.equal(totalActivationDays(result.license), 45);
});

test("renovação expirada volta a active sem alterar duração original", () => {
  const expired = base({ status: "expired", expiresAt: "2026-10-01T00:00:00.000Z" });
  const result = transitionLicense(expired, "renew", { days: 10 }, NOW, plusDays);
  assert.equal(result.license.status, "active");
  assert.equal(result.license.durationDays, 30);
  assert.equal(result.license.expiresAt, "2026-10-14T22:00:00.000Z");
});

test("vitalícia não pode voltar para temporária", () => {
  assert.throws(
    () => transitionLicense(base({ lifetime: true, expiresAt: null }), "renew", { days: 30, lifetime: false }, NOW, plusDays),
    error => error?.reason === "lifetime_immutable"
  );
});

test("ativação recusa suspensa, expirada e revogada", () => {
  assert.equal(assertLicenseCanActivate(base({ status: "pending", activatedAt: null, expiresAt: null }), NOW), "pending");
  for (const [status, reason] of [["suspended", "suspended"], ["revoked", "revoked"]]) {
    assert.throws(
      () => assertLicenseCanActivate(base({ status }), NOW),
      error => error?.reason === reason
    );
  }
  assert.throws(
    () => assertLicenseCanActivate(base({ expiresAt: "2026-10-01T00:00:00.000Z" }), NOW),
    error => error?.reason === "expired"
  );
});
