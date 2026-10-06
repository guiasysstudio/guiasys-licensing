import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

import { handleRequest } from "./index.js";
import { createFirebaseRuntime } from "./firebase-runtime.js";

const ADMIN_FIREBASE_UID = defineSecret("ADMIN_FIREBASE_UID");
const PAGBANK_SANDBOX_CHECKOUT_ENABLED = defineString("PAGBANK_SANDBOX_CHECKOUT_ENABLED", {
  default: "false"
});
const PAGBANK_SANDBOX_TESTER_UIDS = defineString("PAGBANK_SANDBOX_TESTER_UIDS", {
  default: ""
});
const PAYMENT_PROVIDER = defineString("PAYMENT_PROVIDER", {
  default: "manual_pix"
});
const PAGBANK_ENABLED = defineString("PAGBANK_ENABLED", {
  default: "false"
});

let cachedRuntime = null;

function runtime() {
  if (!cachedRuntime) {
    cachedRuntime = createFirebaseRuntime({
      log(level, event, details) {
        const writer = logger[level] || logger.info;
        writer(event, details);
      }
    });
  }
  return cachedRuntime;
}

function appendHeader(headers, name, value) {
  if (Array.isArray(value)) {
    for (const item of value) headers.append(name, String(item));
    return;
  }
  if (value !== undefined && value !== null) headers.set(name, String(value));
}

function expressToWebRequest(req) {
  const protocol = req.protocol || "https";
  const host = req.get?.("host") || req.headers?.host || "localhost";
  const url = new URL(req.originalUrl || req.url || "/", `${protocol}://${host}`);
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers || {})) {
    appendHeader(headers, name, value);
  }

  const init = {
    method: req.method || "GET",
    headers
  };

  if (!["GET", "HEAD"].includes(init.method.toUpperCase())) {
    if (req.rawBody?.length) {
      init.body = req.rawBody;
    } else if (req.body !== undefined && req.body !== null) {
      init.body = typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }

  return new Request(url, init);
}

async function sendWebResponse(res, response) {
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.status(response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  res.send(bytes);
}

function adapterRequestId(req) {
  const candidate = String(req.get?.("x-request-id") || req.headers?.["x-request-id"] || "").trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(candidate)
    ? candidate
    : `req_${crypto.randomUUID().replace(/-/g, "")}`;
}

export const licensingApi = onRequest(
  {
    region: "southamerica-east1",
    maxInstances: 20,
    timeoutSeconds: 60,
    memory: "512MiB",
    invoker: "public",
    // PagBank permanece congelado. Para reativá-lo no futuro, os dois secrets
    // devem voltar a esta lista após revisão específica do fluxo produtivo.
    secrets: [ADMIN_FIREBASE_UID]
  },
  async (req, res) => {
    const requestId = adapterRequestId(req);
    res.setHeader("X-Request-Id", requestId);

    try {
      const services = runtime();
      const response = await handleRequest(expressToWebRequest(req), {
        FIREBASE_PROJECT_ID: services.projectId,
        ADMIN_FIREBASE_UID: ADMIN_FIREBASE_UID.value(),
        PAYMENT_PROVIDER: PAYMENT_PROVIDER.value(),
        PAGBANK_ENABLED: PAGBANK_ENABLED.value(),
        PAGBANK_SANDBOX_CHECKOUT_ENABLED: PAGBANK_SANDBOX_CHECKOUT_ENABLED.value(),
        PAGBANK_SANDBOX_TESTER_UIDS: PAGBANK_SANDBOX_TESTER_UIDS.value(),
        __services: services
      });
      await sendWebResponse(res, response);
    } catch (error) {
      logger.error("firebase.adapter_failure", {
        requestId,
        method: req.method || "UNKNOWN",
        path: req.path || req.url || "/",
        errorName: error?.name || "Error",
        message: error?.message || "Unknown error"
      });

      res.status(500).json({
        ok: false,
        error: "internal_error",
        message: "Erro interno do servidor."
      });
    }
  }
);
