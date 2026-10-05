import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../../assets/css/app.css", import.meta.url), "utf8");
const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");

function hexToRgb(hex) {
  const value = String(hex).trim().replace("#", "");
  assert.match(value, /^[0-9a-f]{6}$/i);
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255);
}

function channel(value) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function cssHexVariable(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `Variável CSS --${name} não encontrada.`);
  return match[1];
}

test("paleta principal mantém contraste mínimo WCAG para texto normal", () => {
  const background = cssHexVariable("bg");
  const primary = cssHexVariable("primary");
  const primary2 = cssHexVariable("primary-2");
  const muted2 = cssHexVariable("muted-2");

  assert.ok(contrast("#ffffff", primary) >= 4.5);
  assert.ok(contrast("#ffffff", primary2) >= 4.5);
  assert.ok(contrast(muted2, background) >= 4.5);
});

test("sidebar e viewport móvel permanecem acessíveis em telas curtas e estreitas", () => {
  assert.match(css, /\.sidebar\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /overscroll-behavior:\s*contain/);
  assert.match(css, /body\.sidebar-open\s*\{\s*overflow:\s*hidden/);
  assert.match(css, /body\.sidebar-open \.sidebar-backdrop\s*\{\s*display:\s*block/);
  assert.match(css, /@media \(max-width:\s*420px\)/);
  assert.ok((css.match(/100dvh/g) || []).length >= 4);
});

test("controles interativos possuem alvos de toque e foco visível", () => {
  assert.match(css, /\.btn\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.nav-button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.icon-button\s*\{[\s\S]*?height:\s*44px[\s\S]*?min-width:\s*44px/);
  assert.match(css, /\.compact-input\s*\{[\s\S]*?height:\s*44px/);
  assert.match(css, /\.help-tip\s*\{[\s\S]*?width:\s*24px[\s\S]*?height:\s*24px/);
  assert.match(css, /:where\(button, input, select, textarea, a, \[tabindex\]\):focus-visible/);
});

test("movimento reduzido desativa animações e transições relevantes", () => {
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms !important/);
  assert.match(css, /transition-duration:\s*0\.01ms !important/);
  assert.match(css, /\.spinner\s*\{[\s\S]*?animation:\s*none !important/);
});

test("CSS legado não utilizado foi removido", () => {
  assert.equal(css.includes(".setup-card"), false);
  assert.equal(css.includes(".setup-row"), false);
  assert.equal(css.includes(".code-field"), false);
});

test("HTML expõe semântica correta para menu móvel e status", () => {
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /id="sidebar"[^>]*aria-label="Menu lateral"/);
  assert.match(html, /id="mobile-menu-button"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
  assert.match(html, /id="sidebar-backdrop"[^>]*aria-hidden="true"/);
  assert.match(html, /class="api-status" role="status" aria-live="polite"/);
});

test("navegação, toast, tabela e busca possuem semântica acessível", () => {
  assert.match(app, /aria-current="page"/);
  assert.match(app, /host\.setAttribute\("aria-live", "polite"\)/);
  assert.match(app, /node\.setAttribute\("role", tone === "danger" \? "alert" : "status"\)/);
  assert.match(app, /<caption class="sr-only">/);
  assert.match(app, /<th scope="col">/);
  assert.match(app, /aria-label="Buscar licença por cliente ou chave"/);
  assert.match(app, /function updateDocumentTitle\(/);
  assert.match(app, /function setSidebarOpen\(/);
});

test("todos os botões declarados no HTML e templates possuem type explícito", () => {
  for (const [name, source] of [["index.html", html], ["app.js", app]]) {
    const buttons = source.match(/<button\b[^>]*>/g) || [];
    assert.ok(buttons.length > 0, `${name} deveria conter botões.`);

    const missing = buttons.filter(button => !/\btype\s*=/.test(button));
    assert.deepEqual(missing, [], `${name} contém botão sem type explícito.`);
  }
});

test("cliente não mantém cabeçalho duplicado e modais têm foco programático", () => {
  assert.match(app, /\["Cliente", "E-mail", "Status", "Status da licença"/);
  assert.match(app, /role="dialog" aria-modal="true" aria-labelledby="\$\{titleId\}" tabindex="-1"/);
});
