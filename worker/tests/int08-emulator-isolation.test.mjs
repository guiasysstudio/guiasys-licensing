import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const suitePath = path.join(root, "scripts/test-int08-emulators.mjs");

test("INT-08 final: suite mutativa recusa o projeto Firebase de producao", () => {
  const result = spawnSync(process.execPath, [suitePath], {
    cwd: root,
    env: {
      ...process.env,
      GCLOUD_PROJECT: "guiasys-licensing",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      FUNCTIONS_EMULATOR_HOST: "127.0.0.1:5001"
    },
    encoding: "utf8",
    timeout: 10_000
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /projeto ficticio dos emuladores/i);
});

test("INT-08 final: todos os probes exigem projeto ficticio e hosts locais", async () => {
  const files = [
    "test-c15-auth-emulator.mjs",
    "test-c15-functions-emulator.mjs",
    "test-c15-rules-emulator.mjs",
    "test-firebase-rules.mjs",
    "test-int08-e2e-emulator.mjs",
    "test-c14c-emulator.mjs"
  ];

  for (const file of files) {
    const source = await readFile(path.join(root, "scripts", file), "utf8");
    assert.match(source, /demo-guiasys-licensing/, file);
    assert.match(source, /127\\?\.0\\?\.0\\?\.1\|localhost/, file);
  }
});
