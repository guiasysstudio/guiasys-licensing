# GuiaSys Licensing API

Backend privilegiado do GuiaSys Licensing.

## Runtime principal — Firebase Functions v2

A partir do C10, o runtime principal é a função HTTP `licensingApi`:

- Node.js 22;
- região `southamerica-east1`;
- Firebase Admin SDK;
- Firestore via credenciais nativas do runtime;
- Firebase Auth com verificação de revogação;
- `ADMIN_FIREBASE_UID` armazenado no Secret Manager;
- no máximo 20 instâncias;
- contrato público preservado em `GSL-v1`;
- `X-Request-Id` em todas as respostas do core;
- logs estruturados de request e erro.

Não é necessário nem permitido configurar `FIREBASE_SERVICE_ACCOUNT_JSON` para o runtime Firebase.

## Cloudflare Worker legado

O diretório mantém compatibilidade histórica com o Cloudflare Worker apenas para rollback controlado. O runtime de produção é Firebase Functions v2 e o Worker não participa do fluxo normal de implantação.

## Configuração necessária

- projeto Firebase: `guiasys-licensing`;
- Secret Manager: `ADMIN_FIREBASE_UID`;
- Firestore e Authentication habilitados;
- service account da Function com permissões necessárias para Firebase Auth/Firestore.

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

## Desenvolvimento e gates

No diretório `worker/`:

```bash
npm install
npm test
npm run check
```

O `firebase.json` usa este diretório como source do codebase `licensing`. Os testes são executados também no predeploy.

## Hardening

- Rate limiting transacional por IP/rota nos endpoints públicos.
- CORS por origem configurada em cada projeto Web.
- Entitlements offline assinados com ES256.
- Chave privada de assinatura nunca é entregue ao cliente.
- Trial convertido em licença paga não pode ser reiniciado.
- Transações nativas do Firestore Admin SDK no runtime Firebase.
- Erros 5xx não expõem detalhes internos ao cliente.
