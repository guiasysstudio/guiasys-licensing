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

export function validationMutation(record = {}, requestId = "", now = new Date().toISOString()) {
  const normalizedRequestId = String(requestId || "");
  const replay = Boolean(
    normalizedRequestId &&
    record.lastValidationRequestId === normalizedRequestId
  );

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
      ...(normalizedRequestId ? { lastValidationRequestId: normalizedRequestId } : {})
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
