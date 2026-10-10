import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8");
const catalog = await readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8");
const themeInit = await readFile(new URL("../../public/assets/theme-init.js", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const adminCss = await readFile(new URL("../../assets/css/app.css", import.meta.url), "utf8");
const adminApp = await readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8");
const firebase = JSON.parse(await readFile(new URL("../../firebase.json", import.meta.url), "utf8"));

function themeVariables(theme) {
  const match = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\{([^}]+)\\}`));
  assert.ok(match, `Tokens do tema ${theme} ausentes.`);
  return Object.fromEntries(
    match[1].split(";").filter(Boolean).map(declaration => {
      const separator = declaration.indexOf(":");
      return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
    })
  );
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255);
}

function luminance(hex) {
  const channels = hexToRgb(hex).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function executeTheme({ stored = null, dark = false } = {}) {
  const values = new Map(stored === null ? [] : [["gsl.theme.v1", stored]]);
  const attributes = new Map();
  const listeners = {};
  const toggle = {
    dataset: {},
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(type, listener) { listeners[`toggle:${type}`] = listener; }
  };
  const meta = { setAttribute(name, value) { attributes.set(`meta:${name}`, value); } };
  const mediaQuery = {
    matches: dark,
    addEventListener(type, listener) { listeners[`media:${type}`] = listener; }
  };
  const documentListeners = {};
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      if (selector === "#theme-toggle") return toggle;
      if (selector === 'meta[name="theme-color"]') return meta;
      return null;
    },
    addEventListener(type, listener) { documentListeners[type] = listener; }
  };
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
  const window = { matchMedia() { return mediaQuery; } };

  vm.runInNewContext(themeInit, { document, localStorage, window });
  return { attributes, document, documentListeners, listeners, mediaQuery, toggle, values, window };
}

test("portal público declara temas light/dark e aplica tokens às superfícies principais", () => {
  const dark = themeVariables("dark");
  const light = themeVariables("light");
  for (const variables of [dark, light]) {
    for (const token of ["--bg", "--surface", "--surface-2", "--media-surface", "--text", "--muted", "--line", "--field-bg", "--code-bg", "--pix-bg", "--toast-bg"]) {
      assert.ok(variables[token], `Token ausente: ${token}`);
    }
  }
  assert.match(css, /body\{[^}]*background:var\(--bg\)[^}]*color:var\(--text\)/);
  assert.match(css, /\.site-header\{[^}]*background:var\(--header-bg\)/);
  assert.match(css, /input,textarea,select\{[^}]*background:var\(--field-bg\)/);
  assert.match(css, /\.site-footer\{[^}]*background:var\(--bg\)/);
  assert.doesNotMatch(css.slice(css.indexOf("*{box-sizing")), /background:(?:#111(?:111)?|#0d0d0d|#15140f|#191919|#24221e)/i);
});

test("tema inicial segue o sistema e atualiza a UI do navegador", () => {
  const dark = executeTheme({ dark: true });
  assert.equal(dark.document.documentElement.dataset.theme, "dark");
  assert.equal(dark.attributes.get("meta:content"), "#0C171F");

  const light = executeTheme({ dark: false });
  assert.equal(light.document.documentElement.dataset.theme, "light");
  assert.equal(light.attributes.get("meta:content"), "#FFFAEF");
});

test("preferência manual válida vence o sistema e valor inválido é ignorado", () => {
  assert.equal(executeTheme({ stored: "light", dark: true }).document.documentElement.dataset.theme, "light");
  assert.equal(executeTheme({ stored: "dark", dark: false }).document.documentElement.dataset.theme, "dark");
  assert.equal(executeTheme({ stored: "sepia", dark: false }).document.documentElement.dataset.theme, "light");
});

test("mudança do sistema só é seguida sem override manual", () => {
  const runtime = executeTheme({ dark: false });
  runtime.mediaQuery.matches = true;
  runtime.listeners["media:change"]();
  assert.equal(runtime.document.documentElement.dataset.theme, "dark");

  runtime.documentListeners.DOMContentLoaded();
  runtime.listeners["toggle:click"]();
  assert.equal(runtime.document.documentElement.dataset.theme, "light");
  assert.equal(runtime.values.get("gsl.theme.v1"), "light");
  assert.equal(runtime.attributes.get("aria-label"), "Ativar modo escuro");
  assert.equal(runtime.attributes.get("title"), "Ativar modo escuro");
  assert.equal(runtime.attributes.get("aria-pressed"), "true");

  runtime.mediaQuery.matches = true;
  runtime.listeners["media:change"]();
  assert.equal(runtime.document.documentElement.dataset.theme, "light");
});

test("toggle local é acessível, exibe sol/lua e troca sem reload", () => {
  assert.match(html, /id="theme-toggle"[^>]*type="button"[^>]*aria-label="Ativar modo claro"[^>]*title="Ativar modo claro"[^>]*aria-pressed="false"/);
  assert.match(html, /theme-icon-sun/);
  assert.match(html, /theme-icon-moon/);
  assert.match(css, /\.theme-toggle\{[^}]*width:44px[^}]*height:44px/);
  assert.match(css, /\.theme-icon-moon\{display:none\}/);
  assert.match(css, /\[data-theme="light"\] \.theme-icon-sun\{display:none\}/);
  assert.match(css, /a:focus-visible,button:focus-visible/);
  assert.match(catalog, /GSLTheme\?\.initializeToggle\(\)/);
  assert.equal((themeInit + catalog).includes("location.reload"), false);
});

test("contraste de texto, links e botão primário passa em ambos os temas", () => {
  const brandInk = "#101820";
  const gold = "#f2a900";
  assert.ok(contrast(brandInk, gold) >= 4.5);
  for (const theme of ["dark", "light"]) {
    const variables = themeVariables(theme);
    for (const background of [variables["--bg"], variables["--surface"]]) {
      assert.ok(contrast(variables["--text"], background) >= 4.5, `${theme}: texto principal`);
      assert.ok(contrast(variables["--muted"], background) >= 4.5, `${theme}: texto secundário`);
      assert.ok(contrast(variables["--accent-text"], background) >= 4.5, `${theme}: link dourado`);
    }
    assert.ok(contrast(variables["--line"], variables["--surface"]) >= 3, `${theme}: borda de componente`);
  }
});

test("tema permanece isolado do Admin, sem novos hosts ou relaxamento de CSP", () => {
  const publicHosting = firebase.hosting.find(item => item.target === "public");
  const headers = publicHosting.headers.find(item => item.source === "**")?.headers || [];
  const csp = headers.find(item => item.key === "Content-Security-Policy")?.value || "";
  assert.match(csp, /script-src 'self'/);
  assert.equal(csp.includes("unsafe-inline"), false);
  assert.equal(csp.includes("unsafe-eval"), false);
  assert.equal((html + css + catalog + themeInit).includes("googleusercontent.com"), false);
  assert.equal((adminHtml + adminCss + adminApp).includes("gsl.theme.v1"), false);
  assert.equal((adminHtml + adminCss + adminApp).includes("theme-toggle"), false);
});
