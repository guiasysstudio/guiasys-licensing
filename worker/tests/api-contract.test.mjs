import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/index.js";

function firebaseEnv(logs = []) {
  return {
    FIREBASE_PROJECT_ID: "guiasys-licensing",
    ADMIN_FIREBASE_UID: "uid-master-test",
    __services: {
      runtime: "firebase-functions-v2",
      log(level, event, details) {
        logs.push({ level, event, details });
      }
    }
  };
}

test("raiz preserva GSL-v1, expõe API 2.0 e request id", async () => {
  const logs = [];
  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/", {
      headers: { "X-Request-Id": "req_test_root_001" }
    }),
    firebaseEnv(logs)
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Request-Id"), "req_test_root_001");

  const body = await response.json();
  assert.equal(body.name, "GuiaSys Licensing API");
  assert.equal(body.version, "2.0.1");
  assert.equal(body.protocolVersion, "GSL-v1");

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "info");
  assert.equal(logs[0].event, "request.completed");
  assert.equal(logs[0].details.status, 200);
  assert.equal(logs[0].details.runtime, "firebase-functions-v2");
});

test("health identifica Firebase Functions/Admin SDK sem exigir service account JSON", async () => {
  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/health"),
    firebaseEnv()
  );

  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.firebaseProject, "guiasys-licensing");
  assert.equal(body.runtime, "firebase-functions-v2");
  assert.equal(body.adminSdkConfigured, true);
  assert.equal(body.serviceAccountConfigured, false);
  assert.equal(body.adminConfigured, true);
  assert.equal(body.protocolVersion, "GSL-v1");
});

test("request id inválido é substituído por identificador seguro", async () => {
  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/health", {
      headers: { "X-Request-Id": "x" }
    }),
    firebaseEnv()
  );

  assert.match(response.headers.get("X-Request-Id") || "", /^req_[a-f0-9]{32}$/);
});

test("método incorreto mantém erro contratual e CORS administrativo", async () => {
  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/health", {
      method: "POST",
      headers: { Origin: "https://licencas.guiasys.online" }
    }),
    firebaseEnv()
  );

  assert.equal(response.status, 405);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://licencas.guiasys.online"
  );

  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "method_not_allowed");
  assert.equal(body.details.expectedMethod, "GET");
});

test("preflight das rotas públicas continua compatível com clientes web", async () => {
  const response = await handleRequest(
    new Request("https://api.example/api/v1/license/validate", {
      method: "OPTIONS",
      headers: { Origin: "https://cliente.exemplo" }
    }),
    firebaseEnv()
  );

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://cliente.exemplo"
  );
  assert.match(
    response.headers.get("Access-Control-Allow-Methods") || "",
    /POST/
  );
});

test("rota inexistente continua retornando 404 sem vazar detalhes internos", async () => {
  const response = await handleRequest(
    new Request("https://licencas.guiasys.online/nao-existe"),
    firebaseEnv()
  );

  assert.equal(response.status, 404);
  assert.match(response.headers.get("X-Request-Id") || "", /^req_[a-f0-9]{32}$/);

  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: "not_found",
    message: "Rota não encontrada."
  });
});
