const ORDER_TRANSITIONS = Object.freeze({
  pending_payment: new Set(["payment_processing", "cancelled", "payment_failed"]),
  payment_processing: new Set(["paid", "payment_failed", "cancelled", "refunded"]),
  payment_failed: new Set(["payment_processing", "cancelled"]),
  paid: new Set(["fulfilling", "refunded"]),
  fulfilling: new Set(["fulfilled"]),
  fulfilled: new Set(["refunded"]),
  cancelled: new Set(),
  refunded: new Set()
});

const PAYMENT_TRANSITIONS = Object.freeze({
  pending: new Set(["processing", "cancelled", "failed"]),
  processing: new Set(["paid", "failed", "cancelled"]),
  paid: new Set(["refunded"]),
  failed: new Set(["processing", "cancelled"]),
  cancelled: new Set(),
  refunded: new Set()
});

function domainError(message, reason) {
  throw Object.assign(new Error(message), { status: 409, reason });
}

export function transitionOrderStatus(current, next) {
  if (current === next) return next;
  if (!ORDER_TRANSITIONS[current]?.has(next)) domainError("Transição de pedido não permitida.", "invalid_order_transition");
  return next;
}

export function transitionPaymentStatus(current, next) {
  if (current === next) return next;
  if (!PAYMENT_TRANSITIONS[current]?.has(next)) domainError("Transição de pagamento não permitida.", "invalid_payment_transition");
  return next;
}

export function moneyToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw Object.assign(new Error("Preço do plano inválido."), { status: 409, reason: "invalid_plan_price" });
  }
  const cents = Math.round((number + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw Object.assign(new Error("Preço do plano excede o limite suportado."), { status: 409, reason: "invalid_plan_price" });
  }
  return cents;
}

export function assertCents(value, field = "amountCents") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw Object.assign(new Error(`${field} deve ser um inteiro não negativo em centavos.`), {
      status: 400,
      reason: "invalid_money"
    });
  }
  return value;
}

export const ORDER_STATUSES = Object.freeze(Object.keys(ORDER_TRANSITIONS));
export const PAYMENT_STATUSES = Object.freeze(Object.keys(PAYMENT_TRANSITIONS));
