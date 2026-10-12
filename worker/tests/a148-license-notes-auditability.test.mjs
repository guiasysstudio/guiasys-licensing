import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../../assets/css/app.css", import.meta.url), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `seção não encontrada: ${start}`);
  return source.slice(from, to);
}

const helpersSource = section(appSource, "function e(", "function entitlementExpected(");
const { licenseNotesHtml, licenseMatchesSearch } = Function(
  `${helpersSource}; return { licenseNotesHtml, licenseMatchesSearch };`
)();
const generatedModalSource = section(appSource, "function showGeneratedLicense(", "async function licensesView(");
const licensesViewSource = section(appSource, "async function licensesView(", "function openLicenseActions(");
const actionsModalSource = section(appSource, "function openLicenseActions(", "function openRenewLicense(");

const license = {
  key: "AGS-TESTE-123",
  customerName: "Cliente Auditoria",
  customerEmail: "auditoria@example.com",
  notes: "Observação operacional importante"
};

test("Ações da licença exibe Observação e usa o renderer seguro", () => {
  assert.match(actionsModalSource, /<span>Observação<\/span>/);
  assert.match(actionsModalSource, /license-notes-content[^`]*\$\{licenseNotesHtml\(license\.notes\)\}/s);
});

test("Licença criada exibe imediatamente a observação persistida", () => {
  assert.match(generatedModalSource, /<span>Observação<\/span>/);
  assert.match(generatedModalSource, /license-notes-content[^`]*\$\{licenseNotesHtml\(license\.notes\)\}/s);
});

test("notes passa por e e neutraliza HTML persistido", () => {
  const malicious = '<img src=x onerror=alert(1)> & "teste"';
  const rendered = licenseNotesHtml(malicious);
  assert.equal(rendered, "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;teste&quot;");
  assert.equal(rendered.includes("<img"), false);
  assert.match(helpersSource, /return value\.trim\(\) \? e\(value\) : "—"/);
});

test("notes vazio ou ausente recebe fallback seguro para licenças antigas", () => {
  assert.equal(licenseNotesHtml(""), "—");
  assert.equal(licenseNotesHtml("  \n\t"), "—");
  assert.equal(licenseNotesHtml(null), "—");
  assert.equal(licenseNotesHtml(undefined), "—");
});

test("quebras de linha e texto longo são preservados integralmente", () => {
  assert.equal(licenseNotesHtml("Linha 1\nLinha 2"), "Linha 1\nLinha 2");
  const longNotes = "auditoria ".repeat(500);
  assert.equal(licenseNotesHtml(longNotes), longNotes);
});

test("busca encontra licença pelo conteúdo de notes", () => {
  assert.equal(licenseMatchesSearch(license, "operacional importante"), true);
  assert.equal(licenseMatchesSearch(license, "OPERACIONAL"), true);
  assert.equal(licenseMatchesSearch(license, "inexistente"), false);
});

test("busca continua encontrando key, cliente e e-mail", () => {
  assert.equal(licenseMatchesSearch(license, "ags-teste"), true);
  assert.equal(licenseMatchesSearch(license, "cliente auditoria"), true);
  assert.equal(licenseMatchesSearch(license, "auditoria@example.com"), true);
});

test("busca vazia e notes ausente continuam válidos", () => {
  assert.equal(licenseMatchesSearch({ ...license, notes: undefined }, ""), true);
  assert.equal(licenseMatchesSearch({ ...license, notes: undefined }, "AGS-TESTE"), true);
  assert.equal(licenseMatchesSearch({ ...license, notes: undefined }, "observação"), false);
});

test("tela Licenças usa o filtro central e comunica a busca por observação", () => {
  assert.match(licensesViewSource, /licenses\.filter\(item => licenseMatchesSearch\(item, query\)\)/);
  assert.match(licensesViewSource, /aria-label="Buscar licença por key, cliente, e-mail ou observação"/);
  assert.match(licensesViewSource, /placeholder="Buscar key, cliente ou observação"/);
});

test("tabela permanece compacta e não ganha coluna Observação", () => {
  assert.match(licensesViewSource, /\["Key", "Cliente", "Plano", "Status", "Expiração", "Disp\.", ""\]/);
  assert.equal(/\[\s*"Observação"/.test(licensesViewSource), false);
  assert.equal(/<th[^>]*>Observação<\/th>/.test(licensesViewSource), false);
});

test("CSS preserva linhas, quebra palavras longas e não usa largura fixa", () => {
  const notesRules = section(cssSource, ".license-notes {", ".action-grid {");
  assert.match(notesRules, /min-width:\s*0/);
  assert.match(notesRules, /white-space:\s*pre-wrap/);
  assert.match(notesRules, /overflow-wrap:\s*anywhere/);
  assert.match(notesRules, /word-break:\s*break-word/);
  assert.equal(/(?:width|max-width):\s*\d+px/.test(notesRules), false);
});

test("modais de observação continuam na estrutura responsiva do A14.7", () => {
  const modalRules = section(cssSource, ".modal-card {", ".toast-host {");
  assert.match(actionsModalSource, /openModal\(\{/);
  assert.match(generatedModalSource, /openModal\(\{/);
  assert.match(modalRules, /\.modal-card\s*{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(modalRules, /\.modal-body\s*{[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.equal(/license-notes[^>]*style=/.test(actionsModalSource + generatedModalSource), false);
});

test("nenhum modal interpola license.notes sem escape", () => {
  assert.equal(actionsModalSource.includes("${license.notes}"), false);
  assert.equal(generatedModalSource.includes("${license.notes}"), false);
  assert.equal((actionsModalSource.match(/licenseNotesHtml\(license\.notes\)/g) || []).length, 1);
  assert.equal((generatedModalSource.match(/licenseNotesHtml\(license\.notes\)/g) || []).length, 1);
});
