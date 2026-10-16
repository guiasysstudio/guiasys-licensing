import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("regras da plataforma preservam o Licensing e liberam só namespaces Studio", async () => {
  const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  for (const namespace of ["studioAdmins", "studioContactMessages", "studioProfiles", "studioProjects"]) {
    assert.match(rules, new RegExp(`match /${namespace}/`));
  }
  assert.match(rules, /match \/\{document=\*\*\}/);
  assert.doesNotMatch(rules, /match \/projects\/\{projectId\}/);
  assert.doesNotMatch(rules, /match \/customerAccounts\//);
  assert.doesNotMatch(rules, /match \/admins\//);
});

test("mapeamento local inclui o site Studio sem alterar o projeto padrão", async () => {
  const config = JSON.parse(await readFile(new URL("../../.firebaserc", import.meta.url), "utf8"));
  assert.equal(config.projects.default, "guiasys-licensing");
  assert.deepEqual(config.targets["guiasys-licensing"].hosting.studio, ["guiasys-studio-e1ea8"]);
});

test("produção aceita somente os domínios com.br", async () => {
  const [api, panel, catalog] = await Promise.all([
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../../public/index.html", import.meta.url), "utf8")
  ]);

  for (const origin of [
    "https://licencas.guiasys.com.br",
    "https://painel.licencas.guiasys.com.br"
  ]) assert.match(api, new RegExp(origin.replaceAll(".", "\\.")));

  assert.match(panel, /licencas\.guiasys\.com\.br/);
  assert.doesNotMatch(`${api}\n${panel}`, /\.online/);
  assert.match(catalog, /<link rel="canonical" href="https:\/\/licencas\.guiasys\.com\.br\/">/);
});
