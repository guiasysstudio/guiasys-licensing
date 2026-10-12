// Suporte puro ao gerador GSL-v1: dados públicos e exemplos ilustrativos.
// Não contém autenticação, chave privada ou lógica de liberação de licenças.
export function normalizePublicSigningJwk(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" || !jwk.x ||
      typeof jwk.y !== "string" || !jwk.y) return null;
  return {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    ext: true,
    key_ops: ["verify"]
  };
}

export function integrationResponseExamples(project, protocol = "GSL-v1") {
  const common = {
    protocolVersion: protocol,
    projectId: project.id,
    integrationCode: project.integrationCode
  };
  const entitlement = {
    format: "JWS",
    algorithm: "ES256",
    keyId: project.signingKeyId || "<KEY_ID_DO_SERVIDOR>",
    token: "<HEADER.PAYLOAD.ASSINATURA_ES256>"
  };
  // Apenas exemplos de estrutura: nenhum prazo, plano ou token é operativo.
  const now = "2030-01-01T00:00:00.000Z";
  const trial = {
    ...common,
    valid: true,
    type: "trial",
    status: "active",
    startedAt: now,
    expiresAt: "2030-01-08T00:00:00.000Z",
    durationDays: 7,
    remainingSeconds: 604800,
    validationHours: Number(project.trialValidationHours || project.validationHours || 24),
    offlineHours: Number(project.trialOfflineHours ?? project.trialValidationHours ?? project.validationHours ?? 24),
    serverTime: now,
    offlineUntil: "2030-01-03T00:00:00.000Z",
    entitlement
  };
  const license = {
    ...common,
    valid: true,
    type: "license",
    licenseId: "<LICENSE_ID>",
    status: "active",
    customerName: "<NOME_DO_CLIENTE>",
    customerEmail: "<EMAIL_DO_CLIENTE>",
    planName: "<NOME_DO_PLANO>",
    issuedAt: "2029-12-31T00:00:00.000Z",
    activatedAt: now,
    expiresAt: "2030-01-31T00:00:00.000Z",
    startMode: "first_activation",
    durationDays: 30,
    lifetime: false,
    maxDevices: 1,
    validationHours: Number(project.validationHours || 24),
    offlineDays: Number(project.offlineDays || 0),
    serverTime: now,
    offlineUntil: "2030-01-03T00:00:00.000Z",
    entitlement
  };
  const config = {
    ...common,
    name: project.name,
    prefix: project.prefix,
    signing: {
      algorithm: "ES256",
      keyId: project.signingKeyId || "<KEY_ID_DO_SERVIDOR>",
      publicJwk: normalizePublicSigningJwk(project.signingPublicJwk) || "<PUBLIC_JWK_DE_PROJECT_CONFIG>"
    },
    trial: {
      enabled: Boolean(project.trialEnabled && Number(project.trialDays || 0) > 0),
      days: Number(project.trialDays || 0),
      validationHours: trial.validationHours,
      offlineHours: trial.offlineHours,
      deviceIdentity: "stable_installation_id",
      restartPolicy: "same_project_device_hash_never_restarts",
      requestIdSupported: true
    },
    license: {
      validationHours: license.validationHours,
      offlineDays: license.offlineDays
    },
    serverTime: now
  };
  const samples = [
    ["HTTP 200 — /api/v1/project/config", { ok: true, project: config }],
    ["HTTP 200 — /api/v1/trial/start", { ok: true, trial: { ...trial, firstStart: true } }],
    ["HTTP 200 — /api/v1/trial/validate", { ok: true, trial: { ...trial, revalidationReplay: false, validationCount: 1 } }],
    ["HTTP 200 — /api/v1/license/activate", {
      ok: true, license: { ...license, activeDevices: 1, activationPerformed: true, alreadyActive: false }
    }],
    ["HTTP 200 — /api/v1/license/validate", {
      ok: true, license: { ...license, revalidationReplay: false, validationCount: 1 }
    }],
    ["HTTP 200 — /api/v1/license/deactivate", {
      ok: true,
      result: {
        protocolVersion: protocol,
        ok: true,
        deactivated: true,
        alreadyInactive: false,
        serverTime: now
      }
    }],
    ["HTTP 409 — limite de dispositivos", {
      ok: false, error: "device_limit", message: "<MENSAGEM_VARIAVEL_DO_SERVIDOR>"
    }],
    ["HTTP 429 — limite de requisições", {
      ok: false, error: "rate_limited", message: "<MENSAGEM_VARIAVEL_DO_SERVIDOR>",
      details: { retryAfterSeconds: 120 }
    }]
  ];
  return [
    "EXEMPLOS ILUSTRATIVOS DE RESPOSTAS HTTP — NÃO SÃO DADOS OPERACIONAIS",
    "Datas, duração de planos e de trial, dispositivos e JWS abaixo são fictícios.",
    "A API retorna envelopes ok/project, ok/trial, ok/license, ok/result ou ok:false/error.",
    "Não use os valores abaixo para conceder acesso; consulte e valide a resposta real.",
    "",
    ...samples.flatMap(([title, response]) => [
      title,
      JSON.stringify(response, null, 2),
      ""
    ]),
    "O campo entitlement.token representa um JWS compactado real nas respostas online;",
    "o placeholder acima NÃO é um token válido nem uma autorização de uso.",
    "O endpoint de desativação retorna result, não license nem entitlement.",
    "Em licença vitalícia lifetime=true, expiresAt=null, mas offlineUntil continua obrigatório.",
    "A janela offline verdadeira é definida pelo token emitido, nunca pelo modelo ilustrativo.",
    "O servidor também retorna X-Request-Id no cabeçalho HTTP para correlação de logs."
  ].join("\n");
}
