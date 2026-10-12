import { isIP } from "node:net";

// The Google ingress appends peer information to X-Forwarded-For.
// Earlier entries can be provided by the client or by other proxies.
// The last IP is the only candidate we use for this coarse ingress bucket.
// NOTE: it can represent Firebase Hosting/CDN, not the original user.
export function rateLimitIngressPeer(headers) {
  const forwarded = String(headers.get("X-Forwarded-For") || "");
  if (!forwarded || forwarded.length > 2048) return "unattributed";

  const lastHop = forwarded.slice(forwarded.lastIndexOf(",") + 1).trim();
  // Do not fall back to an unverified earlier entry or CF-Connecting-IP.
  if (isIP(lastHop) === 0) return "unattributed";
  return lastHop.toLowerCase();
}
