import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import { handleRequest } from "../src/index.js";

function webhookFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1"
  });
  const publicKeyBase64 = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

  const payload = {
    id: "ORDE_12345678-1234-1234-1234-123456789012",
    created_at: "2026-10-05T22:40:00-03:00",
    charges: [
      {
        id: "CHAR_12345678-1234-1234-1234-123456789012",
        reference_id: "pay_aaaaaaaaaaaaaaaaaaaa",
        status: "WAITING",
        created_at: "2026-10-05T22:40:01-03:00",
        amount: {
          value: 500,
          currency: "BRL"
        },
        payment_method: {
          type: "PIX"
        }
      }
    ]
  };

  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = sign("sha256", rawBody, privateKey).toString("base64");

  return {
    publicKeyBase64,
    payload,
    rawBody,
    signature
  };
}

function sandboxEnv(logs) {
  return {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "master",
    PAYMENT_PROVIDER: "pagbank",
    PAGBANK_ENABLED: "true",
    PAGBANK_TOKEN: "production-token",
    PAGBANK_SANDBOX_TOKEN: "sandbox-token",
    __services: {
      runtime: "test",
      log(level, event, details) {
        logs.push({ level, event, details });
      }
    }
  };
}

test("webhook sandbox assinado é aceito sem acessar Firestore ou fulfillment", async () => {
  const fixture = webhookFixture();
  const originalFetch = globalThis.fetch;
  const logs = [];

  globalThis.fetch = async url => {
    assert.equal(
      String(url),
      "https://sandbox.api.pagseguro.com/public-keys/webhook"
    );
    return new Response(
      JSON.stringify({ public_key: fixture.publicKeyBase64 }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  };

  try {
    const response = await handleRequest(
      new Request(
        "https://licencas.guiasys.online/api/v1/webhooks/pagbank/sandbox",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-payload-signature": fixture.signature,
            "x-product-origin": "ORDER",
            "x-product-id": fixture.payload.id
          },
          body: fixture.rawBody
        }
      ),
      sandboxEnv(logs)
    );

    assert.equal(response.status, 204);
    assert.ok(
      logs.some(entry => entry.event === "pagbank.sandbox_webhook_verified")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webhook sandbox com assinatura inválida é rejeitado", async () => {
  const fixture = webhookFixture();
  const originalFetch = globalThis.fetch;
  const logs = [];

  globalThis.fetch = async () => new Response(
    JSON.stringify({ public_key: fixture.publicKeyBase64 }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );

  try {
    const response = await handleRequest(
      new Request(
        "https://licencas.guiasys.online/api/v1/webhooks/pagbank/sandbox",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-payload-signature": Buffer.from("assinatura-invalida").toString("base64"),
            "x-product-origin": "ORDER",
            "x-product-id": fixture.payload.id
          },
          body: fixture.rawBody
        }
      ),
      sandboxEnv(logs)
    );

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "invalid_webhook_signature");
    assert.equal(
      logs.some(entry => entry.event === "pagbank.sandbox_webhook_verified"),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
