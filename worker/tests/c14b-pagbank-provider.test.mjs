import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  PAGBANK_ENVIRONMENTS,
  PagBankProvider
} from "../src/payments/payment-provider.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("PagBank mantém URLs de sandbox e produção explicitamente separadas", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ id: "ORDE_12345678-1234-1234-1234-123456789012" }, 201);
  };

  const sandbox = new PagBankProvider({
    environment: "sandbox",
    token: "sandbox-token",
    fetchImpl
  });
  await sandbox.createPayment({ reference_id: "sandbox-test" });

  const production = new PagBankProvider({
    environment: "production",
    token: "production-token",
    fetchImpl
  });
  await production.createPayment({ reference_id: "production-test" });

  assert.equal(PAGBANK_ENVIRONMENTS.sandbox, "https://sandbox.api.pagseguro.com");
  assert.equal(PAGBANK_ENVIRONMENTS.production, "https://api.pagseguro.com");
  assert.equal(calls[0].url, "https://sandbox.api.pagseguro.com/orders");
  assert.equal(calls[1].url, "https://api.pagseguro.com/orders");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sandbox-token");
  assert.equal(calls[1].init.headers.Authorization, "Bearer production-token");
});

test("PagBank distingue rejeição definitiva de resultado HTTP incerto sem expor corpo", async t => {
  for (const scenario of [
    { status: 400, reason: "pagbank_request_rejected", category: "definitive" },
    { status: 429, reason: "pagbank_request_uncertain", category: "uncertain" },
    { status: 500, reason: "pagbank_request_uncertain", category: "uncertain" },
    { status: 502, reason: "pagbank_request_uncertain", category: "uncertain" }
  ]) {
    await t.test(String(scenario.status), async () => {
      const provider = new PagBankProvider({
        environment: "sandbox",
        token: "sandbox-token",
        fetchImpl: async () => jsonResponse({
          error_messages: [{ code: "provider-code", description: "sensitive-description" }],
          raw_sensitive_field: "must-not-leak"
        }, scenario.status)
      });
      await assert.rejects(
        () => provider.createPayment({ reference_id: "test" }),
        error => {
          assert.equal(error.reason, scenario.reason);
          assert.equal(error.details.providerStatus, scenario.status);
          assert.equal(error.details.providerCode, "provider-code");
          assert.equal(error.details.category, scenario.category);
          assert.equal(JSON.stringify(error).includes("must-not-leak"), false);
          assert.equal(JSON.stringify(error).includes("sensitive-description"), false);
          return true;
        }
      );
    });
  }
});

test("resposta 2xx sem JSON é tratada como resultado incerto", async () => {
  const provider = new PagBankProvider({
    environment: "sandbox",
    token: "sandbox-token",
    fetchImpl: async () => new Response("not-json", { status: 201 })
  });
  await assert.rejects(
    () => provider.createPayment({ reference_id: "test" }),
    error => error.reason === "pagbank_request_uncertain" && error.details.category === "uncertain"
  );
});

test("HTTP 400 sem código de rejeição permanece incerto", async () => {
  const provider = new PagBankProvider({
    environment: "sandbox",
    token: "sandbox-token",
    fetchImpl: async () => jsonResponse({}, 400)
  });
  await assert.rejects(
    () => provider.createPayment({ reference_id: "test" }),
    error => error.reason === "pagbank_request_uncertain" && error.details.category === "uncertain"
  );
});

test("webhook PagBank valida ECDSA SHA-256 sobre o corpo bruto", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1"
  });
  const publicKeyBase64 = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

  let keyRequests = 0;
  const fetchImpl = async url => {
    assert.equal(
      String(url),
      "https://sandbox.api.pagseguro.com/public-keys/webhook"
    );
    keyRequests += 1;
    return jsonResponse({ public_key: publicKeyBase64 });
  };

  const provider = new PagBankProvider({
    environment: "sandbox",
    token: "sandbox-token",
    fetchImpl
  });

  const rawBody = Buffer.from(
    '{"id":"ORDE_12345678-1234-1234-1234-123456789012","charges":[]}',
    "utf8"
  );
  const signature = sign("sha256", rawBody, privateKey).toString("base64");

  assert.equal(
    await provider.verifyWebhook({
      rawBody,
      signatureHeader: signature
    }),
    true
  );

  assert.equal(
    await provider.verifyWebhook({
      rawBody: Buffer.from(rawBody.toString("utf8") + " ", "utf8"),
      signatureHeader: signature
    }),
    false
  );

  assert.ok(keyRequests >= 2);
});

test("normalização PagBank usa somente metadados financeiros necessários", () => {
  const provider = new PagBankProvider({
    environment: "production",
    token: "production-token",
    fetchImpl: async () => jsonResponse({})
  });

  const [event] = provider.normalizeEvents({
    id: "ORDE_12345678-1234-1234-1234-123456789012",
    created_at: "2026-10-05T22:30:00-03:00",
    charges: [
      {
        id: "CHAR_12345678-1234-1234-1234-123456789012",
        reference_id: "pay_aaaaaaaaaaaaaaaaaaaa",
        status: "PAID",
        paid_at: "2026-10-05T22:31:00-03:00",
        amount: {
          value: 2990,
          currency: "BRL"
        },
        payment_method: {
          type: "PIX",
          pix: {
            notification_id: "NTF_example",
            holder: {
              name: "Dado que não deve ser persistido"
            }
          }
        }
      }
    ]
  });

  assert.equal(event.provider, "pagbank");
  assert.equal(event.environment, "production");
  assert.equal(event.paymentId, "pay_aaaaaaaaaaaaaaaaaaaa");
  assert.equal(event.status, "paid");
  assert.equal(event.providerStatus, "PAID");
  assert.equal(event.amountCents, 2990);
  assert.equal(event.currency, "BRL");
  assert.equal(event.method, "pix");
  assert.equal(event.providerPaidAt, "2026-10-05T22:31:00-03:00");
  assert.equal(event.providerChargeId, "CHAR_12345678-1234-1234-1234-123456789012");
  assert.equal(JSON.stringify(event).includes("holder"), false);
  assert.equal(JSON.stringify(event).includes("notification_id"), false);
});
