# GuiaSys Licensing API

Cloudflare Worker responsável por todas as operações privilegiadas do GuiaSys Licensing.

## Variáveis

- `FIREBASE_PROJECT_ID=guiasys-licensing`
- `ADMIN_FIREBASE_UID` — variável configurada no painel
- `FIREBASE_SERVICE_ACCOUNT_JSON` — **Secret**, nunca versionar o valor

## Endpoints administrativos

Todos exigem Firebase ID Token do administrador em `Authorization: Bearer <token>`.

- `GET /api/v1/admin/me`
- `GET /api/v1/admin/dashboard`
- `GET|POST /api/v1/admin/projects`
- `GET|PATCH|DELETE /api/v1/admin/projects/:projectId`
- CRUD administrativo de planos e clientes
- emissão e ações de licenças
- leitura de dispositivos, ativações e logs

## Endpoints públicos

- `GET /api/v1/catalog`
- `POST /api/v1/project/config`
- `POST /api/v1/trial/start`
- `POST /api/v1/trial/validate`
- `POST /api/v1/license/activate`
- `POST /api/v1/license/validate`
- `POST /api/v1/license/deactivate`

Os dados permanecem isolados em `projects/{projectId}/...`.


## Hardening

- Rate limiting por IP/rota nos endpoints públicos.
- CORS por origem configurada em cada projeto Web.
- Entitlements offline assinados com ES256.
- Chave privada de assinatura nunca é entregue ao cliente.
- Trial convertido em licença paga não pode ser reiniciado.
