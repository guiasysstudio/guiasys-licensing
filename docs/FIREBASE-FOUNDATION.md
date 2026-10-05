# Firebase Foundation — estado de produção após C11

Projeto Firebase: `guiasys-licensing`.

## Recursos versionados

- Firestore Rules: deny-all para clientes
- Storage Rules: deny-all para clientes
- Firestore indexes
- Firebase Functions v2
- Firebase Hosting multi-site
- Local Emulator Suite
- scripts de validação e staging

## Functions

- source: `worker/`
- codebase: `licensing`
- runtime: Node.js 22
- Function HTTP: `licensingApi`
- região: `southamerica-east1`
- Admin SDK para Auth/Firestore
- Secret Manager: `ADMIN_FIREBASE_UID`

O runtime Firebase usa as credenciais nativas da service account da Function. Não usa Service Account JSON versionada nem a variável `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Hosting multi-site

Targets versionados em `.firebaserc`:

- `public` -> `guiasys-licensing`, gateway público GSL-v1 em `licencas.guiasys.online`;
- `admin` -> `guiasys-licensing-admin`, painel em `painel.licencas.guiasys.online`.

Enquanto o portal de cliente ainda não foi desenvolvido, o target `public` publica apenas um staging mínimo (`.hosting-public-dist/`) e encaminha `/api/**` e `/health` para a Function. Nenhum artefato administrativo é publicado nesse site.

O painel administrativo publica `.hosting-admin-dist/`, criada no predeploy. A allowlist contém somente:

- `index.html`
- `assets/**`

Rewrites dos targets administrativo e público:

- `/api/** -> licensingApi`
- `/health -> licensingApi`

Os rewrites não usam `pinTag`. Functions e Hosting são implantados separadamente.

Headers de segurança e cache são definidos no `firebase.json`.

## Segurança

As Rules continuam deny-all para clientes:

```
allow read, write: if false;
```

Toda operação de dados da aplicação passa pelo backend privilegiado.

## Validação local

```powershell
node scripts/prepare-hosting.mjs
node scripts/verify-hosting-dist.mjs
node scripts/verify-firebase-config.mjs
npx --yes firebase-tools@15.32.1 emulators:exec --project guiasys-licensing --only firestore,storage "node scripts/verify-firebase-config.mjs"
```

## Deploy de produção

Confirme primeiro o projeto ativo:

```powershell
firebase use
```

Projeto esperado:

```
guiasys-licensing
```

O secret `ADMIN_FIREBASE_UID` deve existir no Secret Manager. Nunca imprima ou versione seu valor.

Depois dos gates, publique somente os componentes alterados. Para backend e painel administrativo:

```powershell
firebase deploy --only functions:licensing --project guiasys-licensing
firebase deploy --only hosting:admin --project guiasys-licensing
firebase deploy --only hosting:public --project guiasys-licensing
```

GitHub Actions não realiza deploy de produção. A implantação é feita pela Firebase CLI autenticada localmente.

Domínios de produção:

- portal público reservado: `https://licencas.guiasys.online`
- painel administrativo: `https://painel.licencas.guiasys.online`

Nunca versione Service Account JSON, tokens, UID master ou outros segredos.
