import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");

test("simulador registra cada listener de trial uma única vez", () => {
  assert.equal(
    (source.match(/#trial-test-start"\)\.addEventListener\("click"/g) || []).length,
    1
  );
  assert.equal(
    (source.match(/#trial-test-validate"\)\.addEventListener\("click"/g) || []).length,
    1
  );
});

test("listeners de trial ficam fora do forEach das ações de licença", () => {
  const loopStart = source.indexOf("simulatorButtons.forEach(button =>");
  const loopEnd = source.indexOf("let trialBusy = false;", loopStart);
  const trialHandler = source.indexOf('document.querySelector("#trial-test-start").addEventListener');
  const trialView = source.indexOf("async function trialView()", loopStart);

  assert.ok(loopStart >= 0);
  assert.ok(loopEnd > loopStart);
  assert.ok(trialHandler > loopEnd);
  assert.ok(trialView > trialHandler);

  const loopRegion = source.slice(loopStart, loopEnd);
  assert.equal(loopRegion.includes("#trial-test-start"), false);
  assert.equal(loopRegion.includes("#trial-test-validate"), false);
});

test("simulador usa verificação completa do entitlement", () => {
  assert.match(source, /verifyEntitlementToken\(/);
  assert.match(source, /sha256HexText\(deviceId\)/);
  assert.match(source, /entitlementExpected\(project, type, deviceHash\)/);
});
