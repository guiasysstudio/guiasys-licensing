import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../../scripts/int08-firebase-preflight.mjs", import.meta.url),
  "utf8"
);

test("INT-08: preflight remoto utiliza somente GET e não altera licenças", () => {
  assert.match(source, /method: "GET"/);
  assert.doesNotMatch(source, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /\/api\/v1\/(?:license|trial)\//);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /redirect: "error"/);
});

test("INT-08: pós-deploy valida hashes da versão local do painel e verificador", () => {
  assert.match(source, /mode === "post"/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /deployedSha256/);
  assert.match(source, /\/assets\/js\/app\.js/);
  assert.match(source, /\/assets\/js\/entitlement-verifier\.js/);
  assert.match(source, /\/assets\/js\/integration-contract-support\.js/);
});

test("INT-08: checkout público apenas observado, nunca requisito de atualização da integração", () => {
  assert.match(source, /\/assets\/catalog\.js", "public\/assets\/catalog\.js", false/);
  assert.match(source, /sem operações de licença|nenhuma licença|nenhuma licença ou trial/i);
});
