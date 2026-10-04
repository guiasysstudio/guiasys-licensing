import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAdminId,
  assertEntityId,
  assertFirestorePath,
  assertProjectId,
  decodeAdminPathSegments
} from "../src/security.js";

const projectId = "prj_0123456789abcdefabcd";
const planId = "plan_0123456789abcdefabcd";
const customerId = "cus_0123456789abcdefabcd";
const licenseId = "lic_0123456789abcdefabcd";
const sha256Id = "a".repeat(64);

function assertInvalidIdentifier(fn) {
  assert.throws(fn, error => {
    assert.equal(error?.status, 400);
    assert.equal(error?.reason, "invalid_identifier");
    return true;
  });
}

test("aceita IDs gerados pelo GuiaSys Licensing", () => {
  assert.equal(assertProjectId(projectId), projectId);
  assert.equal(assertAdminId(sha256Id), sha256Id);
  assert.equal(assertEntityId("plans", planId), planId);
  assert.equal(assertEntityId("customers", customerId), customerId);
  assert.equal(assertEntityId("licenses", licenseId), licenseId);
  assert.equal(assertEntityId("devices", sha256Id), sha256Id);
  assert.equal(assertEntityId("trials", sha256Id), sha256Id);
});

test("rejeita projectId que tenta escapar do path", () => {
  for (const value of [
    "../admins/" + sha256Id,
    "projects/../admins",
    "%2e%2e%2fadmins",
    "prj_0123456789abcdefabc/",
    "prj_0123456789abcdefabc."
  ]) {
    assertInvalidIdentifier(() => assertProjectId(value));
  }
});

test("rejeita IDs de entidade com tipo ou formato incorreto", () => {
  assertInvalidIdentifier(() => assertEntityId("plans", customerId));
  assertInvalidIdentifier(() => assertEntityId("licenses", "../internal/signing"));
  assertInvalidIdentifier(() => assertEntityId("devices", "DEVICE-001"));
  assertInvalidIdentifier(() => assertEntityId("unknown", planId));
});

test("Firestore aceita apenas segmentos simples e nunca normaliza traversal", () => {
  assert.equal(
    assertFirestorePath(`projects/${projectId}/internal/signing`),
    `projects/${projectId}/internal/signing`
  );

  for (const path of [
    `projects/${projectId}/plans/../internal/signing`,
    `projects/${projectId}/plans/%2e%2e%2finternal%2fsigning`,
    `/projects/${projectId}`,
    `projects//${projectId}`,
    `projects/${projectId}/`
  ]) {
    assertInvalidIdentifier(() => assertFirestorePath(path));
  }
});

test("roteador administrativo rejeita slash e traversal codificados", () => {
  const valid = decodeAdminPathSegments(
    `projects/${projectId}/licenses/${licenseId}/renew`
  );
  assert.deepEqual(valid, [
    "projects",
    projectId,
    "licenses",
    licenseId,
    "renew"
  ]);

  for (const path of [
    `projects/${projectId}/plans/%2e%2e%2finternal%2fsigning`,
    `projects/${projectId}/plans/%2E%2E%2F%2E%2E%2Fadmins%2F${sha256Id}`,
    `projects/${projectId}/plans/%252e%252e%252finternal%252fsigning`,
    `projects/${projectId}/plans/%E0%A4%A`
  ]) {
    assertInvalidIdentifier(() => decodeAdminPathSegments(path));
  }
});
