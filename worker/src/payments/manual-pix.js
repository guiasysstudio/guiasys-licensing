import { createHash } from "node:crypto";

import QRCode from "qrcode";

export const MANUAL_PIX_PROVIDER = "manual_pix";

export const DEFAULT_PAYMENT_SETTINGS = Object.freeze({
  paymentProvider: MANUAL_PIX_PROVIDER,
  pixEnabled: true,
  pixKeyType: "EVP",
  pixKey: "821fee6e-dbdd-46ea-adfc-8afffc89d422",
  pixDisplayName: "GuiaSys",
  pixMerchantName: "Andrew Lindolfo",
  pixMerchantCity: "JI PARANA",
  pixWhatsapp: "5569993082084",
  manualConfirmationEnabled: true
});

function settingsError(message, reason = "invalid_payment_settings") {
  throw Object.assign(new Error(message), { status: 400, reason });
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    settingsError("Configuração de pagamento inválida.");
  }
  return value;
}

function requiredString(value, field, max) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) settingsError(`O campo ${field} é inválido.`);
  return text;
}

function requiredBoolean(value, field) {
  if (typeof value !== "boolean") settingsError(`O campo ${field} deve ser booleano.`);
  return value;
}

export function normalizePixText(value, maxLength) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 $%*+\-./:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function validatePaymentSettings(input) {
  const source = plainObject(input);
  const allowed = new Set(Object.keys(DEFAULT_PAYMENT_SETTINGS));
  const unknown = Object.keys(source).filter(key => !allowed.has(key));
  if (unknown.length) settingsError("Campos desconhecidos na configuração de pagamento.", "invalid_payload");

  const paymentProvider = requiredString(source.paymentProvider, "paymentProvider", 32);
  if (paymentProvider !== MANUAL_PIX_PROVIDER) {
    settingsError("O provider PagBank está congelado; use manual_pix.", "payment_provider_disabled");
  }
  const pixKeyType = requiredString(source.pixKeyType, "pixKeyType", 16).toUpperCase();
  if (pixKeyType !== "EVP") settingsError("Somente chave PIX EVP está habilitada nesta versão.");
  const pixKey = requiredString(source.pixKey, "pixKey", 77).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pixKey)) {
    settingsError("A chave PIX EVP deve ser um UUID válido.");
  }
  const pixMerchantName = requiredString(source.pixMerchantName, "pixMerchantName", 25);
  const pixMerchantCity = requiredString(source.pixMerchantCity, "pixMerchantCity", 15);
  if (!normalizePixText(pixMerchantName, 25) || !normalizePixText(pixMerchantCity, 15)) {
    settingsError("Nome e cidade PIX são obrigatórios.");
  }
  const pixWhatsapp = String(source.pixWhatsapp ?? "").replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(pixWhatsapp)) settingsError("O WhatsApp deve usar o formato 55DDDNUMERO.");

  return {
    paymentProvider,
    pixEnabled: requiredBoolean(source.pixEnabled, "pixEnabled"),
    pixKeyType,
    pixKey,
    pixDisplayName: requiredString(source.pixDisplayName, "pixDisplayName", 80),
    pixMerchantName,
    pixMerchantCity,
    pixWhatsapp,
    manualConfirmationEnabled: requiredBoolean(source.manualConfirmationEnabled, "manualConfirmationEnabled")
  };
}

export function publicPaymentSettings(settings) {
  const validated = validatePaymentSettings(settings);
  return {
    paymentProvider: validated.paymentProvider,
    pixEnabled: validated.pixEnabled,
    pixKeyType: validated.pixKeyType,
    pixKey: validated.pixKey,
    pixDisplayName: validated.pixDisplayName,
    pixMerchantName: validated.pixMerchantName,
    pixMerchantCity: validated.pixMerchantCity,
    pixWhatsapp: validated.pixWhatsapp,
    manualConfirmationEnabled: validated.manualConfirmationEnabled
  };
}

function tlv(id, value) {
  const text = String(value);
  const length = Buffer.byteLength(text, "utf8");
  if (length > 99) throw new RangeError(`Campo BR Code ${id} excede 99 bytes.`);
  return `${id}${String(length).padStart(2, "0")}${text}`;
}

export function pixCrc16(value) {
  const bytes = Buffer.from(String(value), "utf8");
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function pixTxidForOrder(orderId) {
  const digest = createHash("sha256").update(String(orderId || "")).digest("hex").toUpperCase();
  return `GS${digest.slice(0, 23)}`;
}

export function buildPixPayload({ pixKey, pixMerchantName, pixMerchantCity, amountCents, txid }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw Object.assign(new Error("O valor PIX deve ser positivo e expresso em centavos."), {
      status: 409,
      reason: "invalid_pix_amount"
    });
  }
  const key = String(pixKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    settingsError("Chave PIX EVP inválida.");
  }
  const safeTxid = String(txid || "").toUpperCase();
  if (!/^[A-Z0-9]{1,35}$/.test(safeTxid)) {
    throw Object.assign(new Error("TXID PIX inválido."), { status: 409, reason: "invalid_pix_txid" });
  }

  const merchantAccount = tlv("00", "br.gov.bcb.pix") + tlv("01", key);
  const additionalData = tlv("05", safeTxid);
  const amount = (amountCents / 100).toFixed(2);
  const withoutCrc = [
    tlv("00", "01"),
    tlv("26", merchantAccount),
    tlv("52", "0000"),
    tlv("53", "986"),
    tlv("54", amount),
    tlv("58", "BR"),
    tlv("59", normalizePixText(pixMerchantName, 25)),
    tlv("60", normalizePixText(pixMerchantCity, 15)),
    tlv("62", additionalData),
    "6304"
  ].join("");
  return `${withoutCrc}${pixCrc16(withoutCrc)}`;
}

export async function buildManualPixPresentation({ settings, order, qrCodeFactory = QRCode.toDataURL }) {
  const validated = validatePaymentSettings(settings);
  if (!validated.pixEnabled) {
    throw Object.assign(new Error("Pagamento PIX está temporariamente indisponível."), {
      status: 503,
      reason: "manual_pix_disabled"
    });
  }
  const txid = order.pixTxid || pixTxidForOrder(order.orderId);
  const pixCode = buildPixPayload({
    pixKey: validated.pixKey,
    pixMerchantName: validated.pixMerchantName,
    pixMerchantCity: validated.pixMerchantCity,
    amountCents: order.totalCents,
    txid
  });
  const pixQrCodeDataUrl = await qrCodeFactory(pixCode, {
    type: "image/png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320
  });
  return {
    txid,
    pixCode,
    pixQrCodeDataUrl,
    pixKey: validated.pixKey,
    pixKeyType: validated.pixKeyType,
    pixDisplayName: validated.pixDisplayName,
    pixMerchantName: validated.pixMerchantName,
    pixMerchantCity: validated.pixMerchantCity,
    pixWhatsapp: validated.pixWhatsapp,
    manualConfirmationEnabled: validated.manualConfirmationEnabled
  };
}

export function manualPixWhatsappUrl({ whatsapp, orderNumber, customerName, productName, planName, totalFormatted }) {
  const number = String(whatsapp || "").replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(number)) settingsError("WhatsApp PIX inválido.");
  const message = [
    `Olá! Efetuei o pagamento via PIX do pedido ${orderNumber} no GuiaSys Licensing.`,
    "",
    `Cliente: ${customerName}`,
    `Produto: ${productName}`,
    `Plano: ${planName}`,
    `Valor: ${totalFormatted}`,
    "",
    "Estou enviando o comprovante de pagamento nesta conversa.",
    "",
    "Por favor, confirme o recebimento e libere minha licença."
  ].join("\n");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
