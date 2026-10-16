import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { manualPixWhatsappUrl } from "../src/payments/manual-pix.js";

const [html, catalog, css, admin] = await Promise.all([
  readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../../public/assets/catalog.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/assets/catalog.css", import.meta.url), "utf8"),
  readFile(new URL("../../assets/js/app.js", import.meta.url), "utf8")
]);

test("portal público apresenta linguagem comercial sem referências internas", () => {
  const visibleSource = `${html}\n${catalog}`;
  assert.doesNotMatch(visibleSource, /GSL-v1|protocolVersion|integrationCode|sandbox|homologa(?:ção|cao)|debug|\bstaging\b|auditoria|\bmock\b|\bdemo\b/i);
  assert.doesNotMatch(visibleSource, /["'`]Teste\b/i);
  assert.match(catalog, /Licenças oficiais para seus softwares GuiaSys/);
  assert.match(catalog, /Compre, acompanhe e gerencie suas licenças GuiaSys em um só lugar/);
  assert.match(catalog, /Licenciamento oficial/);
  assert.match(catalog, /Gestão simples/);
  assert.match(catalog, /Suporte humano/);
  assert.match(catalog, /Sua licença em três passos/);
  assert.match(catalog, /Escolha seu programa/);
  assert.match(catalog, /Finalize sua compra/);
  assert.match(catalog, /Receba sua licença/);
});

test("rodapé contém somente identidade, links reais e direitos autorais", () => {
  assert.match(html, /Compre e gerencie suas licenças oficiais GuiaSys em um só lugar/);
  for (const href of ["/programas", "/conta/perfil", "/termos", "/privacidade", "mailto:suporte@guiasys.com.br"]) {
    assert.match(html, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.match(html, /GuiaSys\. Todos os direitos reservados/);
  assert.doesNotMatch(html, /protocolo|GSL-v1|debug|homologa(?:ção|cao)/i);
});

test("catálogo e checkout preservam as ações comerciais validadas", () => {
  for (const copy of ["Ver programa", "Adicionar ao carrinho", "Comprar agora", "Finalizar com PIX", "Copiar código PIX", "Já efetuei o pagamento"]) {
    assert.match(catalog, new RegExp(copy));
  }
  assert.match(catalog, /Preço e disponibilidade/);
  assert.doesNotMatch(catalog, /price-from/);
});

test("badge de licença envolve o conteúdo sem esticar", () => {
  const statusRule = css.match(/\.status\{([^}]*)\}/)?.[1] || "";
  assert.match(statusRule, /display:inline-flex/);
  assert.match(statusRule, /align-self:flex-start/);
  assert.match(statusRule, /width:max-content/);
  assert.match(statusRule, /min-height:24px/);
  assert.match(statusRule, /line-height:1\.15/);
});

test("layout permanece contido nas larguras de produção solicitadas", () => {
  const viewports = [320, 360, 375, 390, 412, 430, 600, 768, 820, 1024, 1280, 1366, 1440, 1920];
  for (const width of viewports) {
    const gutter = width <= 560 ? 12 : Math.min(64, Math.max(24, width * 0.03125));
    const content = Math.min(1480, width - gutter * 2);
    assert.ok(content > 0 && content <= width, `${width}px mantém o conteúdo dentro da viewport`);
  }
  assert.match(css, /@media\(max-width:820px\).*\.hero,.detail-hero,.cart-layout,.account-shell\{grid-template-columns:1fr\}/s);
  assert.match(css, /@media\(max-width:560px\).*\.hero-actions>\*\{width:100%\}/s);
  assert.match(css, /body\{[^}]*overflow-x:clip/);
});

test("WhatsApp de comprovante é curto, formatado e não inclui nome do cliente", () => {
  const url = new URL(manualPixWhatsappUrl({
    whatsapp: "5511999999999",
    orderNumber: "GS-000000",
    customerName: "Nome que não deve aparecer",
    productName: "GuiaPlay",
    planName: "Semanal",
    totalFormatted: "R$ 20,00"
  }));
  const message = url.searchParams.get("text");
  assert.match(message, /^Olá! 👋/);
  assert.match(message, /pedido \*GS-000000\*\./);
  assert.match(message, /\*Produto:\* GuiaPlay/);
  assert.match(message, /\*Plano:\* Semanal/);
  assert.match(message, /\*Valor:\* R\$ 20,00/);
  assert.doesNotMatch(message, /Nome que não deve aparecer|Cliente:/);
});

test("confirmação administrativa orienta para a conta oficial", () => {
  assert.match(admin, /✅ \*Pagamento confirmado\*/);
  assert.match(admin, /\*Minha conta → Compras e licenças\*/);
  assert.match(admin, /https:\/\/licencas\.guiasys\.com\.br\/conta\/compras/);
  assert.match(admin, /visualizar e copiar sua chave de licença/);
});
