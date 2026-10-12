export const ACTIVATION_EVENT_TYPES = Object.freeze([
  "activate",
  "reactivate_device",
  "rebind_license"
]);

export const REVALIDATION_EVENT_TYPE = "revalidate";
export const DEACTIVATION_EVENT_TYPE = "deactivate";

export function classifyActivationEvent(type) {
  if (ACTIVATION_EVENT_TYPES.includes(type)) return "activation";
  if (type === REVALIDATION_EVENT_TYPE) return "revalidation";
  if (type === DEACTIVATION_EVENT_TYPE) return "deactivation";
  return "other";
}

// Bounded transactional replay history; the record remains small in Firestore.
// Guarantees deduplication for recent operations, not indefinite global idempotency.
export const VALIDATION_REPLAY_MAX_IDS = 64;
export const VALIDATION_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function recentValidationIds(record, now) {
  const currentTime = Date.parse(now);
  if (!Number.isFinite(currentTime)) return [];
  const raw = Array.isArray(record.recentValidationRequests)
    ? record.recentValidationRequests : [];
  return raw.filter(item => (
    item && typeof item.id === "string" && item.id.length <= 128 &&
    typeof item.at === "string" &&
    Number.isFinite(Date.parse(item.at)) &&
    Date.parse(item.at) <= currentTime &&
    currentTime - Date.parse(item.at) <= VALIDATION_REPLAY_WINDOW_MS
  )).slice(-VALIDATION_REPLAY_MAX_IDS);
}

export function validationMutation(record = {}, requestId = "", now = new Date().toISOString()) {
  const normalizedRequestId = String(requestId || "");
  const stored = recentValidationIds(record, now);
  const legacy = typeof record.lastValidationRequestId === "string" &&
    typeof record.lastValidatedAt === "string" &&
    !Array.isArray(record.recentValidationRequests)
      ? recentValidationIds({ recentValidationRequests: [
        { id: record.lastValidationRequestId, at: record.lastValidatedAt }
      ] }, now) : [];
  const recentRequests = [...legacy, ...stored].slice(-VALIDATION_REPLAY_MAX_IDS);
  // Compatibility with records written before the INT-06 replay window existed.
  const legacyReplay = !Array.isArray(record.recentValidationRequests) &&
    normalizedRequestId &&
    record.lastValidationRequestId === normalizedRequestId;
  const replay = Boolean(normalizedRequestId && (
    legacyReplay ||
    recentRequests.some(item => item.id === normalizedRequestId)
  ));

  if (replay) {
    return {
      replay: true,
      validationCount: Math.max(0, Number(record.validationCount || 0)),
      patch: {}
    };
  }

  const validationCount = Math.max(0, Number(record.validationCount || 0)) + 1;
  return {
    replay: false,
    validationCount,
    patch: {
      validationCount,
      lastValidatedAt: now,
      ...(normalizedRequestId ? {
        lastValidationRequestId: normalizedRequestId,
        recentValidationRequests: [
          ...recentRequests.filter(item => item.id !== normalizedRequestId),
          { id: normalizedRequestId, at: now }
        ].slice(-VALIDATION_REPLAY_MAX_IDS)
      } : {})
    }
  };
}

export function summarizeActivity(events = [], dateKey, today) {
  const summary = {
    activations: 0,
    revalidations: 0,
    deactivations: 0
  };

  for (const event of events) {
    if (!event?.createdAt || dateKey(event.createdAt) !== today) continue;
    const category = classifyActivationEvent(event.type);
    if (category === "activation") summary.activations++;
    if (category === "revalidation") summary.revalidations++;
    if (category === "deactivation") summary.deactivations++;
  }

  return summary;
}
