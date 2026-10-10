import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8");

function declarations(selector) {
  const marker = `${selector}{`;
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `Regra CSS ausente: ${selector}`);
  const end = css.indexOf("}", start + marker.length);
  assert.ok(end > start, `Regra CSS incompleta: ${selector}`);
  return Object.fromEntries(
    css.slice(start + marker.length, end)
      .split(";")
      .filter(Boolean)
      .map(declaration => {
        const separator = declaration.indexOf(":");
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
      })
  );
}

function containedSize(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    offsetX: (boxWidth - sourceWidth * scale) / 2,
    offsetY: (boxHeight - sourceHeight * scale) / 2
  };
}

test("mídias comerciais públicas usam contain, centralização e limites de card", () => {
  const productContainer = declarations(".product-media");
  const productImage = declarations(".product-media img");
  const productIcon = declarations(".product-icon");
  const detailColumn = declarations(".detail-hero>*");
  const detailLogo = declarations(".detail-logo");
  const banner = declarations(".detail-banner");
  const gallery = declarations(".screenshots");
  const screenshot = declarations(".screenshots img");

  assert.equal(productContainer.overflow, "hidden");
  assert.equal(productContainer.background, "var(--media-surface)");
  assert.equal(productContainer["box-sizing"], "border-box");
  assert.equal(productContainer.height, "160px");
  assert.equal(productContainer.padding, "18px");
  assert.equal(productImage["object-fit"], "contain");
  assert.equal(productImage["object-position"], "center");
  assert.equal(productImage.width, "auto");
  assert.equal(productImage.height, "auto");
  assert.equal(productImage["max-width"], "100%");
  assert.equal(productImage["max-height"], "100%");
  assert.equal(productIcon["object-fit"], "contain!important");
  assert.equal(productIcon["object-position"], "center");

  assert.equal(detailColumn["min-width"], "0");
  assert.equal(detailLogo["object-fit"], "contain");
  assert.equal(detailLogo["object-position"], "center");
  assert.equal(detailLogo.overflow, "hidden");
  assert.equal(banner["object-fit"], "contain");
  assert.equal(banner["object-position"], "center");
  assert.equal(banner["max-width"], "100%");
  assert.equal(banner.overflow, "hidden");
  assert.equal(banner.background, "var(--media-surface)");
  assert.equal(banner["box-sizing"], "border-box");
  assert.equal(banner.padding, "clamp(14px,2vw,24px)");

  assert.equal(gallery["min-width"], "0");
  assert.equal(gallery["grid-template-columns"], "repeat(auto-fit,minmax(min(240px,100%),1fr))");
  assert.equal(gallery.overflow, "hidden");
  assert.equal(screenshot["object-fit"], "contain");
  assert.equal(screenshot["object-position"], "center");
  assert.equal(screenshot["min-width"], "0");
  assert.equal(screenshot["max-width"], "100%");
  assert.equal(screenshot.overflow, "hidden");
  assert.equal(screenshot.background, "var(--media-surface)");
  assert.equal(screenshot["box-sizing"], "border-box");
  assert.equal(screenshot.padding, "clamp(12px,1.8vw,20px)");

  for (const selector of [".product-media img", ".product-icon", ".detail-logo", ".detail-banner", ".screenshots img"]) {
    assert.notEqual(declarations(selector)["object-fit"].replace("!important", ""), "cover", `${selector} não pode recortar mídia comercial`);
  }
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /@media\(max-width:560px\)/);
});

test("padding interno preserva uma área útil responsiva sem estourar as mídias", () => {
  for (const [boxWidth, boxHeight, padding] of [[320, 200, 24], [280, 158, 20], [240, 150, 14]]) {
    const innerWidth = boxWidth - padding * 2;
    const innerHeight = boxHeight - padding * 2;
    assert.ok(innerWidth > 0 && innerHeight > 0);

    const result = containedSize(1920, 1080, innerWidth, innerHeight);
    assert.ok(result.width + padding * 2 <= boxWidth);
    assert.ok(result.height + padding * 2 <= boxHeight);
    assert.ok(result.offsetX >= 0 && result.offsetY >= 0);
  }
});

test("contain preserva proporção e mantém formatos extremos dentro do quadro", () => {
  for (const [width, height] of [[600, 1200], [1920, 400], [1000, 1000], [200, 100]]) {
    const result = containedSize(width, height, 320, 180);
    assert.ok(result.width <= 320 && result.height <= 180);
    assert.ok(result.offsetX >= 0 && result.offsetY >= 0);
    assert.ok(Math.abs(result.width / result.height - width / height) < Number.EPSILON * 10);
  }
});
