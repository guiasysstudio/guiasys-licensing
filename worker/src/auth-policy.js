export const ADMIN_SIGN_IN_PROVIDERS = Object.freeze(["google.com", "password"]);

function authError(message, reason = "invalid_token", status = 401) {
  throw Object.assign(new Error(message), { status, reason });
}

export function parseCacheMaxAge(cacheControl, fallbackSeconds = 300) {
  const match = String(cacheControl || "").match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i);
  const parsed = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallbackSeconds;
  return Math.min(parsed, 86400);
}

export function validateFirebaseClaims(payload, projectId, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || typeof payload !== "object") authError("Payload Firebase inválido.");
  if (payload.aud !== projectId) authError("Token destinado a outro projeto Firebase.");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    authError("Emissor do token Firebase inválido.");
  }
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) {
    authError("UID ausente ou inválido no token Firebase.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    authError("Token Firebase expirado.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSeconds) {
    authError("Data de emissão do token inválida.");
  }
  if (typeof payload.auth_time !== "number" || payload.auth_time > nowSeconds) {
    authError("Data de autenticação do token inválida.");
  }

  const provider = String(payload.firebase?.sign_in_provider || "");
  if (!ADMIN_SIGN_IN_PROVIDERS.includes(provider)) {
    authError("Provedor de autenticação não permitido para o painel.", "provider_not_allowed", 403);
  }

  return {
    uid: payload.sub,
    authTime: payload.auth_time,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    signInProvider: provider
  };
}

export function assertAccountTokenStillValid(account, tokenPayload) {
  if (!account || account.localId !== tokenPayload.sub) {
    authError("Conta Firebase não encontrada.", "firebase_account_not_found", 401);
  }
  if (account.disabled === true) {
    authError("Conta Firebase desativada.", "firebase_account_disabled", 401);
  }

  const validSince = Number(account.validSince || 0);
  if (Number.isFinite(validSince) && validSince > 0 && Number(tokenPayload.iat || 0) < validSince) {
    authError("Sessão Firebase revogada.", "firebase_token_revoked", 401);
  }

  return true;
}

export function assertRecentAuthentication(admin, maxAgeSeconds = 15 * 60, nowSeconds = Math.floor(Date.now() / 1000)) {
  const authTime = Number(admin?.authTime);
  if (!Number.isFinite(authTime) || nowSeconds - authTime > maxAgeSeconds || authTime > nowSeconds) {
    authError(
      "Esta ação exige autenticação recente. Saia e entre novamente antes de continuar.",
      "recent_auth_required",
      403
    );
  }
  return true;
}
