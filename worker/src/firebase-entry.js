import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

import { handleRequest } from "./index.js";
import { createFirebaseRuntime } from "./firebase-runtime.js";

const ADMIN_FIREBASE_UID = defineSecret("ADMIN_FIREBASE_UID");

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

export const licensingApi = onRequest(
  {
    region: "southamerica-east1",
    maxInstances: 20,
    timeoutSeconds: 60,
    memory: "512MiB",
    invoker: "public",
    secrets: [ADMIN_FIREBASE_UID]
  },
  async (req, res) => {
    try {
      const services = runtime();
      const response = await handleRequest(expressToWebRequest(req), {
        FIREBASE_PROJECT_ID: services.projectId,
        ADMIN_FIREBASE_UID: ADMIN_FIREBASE_UID.value(),
        __services: services
      });
      await sendWebResponse(res, response);
    } catch (error) {
      logger.error("firebase.adapter_failure", {
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
