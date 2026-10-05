# GuiaSys Licensing

Central universal de licenciamento multi-projeto da GuiaSys Studio.

## Estado

**Painel:** v0.14.0  
**API:** v2.0.0  
**Protocolo público:** GSL-v1  
**Runtime alvo:** Firebase Hosting + Firebase Functions v2

A aplicação possui autenticação administrativa, multi-projeto, planos, clientes, licenças, trial centralizado, dispositivos, ativações, auditoria, RBAC, catálogo público opcional, integração universal e entitlement offline ES256.

## Arquitetura

```text
Navegador / Aplicativo integrado
        |
        | HTTPS — mesmo domínio no painel
        v
Firebase Hosting
        |
        | /api/** e /health
        v
Firebase Functions v2 — licensingApi
        |
        | Firebase Admin SDK
        v
Firebase Auth + Cloud Firestore
```

- Projeto Firebase: `guiasys-licensing`
- Function: `licensingApi`
- Região: `southamerica-east1`
- Node.js: 22
- Domínio oficial planejado/operacional: `https://licencas.guiasys.online`
- Protocolo dos clientes: `GSL-v1`

O navegador nunca recebe credencial administrativa do Firestore. As Security Rules continuam deny-all para clientes e toda operação privilegiada passa pela Function.

## Firebase Hosting

O Hosting **não publica a raiz do repositório**. Antes de cada deploy:

1. `scripts/prepare-hosting.mjs` recria `.hosting-dist/`;
2. somente `index.html` e `assets/` são copiados;
3. `scripts/verify-hosting-dist.mjs` bloqueia qualquer arquivo fora dessa allowlist.

Rewrites versionados:

- `/api/** -> licensingApi`
- `/health -> licensingApi`

Os rewrites usam `pinTag: true` para manter a Function v2 alinhada ao release do Hosting.

## Backend

Código principal:

```text
worker/src/index.js
worker/src/firebase-entry.js
worker/src/firebase-runtime.js
```

O diretório ainda se chama `worker/` por compatibilidade histórica, mas o runtime principal é Firebase Functions v2.

O backend Firebase usa:

- `firebase-admin` para Auth e Firestore;
- credenciais nativas da service account da Function;
- `ADMIN_FIREBASE_UID` via Secret Manager;
- transações nativas do Firestore;
- request IDs e logs estruturados.

`FIREBASE_SERVICE_ACCOUNT_JSON` não faz parte do runtime Firebase.

## Cloudflare legado

`worker/wrangler.jsonc` permanece temporariamente no repositório somente para rollback controlado durante a migração. O frontend não possui mais URL `workers.dev` hardcoded e o `CNAME` do GitHub Pages foi removido.

## Frontend

O frontend fonte permanece em:

```text
index.html
assets/
```

Em runtime, a API base é:

```js
window.location.origin
```

Assim, o painel usa o mesmo domínio do Hosting e os rewrites encaminham a API sem dependência direta do endpoint da Function ou do Worker legado.

## Isolamento de projeto

```text
projects/{projectId}
├── plans
├── customers
├── licenses
├── licenseKeys
├── trials
├── devices
├── activations
├── logs
└── internal/signing

integrationCodes/{sha256(integrationCode)}
rateLimits/{sha256(client|bucket)}
```

## API pública GSL-v1

- `GET /api/v1/catalog`
- `POST /api/v1/project/config`
- `POST /api/v1/trial/start`
- `POST /api/v1/trial/validate`
- `POST /api/v1/license/activate`
- `POST /api/v1/license/validate`
- `POST /api/v1/license/deactivate`

O cliente integrado deve preferir o Código de Integração permanente do projeto. O `projectId` continua aceito onde documentado por compatibilidade.

## Segurança

- Firestore e Storage deny-all para acesso direto de clientes.
- Firebase ID Token validado no backend com revogação.
- Master UID mantido no Secret Manager.
- License keys geradas com CSPRNG.
- Keys e Device IDs persistidos/consultados por SHA-256 conforme o domínio.
- Entitlements offline assinados com ES256.
- Chave privada de assinatura permanece em armazenamento interno.
- Rate limiting transacional nos endpoints públicos.
- CORS/origens Web por projeto.
- Hosting com headers de hardening e staging allowlist.
- `npm audit --omit=dev --audit-level=moderate` no CI.
- `X-Request-Id` nas respostas da API.

## Validação

Backend:

```bash
cd worker
npm install
npm audit --omit=dev --audit-level=moderate
npm test
npm run check
```

Hosting:

```bash
node scripts/prepare-hosting.mjs
node scripts/verify-hosting-dist.mjs
node scripts/verify-firebase-config.mjs
```

Emuladores:

```bash
firebase emulators:start --only functions,hosting,firestore,storage --project guiasys-licensing
```

## Deploy C11

Antes do primeiro deploy ao vivo:

1. confirmar o projeto `guiasys-licensing`;
2. confirmar/criar o secret `ADMIN_FIREBASE_UID`;
3. executar todos os gates;
4. publicar Functions + Hosting;
5. validar `/health` e login;
6. conectar `licencas.guiasys.online` ao Firebase Hosting;
7. manter o Worker antigo disponível somente durante a janela de rollback.

Com Firebase CLI autenticada:

```bash
firebase deploy --only functions:licensing,hosting --project guiasys-licensing
```

O domínio customizado e os registros DNS são configuração externa ao repositório. Não altere DNS antes de a URL `*.web.app` passar no smoke test.

## Rollback

Hosting possui rollback de releases pelo Firebase Console. Durante a migração C11, o endpoint Cloudflare legado pode ser mantido disponível como contingência, mas não deve voltar a ser hardcoded no frontend.
