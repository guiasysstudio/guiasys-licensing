import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function remoteImageError(message, status = 400, reason = "invalid_image_url") {
  return Object.assign(new Error(message), { status, reason });
}

function ipv4Parts(address) {
  const parts = String(address).split(".").map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPublicIpv4(address) {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expandIpv6(address) {
  let raw = String(address).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (raw.includes(".")) {
    const lastColon = raw.lastIndexOf(":");
    const v4 = ipv4Parts(raw.slice(lastColon + 1));
    if (!v4) return null;
    raw = `${raw.slice(0, lastColon)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map(group => Number.parseInt(group, 16));
}

function isPublicIpv6(address) {
  const groups = expandIpv6(address);
  if (!groups) return false;
  const [first, second, third] = groups;
  if (first < 0x2000 || first > 0x3fff) return false;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && [0x0000, 0x0001, 0x0002, 0x0010, 0x0db8].includes(second)) return false;
  if (first === 0x2002) return false;
  if (first === 0x0064 && second === 0xff9b && third === 0) return false;
  return true;
}

export function isPublicInternetAddress(address) {
  const family = isIP(String(address).replace(/^\[|\]$/g, ""));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function resolvePublicImageUrl(value, lookupImpl = dnsLookup) {
  const raw = String(value || "");
  if (!raw || raw.length > 2048) {
    throw remoteImageError("A URL da imagem é inválida.");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw remoteImageError("A URL da imagem é inválida.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw remoteImageError("A imagem deve usar HTTPS, sem credenciais e na porta padrão.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw remoteImageError("O endereço da imagem não é público.");
  }

  let addresses;
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await lookupImpl(hostname, { all: true, verbatim: true });
    } catch (error) {
      throw Object.assign(remoteImageError("Não foi possível resolver o endereço da imagem.", 502, "image_download_failed"), { cause: error });
    }
  }
  if (!addresses.length || addresses.some(item => !isPublicInternetAddress(item.address))) {
    throw remoteImageError("O endereço da imagem não é público.");
  }

  return { url, address: addresses[0].address, family: addresses[0].family };
}

function contentTypeFrom(response) {
  return String(response.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
}

function hasValidSignature(bytes, contentType) {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

async function requestImage(resolved, { maxBytes, timeoutMs, requestImpl }) {
  return await new Promise((resolve, reject) => {
    const request = requestImpl({
      protocol: "https:",
      hostname: resolved.address,
      family: resolved.family,
      port: 443,
      method: "GET",
      path: `${resolved.url.pathname}${resolved.url.search}`,
      servername: resolved.url.hostname,
      headers: {
        Host: resolved.url.host,
        Accept: "image/jpeg, image/png, image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": "GuiaSys-Licensing/2.1"
      }
    }, response => {
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        reject(remoteImageError("A imagem excede o tamanho permitido.", 413, "payload_too_large"));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on("data", chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy(remoteImageError("A imagem excede o tamanho permitido.", 413, "payload_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ response, bytes: Buffer.concat(chunks, total) }));
      response.on("error", reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(remoteImageError("O download da imagem excedeu o tempo limite.", 504, "image_download_timeout")));
    request.on("error", reject);
    request.end();
  });
}

export async function downloadRemoteImage(value, {
  maxBytes = 5 * 1024 * 1024,
  timeoutMs = 8_000,
  maxRedirects = 3,
  lookupImpl = dnsLookup,
  requestImpl = httpsRequest
} = {}) {
  let current = String(value || "");
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const resolved = await resolvePublicImageUrl(current, lookupImpl);
    let result;
    try {
      result = await requestImage(resolved, { maxBytes, timeoutMs, requestImpl });
    } catch (error) {
      if (error?.status) throw error;
      throw Object.assign(remoteImageError("Não foi possível baixar a imagem.", 502, "image_download_failed"), { cause: error });
    }
    const { response, bytes } = result;
    if (REDIRECT_STATUSES.has(response.statusCode)) {
      if (redirectCount === maxRedirects || !response.headers.location) {
        throw remoteImageError("A URL da imagem excedeu o limite de redirecionamentos.", 400, "image_redirect_limit");
      }
      current = new URL(response.headers.location, resolved.url).href;
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw remoteImageError("A origem da imagem recusou o download.", 502, "image_download_failed");
    }
    const contentType = contentTypeFrom(response);
    if (!ALLOWED_IMAGE_TYPES.has(contentType) || !hasValidSignature(bytes, contentType)) {
      throw remoteImageError("A origem não retornou uma imagem JPG, PNG ou WebP válida.", 400, "invalid_media_type");
    }
    if (!bytes.length) throw remoteImageError("A imagem recebida está vazia.", 400, "invalid_media_type");
    return {
      bytes,
      contentType,
      extension: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[contentType]
    };
  }
  throw remoteImageError("A URL da imagem excedeu o limite de redirecionamentos.", 400, "image_redirect_limit");
}
