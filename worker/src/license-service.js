export async function issueLicenseInTransaction({
  tx,
  project,
  projectId,
  customer,
  customerId,
  plan,
  now,
  source,
  externalOrderId = "",
  accountId = "",
  customerUid = "",
  orderItemId = "",
  paymentId = "",
  notes = "",
  id,
  key,
  hashLicenseKey,
  plusDays,
  queueLog,
  actor = "system"
}) {
  const lifetime = Boolean(plan.lifetime);
  const durationDays = lifetime ? 0 : Math.max(1, Number(plan.durationDays || 30));
  const maxDevices = Math.max(1, Number(plan.deviceLimit || 1));
  const startMode = ["first_activation", "immediate"].includes(plan.startMode)
    ? plan.startMode
    : "first_activation";
  const activatedAt = startMode === "immediate" ? now : null;
  const expiresAt = startMode === "immediate" && !lifetime ? plusDays(now, durationDays) : null;
  const license = {
    key,
    customerId,
    customerName: customer.name,
    customerEmail: customer.email,
    planId: plan.id || "",
    planName: plan.name || "Personalizada",
    durationDays,
    renewalDaysTotal: 0,
    renewalCount: 0,
    lifetime,
    maxDevices,
    startMode,
    status: startMode === "immediate" ? "active" : "pending",
    activatedAt,
    expiresAt,
    source,
    externalOrderId,
    orderId: externalOrderId,
    orderItemId,
    customerUid,
    paymentId,
    accountId,
    notes: String(notes || "").trim(),
    createdAt: now,
    updatedAt: now
  };

  const lookupId = await hashLicenseKey(key);
  tx.create(`projects/${projectId}/licenses/${id}`, license);
  tx.create(`projects/${projectId}/licenseKeys/${lookupId}`, { licenseId: id, createdAt: now });
  queueLog(tx, projectId, source === "order" ? "license.issued_from_order" : "license.created", {
    licenseId: id,
    customerId,
    planId: plan.id || null,
    orderId: externalOrderId || null,
    paymentId: paymentId || null,
    accountId: accountId || null,
    customerUid: customerUid || null,
    orderItemId: orderItemId || null,
    lifetime,
    durationDays,
    maxDevices,
    source
  }, actor, now);
  return { id, ...license };
}
