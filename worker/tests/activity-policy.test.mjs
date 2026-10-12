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
    lastValidationRequestId: "req-new",
    recentValidationRequests: [{ id: "req-new", at: "2026-10-04T21:00:00.000Z" }]
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

test("INT-06: replays de A após B continuam deduplicados em Firestore", () => {
  const now = "2026-10-12T18:00:00.000Z";
  let record = { validationCount: 0 };
  const first = validationMutation(record, "req-A", now);
  assert.equal(first.replay, false);
  record = { ...record, ...first.patch };
  const second = validationMutation(record, "req-B", now);
  assert.equal(second.replay, false);
  record = { ...record, ...second.patch };
  const replayA = validationMutation(record, "req-A", now);
  const replayB = validationMutation(record, "req-B", now);
  assert.equal(replayA.replay, true);
  assert.equal(replayB.replay, true);
  assert.equal(replayA.validationCount, 2);
  assert.equal(replayB.validationCount, 2);
  assert.deepEqual(replayA.patch, {});
  assert.deepEqual(replayB.patch, {});
});

test("INT-06: migrar registro legado não perde deduplicação do último requestId", () => {
  const record = {
    validationCount: 7,
    lastValidationRequestId: "req-old",
    lastValidatedAt: "2026-10-11T12:00:00.000Z"
  };
  const newer = validationMutation(record, "req-new", "2026-10-12T12:00:00.000Z");
  assert.deepEqual(newer.patch.recentValidationRequests, [
    { id: "req-old", at: "2026-10-11T12:00:00.000Z" },
    { id: "req-new", at: "2026-10-12T12:00:00.000Z" }
  ]);
  const replayOld = validationMutation({ ...record, ...newer.patch },
    "req-old", "2026-10-12T12:01:00.000Z");
  assert.equal(replayOld.replay, true);
  assert.equal(replayOld.validationCount, 8);
});

test("INT-06: histórico é limitado a 64 IDs com retenção de sete dias", () => {
  let record = { validationCount: 0 };
  const now = "2026-10-12T18:00:00.000Z";
  for (let i = 0; i < 80; i++) {
    const value = validationMutation(record, `req-${i}`, now);
    record = { ...record, ...value.patch };
  }
  assert.equal(record.validationCount, 80);
  assert.equal(record.recentValidationRequests.length, 64);
  assert.equal(record.recentValidationRequests[0].id, "req-16");
  assert.equal(validationMutation(record, "req-79", now).replay, true);
  assert.equal(validationMutation(record, "req-0", now).replay, false);

  const stale = validationMutation(record, "req-79", "2026-10-20T18:00:00.000Z");
  assert.equal(stale.replay, false);
  assert.equal(stale.validationCount, 81);
  assert.equal(stale.patch.recentValidationRequests.length, 1);
});

test("INT-06: sem requestId mantém compatibilidade e não grava lista desnecessária", () => {
  const r = validationMutation({ validationCount: 3 }, "", "2026-10-12T18:00:00.000Z");
  assert.equal(r.replay, false);
  assert.deepEqual(r.patch, {
    validationCount: 4,
    lastValidatedAt: "2026-10-12T18:00:00.000Z"
  });
});
