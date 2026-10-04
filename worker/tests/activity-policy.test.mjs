import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyActivationEvent,
  summarizeActivity,
  validationMutation
} from "../src/activity-policy.js";

test("separa ativação real, revalidação e desativação", () => {
  assert.equal(classifyActivationEvent("activate"), "activation");
  assert.equal(classifyActivationEvent("reactivate_device"), "activation");
  assert.equal(classifyActivationEvent("rebind_license"), "activation");
  assert.equal(classifyActivationEvent("revalidate"), "revalidation");
  assert.equal(classifyActivationEvent("deactivate"), "deactivation");
  assert.equal(classifyActivationEvent("qualquer"), "other");
});

test("mesmo requestId de validação é replay sem incrementar contador", () => {
  const result = validationMutation({
    validationCount: 7,
    lastValidationRequestId: "req-123",
    lastValidatedAt: "2026-10-04T20:00:00.000Z"
  }, "req-123", "2026-10-04T21:00:00.000Z");

  assert.equal(result.replay, true);
  assert.equal(result.validationCount, 7);
  assert.deepEqual(result.patch, {});
});

test("nova validação incrementa contador e registra requestId", () => {
  const result = validationMutation({
    validationCount: 7,
    lastValidationRequestId: "req-old"
  }, "req-new", "2026-10-04T21:00:00.000Z");

  assert.equal(result.replay, false);
  assert.equal(result.validationCount, 8);
  assert.deepEqual(result.patch, {
    validationCount: 8,
    lastValidatedAt: "2026-10-04T21:00:00.000Z",
    lastValidationRequestId: "req-new"
  });
});

test("métrica de ativações não conta validate nem deactivate", () => {
  const events = [
    { type: "activate", createdAt: "2026-10-04T10:00:00Z" },
    { type: "reactivate_device", createdAt: "2026-10-04T11:00:00Z" },
    { type: "rebind_license", createdAt: "2026-10-04T12:00:00Z" },
    { type: "revalidate", createdAt: "2026-10-04T13:00:00Z" },
    { type: "revalidate", createdAt: "2026-10-04T14:00:00Z" },
    { type: "deactivate", createdAt: "2026-10-04T15:00:00Z" },
    { type: "activate", createdAt: "2026-10-03T10:00:00Z" }
  ];
  const dateKey = value => String(value).slice(0, 10);
  assert.deepEqual(summarizeActivity(events, dateKey, "2026-10-04"), {
    activations: 3,
    revalidations: 2,
    deactivations: 1
  });
});
