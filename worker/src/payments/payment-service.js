import { assertCents, transitionOrderStatus, transitionPaymentStatus } from "../commerce-policy.js";

function conflict(message, reason) {
  throw Object.assign(new Error(message), { status: 409, reason });
}

function releasesActiveAttempt(payment) {
  if (!payment) return false;
  if (payment.status === "failed") {
    return ["failed", "linked"].includes(payment.submissionState);
  }
  return ["cancelled", "refunded"].includes(payment.status) && payment.submissionState === "linked";
}

export async function createPaymentAttempt({
  atomicClient,
  orderId,
  accountId,
  provider,
  providerEnvironment = "",
  method = "unknown",
  idempotencyKey,
  hash,
  randomId,
  now
}) {
  const keyHash = await hash(`${accountId}|${idempotencyKey}`);
  return await atomicClient.runTransaction(async tx => {
    const requestPath = `paymentRequests/${keyHash}`;
    const replay = await tx.get(requestPath);
    if (replay) {
      if (replay.orderId !== orderId || replay.accountId !== accountId) conflict("Chave de idempotência usada por outro pagamento.", "idempotency_conflict");
      const payment = await tx.get(`payments/${replay.paymentId}`);
      if (!payment) conflict("Registro idempotente de pagamento inconsistente.", "idempotency_orphan");
      return { payment, idempotentReplay: true };
    }
    const order = await tx.get(`orders/${orderId}`);
    if (!order || order.accountId !== accountId) conflict("Pedido não encontrado.", "order_not_found");
    if (!["pending_payment", "payment_failed"].includes(order.status)) conflict("Pedido não aceita nova tentativa de pagamento.", "payment_not_allowed");
    if (order.activePaymentId) {
      const activePayment = await tx.get(`payments/${order.activePaymentId}`);
      if (!activePayment) conflict("Vínculo da tentativa ativa está inconsistente.", "active_payment_orphan");
      if (!releasesActiveAttempt(activePayment)) {
        conflict("O pedido já possui uma tentativa de pagamento ativa.", "active_payment_exists");
      }
    }
    const paymentId = randomId("pay");
    const timestamp = now();
    const payment = {
      paymentId, orderId, accountId, provider,
      providerEnvironment: String(providerEnvironment || ""),
      providerOrderId: "", providerChargeId: "", providerPaymentId: "",
      providerStatus: "", submissionState: "ready", status: "pending",
      amountCents: assertCents(order.totalCents), currency: order.currency,
      method: String(method || "unknown"), createdAt: timestamp, updatedAt: timestamp,
      paidAt: null, failedAt: null, cancelledAt: null
    };
    tx.create(`payments/${paymentId}`, payment);
    tx.create(requestPath, { paymentId, orderId, accountId, createdAt: timestamp });
    tx.set(`orders/${orderId}`, { ...order, activePaymentId: paymentId, updatedAt: timestamp });
    return { payment, idempotentReplay: false };
  });
}

function assertPaymentIdentity(payment, { paymentId, orderId, accountId, provider, providerEnvironment }) {
  if (
    !payment ||
    payment.paymentId !== paymentId ||
    payment.orderId !== orderId ||
    payment.accountId !== accountId
  ) {
    conflict("Pagamento local inconsistente.", "payment_conflict");
  }
  if (payment.provider !== provider || payment.providerEnvironment !== providerEnvironment) {
    conflict("Pagamento local pertence a outro provedor ou ambiente.", "payment_environment_mismatch");
  }
}

export async function claimPaymentSubmission({
  atomicClient,
  paymentId,
  orderId,
  accountId,
  provider,
  providerEnvironment,
  now
}) {
  return await atomicClient.runTransaction(async tx => {
    const payment = await tx.get(`payments/${paymentId}`);
    assertPaymentIdentity(payment, { paymentId, orderId, accountId, provider, providerEnvironment });

    if (payment.providerOrderId) {
      return { payment, claimed: false, idempotentReplay: true };
    }
    if (["submitting", "unknown"].includes(payment.submissionState)) {
      conflict("A situação da cobrança enviada ao PagBank ainda é incerta.", "payment_state_unknown");
    }
    if (payment.submissionState === "failed") {
      conflict("Esta tentativa de pagamento já falhou. Use uma nova chave de idempotência.", "payment_attempt_failed");
    }

    const order = await tx.get(`orders/${orderId}`);
    if (!order || order.accountId !== accountId) conflict("Pedido não encontrado.", "order_not_found");
    if (order.activePaymentId && order.activePaymentId !== paymentId) {
      conflict("Outra tentativa de pagamento está ativa para este pedido.", "active_payment_exists");
    }
    if (!["pending_payment", "payment_failed"].includes(order.status)) {
      conflict("Pedido não aceita início de pagamento.", "payment_not_allowed");
    }
    if (order.totalCents !== payment.amountCents || order.currency !== payment.currency) {
      conflict("Valor ou moeda do pedido mudou após a tentativa de pagamento.", "payment_amount_mismatch");
    }

    const timestamp = now();
    const nextPayment = {
      ...payment,
      status: transitionPaymentStatus(payment.status, "processing"),
      providerStatus: "SUBMITTING",
      submissionState: "submitting",
      submittedAt: timestamp,
      updatedAt: timestamp
    };
    const nextOrder = {
      ...order,
      status: transitionOrderStatus(order.status, "payment_processing"),
      paymentStatus: "processing",
      processingStatus: "processing",
      paymentId,
      provider,
      providerEnvironment,
      activePaymentId: paymentId,
      updatedAt: timestamp
    };
    tx.set(`payments/${paymentId}`, nextPayment);
    tx.set(`orders/${orderId}`, nextOrder);
    return { payment: nextPayment, claimed: true, idempotentReplay: false };
  });
}

export async function recordPaymentSubmissionFailure({
  atomicClient,
  paymentId,
  orderId,
  accountId,
  provider,
  providerEnvironment,
  uncertain = false,
  providerHttpStatus = null,
  providerErrorCode = "",
  providerErrorCategory = "",
  now
}) {
  return await atomicClient.runTransaction(async tx => {
    const payment = await tx.get(`payments/${paymentId}`);
    assertPaymentIdentity(payment, { paymentId, orderId, accountId, provider, providerEnvironment });
    if (payment.providerOrderId) return payment;

    const timestamp = now();
    const nextPayment = {
      ...payment,
      status: uncertain ? "processing" : transitionPaymentStatus(payment.status, "failed"),
      providerStatus: uncertain ? "UNKNOWN" : "REQUEST_FAILED",
      submissionState: uncertain ? "unknown" : "failed",
      lastProviderError: {
        category: String(providerErrorCategory || (uncertain ? "uncertain" : "definitive")).slice(0, 32),
        httpStatus: Number.isInteger(providerHttpStatus) ? providerHttpStatus : null,
        code: String(providerErrorCode || "").slice(0, 80)
      },
      updatedAt: timestamp,
      ...(uncertain ? {} : { failedAt: timestamp })
    };
    tx.set(`payments/${paymentId}`, nextPayment);

    const order = await tx.get(`orders/${orderId}`);
    if (order && order.accountId === accountId && order.paymentId === paymentId) {
      tx.set(`orders/${orderId}`, {
        ...order,
        ...(uncertain ? {} : {
          status: transitionOrderStatus(order.status, "payment_failed"),
          paymentStatus: "failed",
          processingStatus: "pending",
          activePaymentId: ""
        }),
        updatedAt: timestamp
      });
    }
    return nextPayment;
  });
}

function compatibleProviderId(current, next, reason) {
  if (current && next && current !== next) {
    conflict("Identificador PagBank conflitante.", reason);
  }
}

export async function linkPaymentProviderResult({
  atomicClient,
  paymentId,
  orderId,
  accountId,
  provider,
  providerEnvironment,
  result,
  now
}) {
  return await atomicClient.runTransaction(async tx => {
    const payment = await tx.get(`payments/${paymentId}`);
    assertPaymentIdentity(payment, { paymentId, orderId, accountId, provider, providerEnvironment });
    const order = await tx.get(`orders/${orderId}`);
    if (!order || order.accountId !== accountId) conflict("Pedido não encontrado.", "order_not_found");
    if (order.paymentId && order.paymentId !== paymentId) {
      conflict("Pedido está vinculado a outro pagamento.", "payment_conflict");
    }
    if (
      result.orderId !== orderId ||
      result.paymentId !== paymentId ||
      result.amountCents !== payment.amountCents ||
      result.amountCents !== order.totalCents ||
      result.currency !== payment.currency ||
      result.currency !== order.currency
    ) {
      conflict("Resposta PagBank diverge do pedido local.", "payment_amount_mismatch");
    }
    compatibleProviderId(payment.providerOrderId, result.providerOrderId, "payment_provider_order_mismatch");
    compatibleProviderId(payment.providerChargeId, result.providerChargeId, "payment_provider_charge_mismatch");
    compatibleProviderId(payment.providerPaymentId, result.providerPaymentId, "payment_provider_payment_mismatch");
    compatibleProviderId(order.providerOrderId, result.providerOrderId, "payment_provider_order_mismatch");
    compatibleProviderId(order.providerChargeId, result.providerChargeId, "payment_provider_charge_mismatch");

    let status = payment.status;
    if (result.status) {
      if (payment.status === "refunded" && result.status !== "refunded") {
        status = "refunded";
      } else if (payment.status === "paid" && !["paid", "refunded"].includes(result.status)) {
        status = "paid";
      } else if (payment.status === "failed" && result.status === "processing" && payment.providerOrderId) {
        // A consulta de uma cobrança já recusada pode retornar um estado intermediário
        // defasado. Não reabra a tentativa nem o pedido por esse resultado regressivo.
        status = "failed";
      } else {
        status = transitionPaymentStatus(payment.status, result.status);
      }
    }

    const timestamp = now();
    const nextPayment = {
      ...payment,
      providerOrderId: result.providerOrderId,
      providerChargeId: result.providerChargeId,
      // Legado: no PagBank este campo é apenas um alias de providerChargeId.
      // Nenhuma lógica nova deve usá-lo como identificador do Order.
      providerPaymentId: result.providerPaymentId || result.providerChargeId,
      providerStatus: String(result.providerStatus || "").slice(0, 64),
      submissionState: "linked",
      status,
      method: "pix",
      pixCode: result.pixCode || "",
      pixQrCodeId: result.pixQrCodeId || "",
      pixExpiration: result.pixExpiration || null,
      pixQrCodeUrl: result.pixQrCodeUrl || "",
      providerPaidAt: result.providerPaidAt || payment.providerPaidAt || null,
      updatedAt: timestamp,
      ...(status === "paid" && !payment.paidAt && result.providerPaidAt
        ? { paidAt: result.providerPaidAt }
        : {}),
      ...(status === "failed" && !payment.failedAt ? { failedAt: timestamp } : {}),
      ...(status === "cancelled" && !payment.cancelledAt ? { cancelledAt: timestamp } : {}),
      ...(status === "refunded" && !payment.refundedAt ? { refundedAt: timestamp } : {})
    };
    const nextOrder = {
      ...order,
      paymentId,
      provider,
      providerEnvironment,
      providerOrderId: result.providerOrderId,
      providerChargeId: result.providerChargeId,
      updatedAt: timestamp
    };
    if (status === "failed" && order.status === "payment_processing") {
      nextOrder.status = transitionOrderStatus(order.status, "payment_failed");
      nextOrder.paymentStatus = "failed";
      nextOrder.processingStatus = "pending";
      nextOrder.activePaymentId = "";
    }
    if (status === "cancelled" && order.status === "payment_processing") {
      nextOrder.status = transitionOrderStatus(order.status, "cancelled");
      nextOrder.paymentStatus = "cancelled";
      nextOrder.processingStatus = "cancelled";
      nextOrder.activePaymentId = "";
      nextOrder.cancelledAt = order.cancelledAt || timestamp;
    }
    if (status === "refunded" && ["payment_processing", "paid", "fulfilled"].includes(order.status)) {
      nextOrder.status = transitionOrderStatus(order.status, "refunded");
      nextOrder.paymentStatus = "refunded";
      nextOrder.processingStatus = "completed";
      nextOrder.activePaymentId = "";
      nextOrder.refundedAt = order.refundedAt || timestamp;
    }
    tx.set(`payments/${paymentId}`, nextPayment);
    tx.set(`orders/${orderId}`, nextOrder);
    return { payment: nextPayment, order: nextOrder };
  });
}

export async function recordPaymentEvent({ atomicClient, normalizedEvent, hash, now }) {
  const provider = String(normalizedEvent.provider || "");
  const providerEventId = String(normalizedEvent.providerEventId || "");
  if (!provider || !providerEventId) conflict("Evento de pagamento sem identidade.", "invalid_payment_event");
  const eventId = `pevt_${(await hash(`${provider}|${providerEventId}`)).slice(0, 20)}`;
  return await atomicClient.runTransaction(async tx => {
    const existing = await tx.get(`paymentEvents/${eventId}`);
    if (existing) {
      const payment = existing.paymentId ? await tx.get(`payments/${existing.paymentId}`) : null;
      return { event: existing, payment, idempotentReplay: true };
    }
    const payment = await tx.get(`payments/${normalizedEvent.paymentId}`);
    if (!payment || payment.orderId !== normalizedEvent.orderId) conflict("Pagamento do evento não encontrado.", "payment_not_found");
    transitionPaymentStatus(payment.status, normalizedEvent.status);
    const timestamp = now();
    const nextPayment = {
      ...payment,
      status: normalizedEvent.status,
      updatedAt: timestamp,
      providerEnvironment: String(normalizedEvent.environment || payment.providerEnvironment || ""),
      providerOrderId: String(normalizedEvent.providerOrderId || payment.providerOrderId || ""),
      providerChargeId: String(normalizedEvent.providerChargeId || payment.providerChargeId || ""),
      // Campo legado/depreciado: no PagBank equivale ao Charge ID.
      providerPaymentId: String(normalizedEvent.providerChargeId || payment.providerPaymentId || ""),
      method: String(normalizedEvent.method || payment.method || "unknown")
    };
    if (normalizedEvent.status === "paid" && normalizedEvent.providerPaidAt) {
      nextPayment.providerPaidAt = normalizedEvent.providerPaidAt;
      nextPayment.paidAt = normalizedEvent.providerPaidAt;
    }
    if (normalizedEvent.status === "failed") nextPayment.failedAt = normalizedEvent.occurredAt || timestamp;
    if (normalizedEvent.status === "cancelled") nextPayment.cancelledAt = normalizedEvent.occurredAt || timestamp;
    tx.set(`payments/${payment.paymentId || normalizedEvent.paymentId}`, nextPayment);

    const order = await tx.get(`orders/${normalizedEvent.orderId}`);
    let nextOrder = order;
    if (order) {
      if (order.paymentId && order.paymentId !== normalizedEvent.paymentId) {
        conflict("Pedido está vinculado a outro pagamento.", "payment_conflict");
      }
      nextOrder = { ...order, updatedAt: timestamp };
      if (normalizedEvent.status === "failed" && order.status === "payment_processing") {
        nextOrder.status = transitionOrderStatus(order.status, "payment_failed");
        nextOrder.paymentStatus = "failed";
        nextOrder.processingStatus = "pending";
        nextOrder.activePaymentId = "";
      }
      if (normalizedEvent.status === "cancelled" && order.status === "payment_processing") {
        nextOrder.status = transitionOrderStatus(order.status, "cancelled");
        nextOrder.paymentStatus = "cancelled";
        nextOrder.processingStatus = "cancelled";
        nextOrder.activePaymentId = "";
        nextOrder.cancelledAt = order.cancelledAt || normalizedEvent.occurredAt || timestamp;
      }
      if (normalizedEvent.status === "refunded" && ["payment_processing", "paid", "fulfilled"].includes(order.status)) {
        nextOrder.status = transitionOrderStatus(order.status, "refunded");
        nextOrder.paymentStatus = "refunded";
        nextOrder.processingStatus = "completed";
        nextOrder.activePaymentId = "";
        nextOrder.refundedAt = order.refundedAt || normalizedEvent.occurredAt || timestamp;
      }
      tx.set(`orders/${normalizedEvent.orderId}`, nextOrder);
    }
    const event = {
      eventId,
      provider,
      providerEventId,
      orderId: normalizedEvent.orderId,
      paymentId: normalizedEvent.paymentId,
      providerEnvironment: String(normalizedEvent.environment || ""),
      providerOrderId: String(normalizedEvent.providerOrderId || ""),
      providerChargeId: String(normalizedEvent.providerChargeId || ""),
      providerStatus: String(normalizedEvent.providerStatus || ""),
      eventType: String(normalizedEvent.eventType || normalizedEvent.status),
      receivedAt: timestamp,
      processedAt: timestamp,
      processingStatus: "processed"
    };
    tx.create(`paymentEvents/${eventId}`, event);
    return { event, payment: nextPayment, order: nextOrder, idempotentReplay: false };
  });
}
