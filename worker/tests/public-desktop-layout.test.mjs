import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8");
const catalog = await readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  assert.ok(match, `Regra CSS ausente: ${selector}`);
  return match[1];
}

function token(name) {
  const match = css.match(new RegExp(`--${name}:([^;]+)`));
  assert.ok(match, `Token CSS ausente: --${name}`);
  return match[1].trim();
}

test("grid público usa um token desktop central maior que o limite legado", () => {
  const contentMax = Number.parseInt(token("content-max"), 10);
  assert.ok(contentMax > 1180 && contentMax <= 1520);
  assert.equal(contentMax, 1480);
  assert.equal(token("page-gutter"), "clamp(24px,3.125vw,64px)");
  assert.match(rule(".page,.section"), /width:min\(var\(--content-max\),calc\(100% - \(var\(--page-gutter\) \* 2\)\)\)/);
  assert.doesNotMatch(css, /min\(1180px|100% - 36px/);
});

test("largura útil cresce em desktops comuns e para de crescer em telas muito largas", () => {
  const expected = new Map([[1366, 1280.625], [1440, 1350], [1600, 1480], [1920, 1480], [2560, 1480]]);
  for (const [viewport, wanted] of expected) {
    const gutter = Math.min(64, Math.max(24, viewport * 0.03125));
    const content = Math.min(1480, viewport - gutter * 2);
    assert.equal(content, wanted, `${viewport}px`);
    assert.ok(content <= viewport && content > 1180, `${viewport}px permanece sem overflow e mais amplo que o layout anterior`);
  }
});

test("hero separa fundo full-bleed do conteúdo limitado ao grid", () => {
  assert.match(catalog, /el\("section", "hero-shell"\)/);
  assert.match(catalog, /el\("div", "hero section"\)/);
  assert.match(catalog, /heroShell\.append\(hero\)/);
  assert.match(catalog, /app\.append\(heroShell, featured, institutional\)/);

  assert.match(rule(".hero-shell"), /overflow:hidden/);
  assert.match(rule(".hero-shell::before"), /inset:0/);
  assert.match(rule(".hero-shell::before"), /radial-gradient/);
  assert.match(rule(".hero-shell::before"), /linear-gradient/);
  assert.match(rule(".hero-shell::before"), /transparent 82%/);
  assert.doesNotMatch(css, /\.hero::before/);
  assert.doesNotMatch(rule(".hero-shell::before"), /(?:width|inline-size):\s*\d+px/);
  assert.match(rule(".hero"), /grid-template-columns:minmax\(0,1\.05fr\) minmax\(420px,\.95fr\)/);
});

test("brilho tem intensidade própria em light/dark e desaparece gradualmente", () => {
  const dark = rule(':root,[data-theme="dark"]');
  const light = rule('[data-theme="light"]');
  for (const block of [dark, light]) {
    assert.match(block, /--hero-glow:/);
    assert.match(block, /--hero-glow-soft:/);
    assert.match(block, /--hero-sheen:/);
  }
  assert.notEqual(dark.match(/--hero-glow:([^;]+)/)?.[1], light.match(/--hero-glow:([^;]+)/)?.[1]);
  assert.ok((rule(".hero-shell::before").match(/transparent/g) || []).length >= 3);
});

test("header e footer usam wrappers alinhados ao mesmo grid", () => {
  assert.match(html, /<header class="site-header">\s*<div class="site-header-inner">/);
  assert.match(html, /<footer class="site-footer"[^>]*>\s*<div class="site-footer-inner">/);
  for (const selector of [".site-header-inner", ".site-footer-inner"]) {
    const declarations = rule(selector);
    assert.match(declarations, /width:min\(var\(--content-max\),calc\(100% - \(var\(--page-gutter\) \* 2\)\)\)/);
    assert.match(declarations, /margin-inline:auto/);
  }
});

test("catálogo, detalhe, galeria, planos e carrinho aproveitam o desktop sem esticar cards", () => {
  assert.match(rule(".catalog-grid"), /repeat\(auto-fit,minmax\(min\(300px,100%\),1fr\)\)/);
  assert.match(rule(".product-card"), /max-width:420px/);
  assert.match(rule(".detail-hero"), /minmax\(480px,1\.1fr\)/);
  assert.match(rule(".detail-banner"), /max-height:520px/);
  assert.match(rule(".screenshots"), /minmax\(min\(320px,100%\),1fr\)/);
  assert.match(rule(".plans"), /auto-fit/);
  assert.match(css, /\.plan-card\{width:100%;max-width:440px/);
  assert.match(rule(".cart-layout"), /minmax\(340px,400px\)/);
});

test("conta ganha shell amplo enquanto formulários e textos mantêm limites de leitura", () => {
  assert.match(rule(".account-shell"), /260px minmax\(0,1fr\)/);
  assert.match(rule(".account-shell>.panel"), /max-width:960px/);
  assert.match(rule(".form-card"), /width:min\(680px,100%\)/);
  assert.match(rule(".records"), /minmax\(min\(520px,100%\),1fr\)/);
  assert.match(rule(".hero-copy"), /max-width:760px/);
  assert.match(rule(".lead"), /max-width:660px/);
  assert.match(rule(".legal"), /max-width:800px/);
});

test("layout previne overflow estrutural, reduz altura morta e preserva breakpoints", () => {
  assert.match(rule("body"), /overflow-x:clip/);
  assert.match(rule(".hero"), /min-height:clamp\(520px,68vh,660px\)/);
  assert.match(rule(".hero.section"), /padding-block:clamp\(44px,6vh,72px\)/);
  assert.match(rule(".page > .section"), /width:100%/);
  for (const breakpoint of [820, 700, 560]) assert.match(css, new RegExp(`@media\\(max-width:${breakpoint}px\\)`));
  assert.match(css, /@media\(max-width:820px\)\{[^}]*[\s\S]*?\.hero,.detail-hero,.cart-layout,.account-shell\{grid-template-columns:1fr\}/);
});

test("mídias comerciais continuam em contain com os paddings aprovados", () => {
  for (const selector of [".product-media img", ".product-icon", ".detail-logo", ".detail-banner", ".screenshots img"]) {
    assert.match(rule(selector), /object-fit:contain/);
  }
  assert.match(rule(".detail-banner"), /padding:clamp\(14px,2vw,24px\)/);
  assert.match(rule(".screenshots img"), /padding:clamp\(12px,1\.8vw,20px\)/);
});
