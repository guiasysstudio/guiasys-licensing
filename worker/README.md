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

## Endpoints para aplicativos

- `POST /api/v1/license/activate`
- `POST /api/v1/license/validate`
- `POST /api/v1/license/deactivate`

Os dados permanecem isolados em `projects/{projectId}/...`.
