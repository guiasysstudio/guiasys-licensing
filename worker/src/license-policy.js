export const LICENSE_STATUSES = Object.freeze([
  "pending",
  "active",
  "suspended",
  "expired",
  "revoked"
]);

function apiError(message, status = 409, reason = "invalid_license_transition", details = null) {
  throw Object.assign(new Error(message), {
    status,
    reason,
    ...(details ? { details } : {})
  });
}

function millis(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : NaN;
}

export function effectiveLicenseStatus(license, now = new Date().toISOString()) {
  const status = LICENSE_STATUSES.includes(license?.status) ? license.status : "pending";
  if (status === "active" && license?.expiresAt) {
    const expires = millis(license.expiresAt);
    const current = millis(now);
    if (Number.isFinite(expires) && Number.isFinite(current) && expires <= current) {
      return "expired";
    }
  }
  return status;
}

export function totalActivationDays(license) {
  if (license?.lifetime) return 0;
  return Math.max(1, Number(license?.durationDays || 0)) +
    Math.max(0, Number(license?.renewalDaysTotal || 0));
}

export function assertLicenseCanActivate(license, now = new Date().toISOString()) {
  const status = effectiveLicenseStatus(license, now);
  if (status === "revoked") {
    apiError("Licença revogada.", 403, "revoked");
  }
  if (status === "suspended") {
    apiError("Licença suspensa.", 403, "suspended");
  }
  if (status === "expired") {
    apiError("Licença expirada.", 403, "expired");
  }
  if (!["pending", "active"].includes(status)) {
    apiError("Estado da licença não permite ativação.");
  }
  return status;
}

export function transitionLicense(current, action, body = {}, now = new Date().toISOString(), plusDays) {
  if (!current) apiError("Licença não encontrada.", 404, "license_not_found");
  if (typeof plusDays !== "function") throw new TypeError("plusDays é obrigatório.");

  const status = effectiveLicenseStatus(current, now);
  let next = { ...current, status, updatedAt: now };

  if (action === "revoke") {
    if (status === "revoked") {
      return { changed: false, license: next, event: "license.revoke.noop" };
    }

    next.status = "revoked";
    next.revokedAt = now;
    next.revocationReason = String(body.reason || "").trim();
    return { changed: true, license: next, event: "license.revoke" };
  }

  if (action === "suspend") {
    if (status === "revoked") {
      apiError("Licença revogada é um estado terminal.", 409, "license_revoked_terminal");
    }
    if (status === "expired") {
      apiError("Licença expirada deve ser renovada antes de ser suspensa.", 409, "license_expired");
    }
    if (status === "suspended") {
      return { changed: false, license: next, event: "license.suspend.noop" };
    }
    if (!["pending", "active"].includes(status)) {
      apiError("A licença não pode ser suspensa neste estado.");
    }

    next.statusBeforeSuspend = status;
    next.status = "suspended";
    next.suspendedAt = now;
    return { changed: true, license: next, event: "license.suspend" };
  }

  if (action === "reactivate") {
    if (status === "revoked") {
      apiError("Licença revogada é um estado terminal.", 409, "license_revoked_terminal");
    }
    if (status !== "suspended") {
      apiError("Somente uma licença suspensa pode ser reativada.", 409, "license_not_suspended");
    }

    const previous = current.statusBeforeSuspend === "pending" || !current.activatedAt
      ? "pending"
      : "active";

    if (previous === "active" && current.expiresAt) {
      const expires = millis(current.expiresAt);
      const currentTime = millis(now);
      if (Number.isFinite(expires) && Number.isFinite(currentTime) && expires <= currentTime) {
        apiError("A licença expirou enquanto estava suspensa. Renove antes de reativar.", 409, "license_expired");
      }
    }

    next.status = previous;
    next.statusBeforeSuspend = null;
    next.suspendedAt = null;
    return { changed: true, license: next, event: "license.reactivate" };
  }

  if (action === "renew") {
    if (status === "revoked") {
      apiError("Licença revogada é um estado terminal e não pode ser renovada.", 409, "license_revoked_terminal");
    }

    const makeLifetime = body.lifetime === true;
    const days = body.days == null ? 0 : Number(body.days);

    if (!makeLifetime && (!Number.isInteger(days) || days < 1)) {
      apiError("Informe days ou lifetime=true para renovar.", 400, "invalid_renewal");
    }

    if (current.lifetime) {
      if (!makeLifetime) {
        apiError("Licença vitalícia não pode ser convertida novamente em temporária.", 409, "lifetime_immutable");
      }
      return { changed: false, license: next, event: "license.renew.noop" };
    }

    next.renewalCount = Math.max(0, Number(current.renewalCount || 0)) + 1;
    next.lastRenewedAt = now;

    if (makeLifetime) {
      next.lifetime = true;
      next.expiresAt = null;
      if (status === "expired") next.status = current.activatedAt ? "active" : "pending";
      return { changed: true, license: next, event: "license.renew" };
    }

    next.renewalDaysTotal = Math.max(0, Number(current.renewalDaysTotal || 0)) + days;

    if (!current.activatedAt) {
      next.expiresAt = null;
      if (status === "expired") next.status = "pending";
      return { changed: true, license: next, event: "license.renew" };
    }

    const expires = millis(current.expiresAt);
    const currentTime = millis(now);
    const base = Number.isFinite(expires) && Number.isFinite(currentTime) && expires > currentTime
      ? current.expiresAt
      : now;

    next.expiresAt = plusDays(base, days);
    if (status === "expired") next.status = "active";
    return { changed: true, license: next, event: "license.renew" };
  }

  apiError("Ação de licença inválida.", 400, "invalid_license_action");
}
