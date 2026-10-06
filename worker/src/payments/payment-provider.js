import { createPublicKey, verify as verifySignature } from "node:crypto";

import { fetchWithTimeout } from "../network.js";

const PAGBANK_BASE_URLS = Object.freeze({
  sandbox: "https://sandbox.api.pagseguro.com",
  production: "https://api.pagseguro.com"
});

const PAGBANK_STATUS_MAP = Object.freeze({
  WAITING: "processing",
  AUTHORIZED: "processing",
  IN_ANALYSIS: "processing",
  PAID: "paid",
  DECLINED: "failed",
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
  REFUNDED: "refunded"
});

function providerError(message, reason, details = null) {
  return Object.assign(new Error(message), {
    status: 502,
    reason,
    ...(details ? { details } : {})
  });
}

function normalizeEnvironment(value) {
  const environment = String(value || "").trim().toLowerCase();
  if (!Object.hasOwn(PAGBANK_BASE_URLS, environment)) {
    throw Object.assign(new Error("Ambiente PagBank inválido."), {
      status: 500,
      reason: "invalid_payment_environment"
    });
  }
  return environment;
}

function normalizeSignatures(value) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .flatMap(item => String(item || "").split(","))
    .map(item => item.trim())
    .filter(Boolean);
}

function rawBodyBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw Object.assign(new Error("Corpo bruto do webhook ausente."), {
    status: 400,
    reason: "invalid_webhook_body"
  });
}

function publicKeyFromBase64(value) {
  const encoded = String(value || "").replace(/\s+/g, "");
  if (!encoded) {
    throw providerError("Chave pública do webhook PagBank ausente.", "invalid_pagbank_public_key");
  }

  try {
    return createPublicKey({
      key: Buffer.from(encoded, "base64"),
      format: "der",
      type: "spki"
    });
  } catch (error) {
    throw Object.assign(
      providerError("Chave pública do webhook PagBank inválida.", "invalid_pagbank_public_key"),
      { cause: error }
    );
  }
}

function parseProviderBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function statusFromCharge(charge) {
  const providerStatus = String(charge?.status || "").toUpperCase();
  return {
    providerStatus,
    status: PAGBANK_STATUS_MAP[providerStatus] || "processing"
  };
}

export class PaymentProvider {
  async createPayment() { throw new Error("not_implemented"); }
  async getPayment() { throw new Error("not_implemented"); }
  async cancelPayment() { throw new Error("not_implemented"); }
  async verifyWebhook() { throw new Error("not_implemented"); }
  async normalizeEvent() { throw new Error("not_implemented"); }
}

export class PagBankProvider extends PaymentProvider {
  #environment;
  #token;
  #fetch;
  #timeoutMs;
  #publicKey = null;
  #publicKeyExpiresAt = 0;
  #publicKeyCacheTtlMs;

  constructor({
    environment,
    token,
    fetchImpl = fetch,
    timeoutMs = 10_000,
    publicKeyCacheTtlMs = 6 * 60 * 60 * 1000
  } = {}) {
    super();
    this.#environment = normalizeEnvironment(environment);
    this.#token = String(token || "").trim();
    if (!this.#token) {
      throw Object.assign(new Error("Token PagBank não configurado."), {
        status: 503,
        reason: "payment_provider_not_configured"
      });
    }
    this.#fetch = fetchImpl;
    this.#timeoutMs = Number(timeoutMs);
    this.#publicKeyCacheTtlMs = Math.max(60_000, Number(publicKeyCacheTtlMs) || 0);
  }

  get environment() {
    return this.#environment;
  }

  get baseUrl() {
    return PAGBANK_BASE_URLS[this.#environment];
  }

  async #request(path, { method = "GET", body = undefined } = {}) {
    const init = {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.#token}`
      }
    };

    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}${path}`,
      init,
      this.#timeoutMs,
      this.#fetch
    );

    const text = await response.text();
    const data = parseProviderBody(text);

    if (!response.ok) {
      const first = Array.isArray(data?.error_messages) ? data.error_messages[0] : null;
      throw providerError(
        "PagBank recusou a operação.",
        "pagbank_request_failed",
        {
          providerStatus: response.status,
          providerCode: String(first?.code || first?.error || "")
        }
      );
    }

    return data;
  }

  async createPayment(payload) {
    return await this.#request("/orders", {
      method: "POST",
      body: payload
    });
  }

  async getPayment(providerOrderId) {
    const id = String(providerOrderId || "").trim();
    if (!/^ORDE_[A-Za-z0-9-]+$/.test(id)) {
      throw Object.assign(new Error("Identificador de pedido PagBank inválido."), {
        status: 400,
        reason: "invalid_provider_order_id"
      });
    }
    return await this.#request(`/orders/${encodeURIComponent(id)}`);
  }

  async cancelPayment({ chargeId, amountCents = null } = {}) {
    const id = String(chargeId || "").trim();
    if (!/^CHAR_[A-Za-z0-9-]+$/.test(id)) {
      throw Object.assign(new Error("Identificador de cobrança PagBank inválido."), {
        status: 400,
        reason: "invalid_provider_charge_id"
      });
    }

    const body = Number.isSafeInteger(amountCents) && amountCents > 0
      ? { amount: { value: amountCents } }
      : {};

    return await this.#request(`/charges/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body
    });
  }

  async getWebhookPublicKey({ forceRefresh = false } = {}) {
    if (
      !forceRefresh &&
      this.#publicKey &&
      this.#publicKeyExpiresAt > Date.now()
    ) {
      return this.#publicKey;
    }

    const data = await this.#request("/public-keys/webhook");
    const publicKey = String(data?.public_key || "").trim();
    publicKeyFromBase64(publicKey);

    this.#publicKey = publicKey;
    this.#publicKeyExpiresAt = Date.now() + this.#publicKeyCacheTtlMs;
    return publicKey;
  }

  async verifyWebhook({ rawBody, signatureHeader } = {}) {
    const signatures = normalizeSignatures(signatureHeader);
    if (!signatures.length) return false;

    const payload = rawBodyBuffer(rawBody);
    let publicKeyBase64 = await this.getWebhookPublicKey();
    let publicKey = publicKeyFromBase64(publicKeyBase64);

    const verifyAll = key => signatures.some(signatureBase64 => {
      try {
        return verifySignature(
          "sha256",
          payload,
          key,
          Buffer.from(signatureBase64, "base64")
        );
      } catch {
        return false;
      }
    });

    if (verifyAll(publicKey)) return true;

    // Uma rotação pode invalidar o cache. Reconsulta uma vez antes de rejeitar.
    publicKeyBase64 = await this.getWebhookPublicKey({ forceRefresh: true });
    publicKey = publicKeyFromBase64(publicKeyBase64);
    return verifyAll(publicKey);
  }

  normalizeEvents(payload) {
    const providerOrderId = String(payload?.id || "").trim();
    if (!/^ORDE_[A-Za-z0-9-]+$/.test(providerOrderId)) {
      throw Object.assign(new Error("Webhook PagBank sem pedido válido."), {
        status: 400,
        reason: "invalid_pagbank_webhook"
      });
    }

    const charges = Array.isArray(payload?.charges) ? payload.charges : [];
    return charges.map(charge => {
      const { providerStatus, status } = statusFromCharge(charge);
      const providerChargeId = String(charge?.id || "").trim();
      const paymentId = String(charge?.reference_id || "").trim();
      const occurredAt = String(
        charge?.paid_at ||
        charge?.created_at ||
        payload?.created_at ||
        ""
      );
      const amountCents = Number(charge?.amount?.value);
      const currency = String(charge?.amount?.currency || "BRL").toUpperCase();
      const method = String(charge?.payment_method?.type || "unknown").toLowerCase();

      return {
        provider: "pagbank",
        environment: this.#environment,
        providerEventId: [
          providerOrderId,
          providerChargeId,
          providerStatus,
          occurredAt
        ].join("|"),
        providerOrderId,
        providerChargeId,
        paymentId,
        status,
        providerStatus,
        eventType: `charge.${providerStatus.toLowerCase() || "unknown"}`,
        occurredAt: occurredAt || null,
        amountCents,
        currency,
        method
      };
    });
  }

  async normalizeEvent(payload) {
    return this.normalizeEvents(payload)[0] || null;
  }
}

export const PAGBANK_ENVIRONMENTS = Object.freeze({
  sandbox: PAGBANK_BASE_URLS.sandbox,
  production: PAGBANK_BASE_URLS.production
});
