import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts/int08-staging-kit.mjs");
const stage = "guiasys-licensing-hml";
function run(extra, conf) {
  return spawnSync(process.execPath, [script, "--check"], {
    env: {
      ...process.env,
      GUIASYS_STAGE_PROJECT_ID: stage,
      GUIASYS_STAGE_PUBLIC_SITE: stage,
      GUIASYS_STAGE_ADMIN_SITE: stage + "-admin",
      GUIASYS_STAGE_WEB_CONFIG_FILE: conf,
      ...extra
    },
    encoding: "utf8", timeout: 8_000
  });
}

test("INT-08.4: project/site mismatch and production IDs block staging before any writes", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "gsl-int08-stage-gate-"));
  const conf = path.join(temp, "fake-staging-web.json");
  try {
    await writeFile(conf, JSON.stringify({
      apiKey: "AIzaSySTAGING_TEST_ONLY_NOT_REAL",
      authDomain: stage + ".firebaseapp.com",
      projectId: stage,
      storageBucket: stage + ".firebasestorage.app",
      messagingSenderId: "1234567890",
      appId: "1:1234567890:web:example"
    }));
    const ok = run({}, conf);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /NENHUM.*deploy/);
    const production = run({
      GUIASYS_STAGE_PROJECT_ID: "guiasys-licensing",
      GUIASYS_STAGE_PUBLIC_SITE: "guiasys-licensing",
      GUIASYS_STAGE_ADMIN_SITE: "guiasys-licensing-admin"
    }, conf);
    assert.notEqual(production.status, 0);
    assert.match(production.stderr, /projeto de homologação separado/);
    const liveSite = run({
      GUIASYS_STAGE_PUBLIC_SITE: "guiasys-licensing"
    }, conf);
    assert.notEqual(liveSite.status, 0);
    assert.match(liveSite.stderr, /Sites devem ser/);
    const liveConfig = { apiKey: "AIzaSyBXcnv1YsLCXTCtPy0FNs_vvZ_BJMK5o00",
      authDomain: "guiasys-licensing.firebaseapp.com", projectId: "guiasys-licensing",
      storageBucket: "guiasys-licensing.firebasestorage.app",
      messagingSenderId: "854287499951",
      appId: "1:854287499951:web:0369b194e7663a9d9c0a5a" };
    await writeFile(conf, JSON.stringify(liveConfig));
    const rejected = run({}, conf);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Web config aponta para outro projeto/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("INT-08.4: no automatic deploy command in staging artifact builder", async () => {
  const { readFile } = await import("node:fs/promises");
  const code = await readFile(script, "utf8");
  assert.doesNotMatch(code, /execFileSync\s*\(\s*["']firebase/);
  assert.doesNotMatch(code, /spawnSync\s*\(\s*["']firebase/);
  assert.match(code, /".int08-staging"/);
  assert.match(code, /mode === "--verify"/);
  assert.match(code, /WEB_CONFIG_FILE/);
  assert.match(code, /firebaseJson\.functions\.source = ".int08-staging\/worker"/);
});
