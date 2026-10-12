import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stagePath = path.join(root, "scripts/int05-integration-smoke.mjs");
const preflightPath = path.join(root, "scripts/int08-firebase-preflight.mjs");

function stage(overrides = {}) {
  return spawnSync(process.execPath, [stagePath], {
    env: {
      ...process.env,
      GUIASYS_INTEGRATION_CODE: "GSLI-ABCD-EFGH-JKLM",
      GUIASYS_INTEGRATION_EXPECTED_PROJECT: "guiasys-licensing-hml",
      GUIASYS_INTEGRATION_STAGE_ACK: "",
      GUIASYS_INTEGRATION_API_BASE: "",
      GUIASYS_INTEGRATION_ADMIN_BASE: "",
      ...overrides
    },
    encoding: "utf8", timeout: 10_000
  });
}

test("INT-08.3: integration smoke requires explicit isolated staging acknowledgement", () => {
  const r = stage();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /endereços do ambiente isolado/);
  const withoutAck = stage({
    GUIASYS_INTEGRATION_API_BASE: "https://gsl-isolated-test.web.app",
    GUIASYS_INTEGRATION_ADMIN_BASE: "https://gsl-isolated-admin.web.app"
  });
  assert.notEqual(withoutAck.status, 0);
  assert.match(withoutAck.stderr + withoutAck.stdout, /STAGE_ACK/);
});

test("INT-08.3: active production and its Hosting preview aliases cannot run mutative config smoke", () => {
  const pairs = [
    ["https://licencas.guiasys.online", "https://painel.licencas.guiasys.online"],
    ["https://guiasys-licensing.web.app", "https://guiasys-licensing-admin.web.app"],
    ["https://guiasys-licensing--int08-backup-20261012-2j9fp5rj.web.app",
      "https://guiasys-licensing-admin--int08-backup-20261012-eysuak6v.web.app"]
  ];
  for (const [api, admin] of pairs) {
    const r = stage({
      GUIASYS_INTEGRATION_STAGE_ACK: "ISOLATED_TEST_PROJECT",
      GUIASYS_INTEGRATION_API_BASE: api,
      GUIASYS_INTEGRATION_ADMIN_BASE: admin
    });
    assert.notEqual(r.status, 0, api);
    assert.match(r.stderr + r.stdout, /projeto Firebase de produção/, api);
  }
});

test("INT-08.4: explicit staging project pin required before mutative smoke", () => {
  const r = stage({
    GUIASYS_INTEGRATION_STAGE_ACK: "ISOLATED_TEST_PROJECT",
    GUIASYS_INTEGRATION_API_BASE: "https://guiasys-licensing-hml.web.app",
    GUIASYS_INTEGRATION_ADMIN_BASE: "https://guiasys-licensing-hml-admin.web.app",
    GUIASYS_INTEGRATION_EXPECTED_PROJECT: ""
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /EXPECTED_PROJECT/);
});

test("INT-08.3: staging refuses the live Firebase project even under custom aliases", async () => {
  const code = await readFile(stagePath, "utf8");
  assert.match(code, /health\.firebaseProject !== "guiasys-licensing"/);
  assert.match(code, /adminHealth\.firebaseProject === health\.firebaseProject/);
  assert.match(code, /ISOLATED_TEST_PROJECT/);
  assert.doesNotMatch(code, /POST \/api\/v1\/(license|trial)\//);
});

test("INT-08.3: production fingerprint smoke is GET-only and compares CRLF-normalized digests", async () => {
  const content = await readFile(preflightPath, "utf8");
  assert.match(content, /method: "GET"/);
  assert.match(content, /normalizedDigest/);
  assert.match(content, /replace\(\/\\r\\n\/g, "\\n"\)/);
  assert.match(content, /mode === "post"/);
  assert.match(content, /assets\/js\/integration-contract-support\.js/);
  assert.doesNotMatch(content, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});
