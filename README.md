# GuiaSys Licensing

Central universal de licenciamento multi-projeto da GuiaSys Studio.

## Estado

**Painel:** v0.16.0

**API:** v2.1.0

**Protocolo público:** GSL-v1  
**Runtime alvo:** Firebase Hosting + Firebase Functions v2

A aplicação possui autenticação administrativa, multi-projeto, planos, clientes, licenças, trial centralizado, dispositivos, ativações, auditoria, RBAC, catálogo comercial dinâmico, integração universal e entitlement offline ES256.

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
- Portal público reservado: `https://licencas.guiasys.online`
- Painel administrativo: `https://painel.licencas.guiasys.online`
- Hosting admin Firebase: `https://guiasys-licensing-admin.web.app`
- Protocolo dos clientes: `GSL-v1`

O navegador nunca recebe credencial administrativa do Firestore. As Security Rules continuam deny-all para clientes e toda operação privilegiada passa pela Function.

## Firebase Hosting

O projeto usa arquitetura multi-site:

- target `public` -> site `guiasys-licensing`, catálogo público e gateway da API GSL-v1 em `licencas.guiasys.online`;
- target `admin` -> site `guiasys-licensing-admin`, dedicado ao painel administrativo em `painel.licencas.guiasys.online`.

O target `public` publica somente o frontend comercial em `public/`. Ele consome `GET /api/v1/catalog` pelo mesmo origin, mantém os rewrites `/api/**` e `/health` e nunca inclui os assets do painel administrativo.

O C13 não implementa checkout, pedido, pagamento, webhook ou emissão automática. O CTA apenas conserva `projectId` e `planId` para o fluxo futuro. A integração PagBank começa no C14.

Antes de cada deploy do painel:

1. `scripts/prepare-hosting.mjs` recria `.hosting-admin-dist/`;
2. somente `index.html` e `assets/` são copiados;
3. `scripts/verify-hosting-dist.mjs` bloqueia qualquer arquivo fora dessa allowlist.

Antes de cada deploy público, `scripts/prepare-public-hosting.mjs` copia apenas `public/index.html`, `public/404.html` e `public/assets/`; `scripts/verify-public-hosting-dist.mjs` valida essa allowlist e o uso de renderização segura.

Rewrites versionados nos targets `admin` e `public`:

- `/api/** -> licensingApi`
- `/health -> licensingApi`

Os rewrites não usam `pinTag`. Functions e Hosting são implantados em etapas separadas; isso evita que a finalização do Hosting tente alterar tags/tráfego do serviço Cloud Run da Function v2.

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

Assim, o painel usa o mesmo domínio do Hosting administrativo e os rewrites encaminham a API sem dependência direta do endpoint da Function ou do runtime legado.

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

## Domínio comercial C13

Não existe coleção paralela `products`. Um programa/produto continua sendo `projects/{projectId}` e suas ofertas continuam em `projects/{projectId}/plans/{planId}`.

Campos comerciais do programa: `name`, `slug`, `description`, `shortDescription`, `imageUrl` (HTTPS), `status`, `publicCatalog`, `featured` e `displayOrder`. Campos comerciais adicionais da oferta: `displayOrder`, preservando `name`, `description`, `price`, `durationDays`, `lifetime`, `deviceLimit`, `startMode`, `active` e `publicCatalog`.

Somente programas ativos e publicados e planos ativos e publicados entram em `GET /api/v1/catalog`. A projeção é uma allowlist: dados administrativos, origens permitidas e material privado de assinatura nunca são serializados. A ordem é `displayOrder`, nome em `pt-BR` e ID como desempate.

Fluxo comercial planejado:

```text
Programa/Projeto -> Planos/Ofertas -> Catálogo -> futuro Pedido -> futuro Pagamento -> futura Licença
```

O PagBank pertence ao C14, não ao C13.

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

Hosting administrativo:

```bash
node scripts/prepare-hosting.mjs
node scripts/verify-hosting-dist.mjs
node scripts/verify-firebase-config.mjs
```

Hosting público:

```bash
node scripts/prepare-public-hosting.mjs
node scripts/verify-public-hosting-dist.mjs
```

Smoke não destrutivo da produção, após o deploy:

```bash
node scripts/smoke-production.mjs
```

Emuladores:

```bash
firebase emulators:start --only functions,hosting,firestore,storage --project guiasys-licensing
```

## Versionamento e implantação

O GitHub é usado somente como repositório/versionamento e para validações de teste. Não existe deploy de produção via GitHub Actions e não há dependência de Workload Identity Federation (WIF).

A produção é implantada diretamente no Firebase pela Firebase CLI autenticada na máquina de desenvolvimento.

## Deploy C11–C13

Antes do primeiro deploy ao vivo:

1. confirmar o projeto `guiasys-licensing`;
2. confirmar/criar o secret `ADMIN_FIREBASE_UID`;
3. executar todos os gates;
4. publicar Functions + Hosting;
5. validar `/health` e login;
6. publicar e validar o site administrativo `guiasys-licensing-admin.web.app`;
7. publicar o target `public` como gateway da API e validar `guiasys-licensing.web.app/health`;
8. conectar `painel.licencas.guiasys.online` ao target admin;
9. conectar `licencas.guiasys.online` ao target public e validar `/health` + `/api/v1/catalog`;
10. manter o Worker antigo disponível somente durante a janela de rollback.

Com Firebase CLI autenticada localmente:

```bash
firebase deploy --only functions:licensing --project guiasys-licensing
firebase deploy --only hosting:admin --project guiasys-licensing
firebase deploy --only hosting:public --project guiasys-licensing
```

GitHub Actions não realiza deploy no Firebase.

O domínio customizado e os registros DNS são configuração externa ao repositório. Não altere DNS antes de a URL `*.web.app` passar no smoke test.

## Rollback

Hosting possui rollback de releases pelo Firebase Console. Durante a migração C11, o endpoint Cloudflare legado pode ser mantido disponível como contingência, mas não deve voltar a ser hardcoded no frontend.
