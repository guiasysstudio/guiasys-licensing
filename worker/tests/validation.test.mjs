import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_JSON_BYTES,
  readJsonBody,
  validateAdminPayload,
  validateLicenseCreatePayload,
  validatePlanPayload,
  validateProjectPayload,
  validatePublicLicensePayload
} from "../src/validation.js";

function assertApiError(fn, status = 400, reason = "invalid_request") {
  assert.throws(fn, error => {
    assert.equal(error?.status, status);
    assert.equal(error?.reason, reason);
    return true;
  });
}

test("project payload aceita tipos corretos e normaliza origins", () => {
  const payload = validateProjectPayload({
    name: "GuiaPlay",
    prefix: "GPL",
    publicCatalog: false,
    offlineDays: 7,
    validationHours: 24,
    allowedOrigins: "https://app.exemplo.com/path\nhttps://app.exemplo.com"
  });

  assert.equal(payload.name, "GuiaPlay");
  assert.equal(payload.publicCatalog, false);
  assert.deepEqual(payload.allowedOrigins, ["https://app.exemplo.com"]);
});

test("rejeita booleano em string e campos desconhecidos", () => {
  assertApiError(() => validateProjectPayload({
    name: "GuiaPlay",
    publicCatalog: "false"
  }));

  assertApiError(() => validateProjectPayload({
    name: "GuiaPlay",
    unexpectedAdminFlag: true
  }));
});

test("rejeita números não finitos e tipos coercíveis", () => {
  assertApiError(() => validatePlanPayload({ name: "Mensal", price: NaN }));
  assertApiError(() => validatePlanPayload({ name: "Mensal", durationDays: "30" }));
  assertApiError(() => validatePlanPayload({ name: "Mensal", deviceLimit: 0 }));
});

test("valida IDs recebidos dentro do payload", () => {
  const valid = validateLicenseCreatePayload({
    customerId: "cus_0123456789abcdefabcd",
    planId: "plan_0123456789abcdefabcd",
    notes: ""
  });
  assert.equal(valid.customerId, "cus_0123456789abcdefabcd");

  assertApiError(() => validateLicenseCreatePayload({
    customerId: "../admins/" + "a".repeat(64)
  }), 400, "invalid_identifier");
});

test("admin aceita somente projectIds e permissions conhecidos", () => {
  assertApiError(() => validateAdminPayload({
    email: "admin@example.com",
    allProjects: false,
    projectIds: ["../projects"],
    permissions: {}
  }), 400, "invalid_identifier");

  assertApiError(() => validateAdminPayload({
    email: "admin@example.com",
    allProjects: true,
    projectIds: [],
    permissions: { becomeMaster: true }
  }));
});

test("API pública limita device metadata e rejeita campo extra", () => {
  const payload = validatePublicLicensePayload({
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    licenseKey: "GSS-ABCDE-FGHIJ-KLMNO-PQRST",
    deviceId: "DEVICE-001",
    deviceName: "PC Principal",
    platform: "Windows",
    appVersion: "1.0.0"
  });
  assert.equal(payload.deviceId, "DEVICE-001");

  assertApiError(() => validatePublicLicensePayload({
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    licenseKey: "GSS-ABCDE-FGHIJ-KLMNO-PQRST",
    deviceId: "X".repeat(257)
  }));

  assertApiError(() => validatePublicLicensePayload({
    integrationCode: "GSLI-ABCD-EFGH-JKLM",
    licenseKey: "GSS-ABCDE-FGHIJ-KLMNO-PQRST",
    deviceId: "DEVICE-001",
    debug: true
  }));
});

test("readJsonBody aceita objeto JSON e rejeita array", async () => {
  const ok = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ hello: "world" })
  });
  assert.deepEqual(await readJsonBody(ok), { hello: "world" });

  const arrayBody = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([1, 2, 3])
  });
  await assert.rejects(() => readJsonBody(arrayBody), error => {
    assert.equal(error?.status, 400);
    assert.equal(error?.reason, "invalid_request");
    return true;
  });
});

test("readJsonBody aplica limite real mesmo sem Content-Length confiável", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x".repeat(MAX_JSON_BYTES) })
  });

  await assert.rejects(() => readJsonBody(request), error => {
    assert.equal(error?.status, 413);
    assert.equal(error?.reason, "payload_too_large");
    return true;
  });
});

test("readJsonBody exige application/json", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}"
  });

  await assert.rejects(() => readJsonBody(request), error => {
    assert.equal(error?.status, 415);
    return true;
  });
});
