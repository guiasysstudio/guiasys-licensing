# Firebase Foundation — estado após C11

Projeto Firebase: `guiasys-licensing`.

## Recursos versionados

- Firestore Rules: deny-all para clientes
- Storage Rules: deny-all para clientes
- Firestore indexes
- Firebase Functions v2
- Firebase Hosting
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

O runtime Firebase não usa Service Account JSON versionada nem variável `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Hosting

O Hosting publica `.hosting-dist/`, criada em predeploy.

A allowlist contém somente:

- `index.html`
- `assets/**`

Rewrites:

- `/api/** -> licensingApi`
- `/health -> licensingApi`

Headers de segurança e cache são definidos no `firebase.json`.

## Segurança

As Rules continuam:

```
allow read, write: if false;
```

Toda operação de dados passa pelo backend privilegiado.

## Validação local

```powershell
node scripts/prepare-hosting.mjs
node scripts/verify-hosting-dist.mjs
node scripts/verify-firebase-config.mjs
npx --yes firebase-tools@15.32.1 emulators:exec --project guiasys-licensing --only firestore,storage "node scripts/verify-firebase-config.mjs"
```

## Deploy

Confirme primeiro:

```powershell
firebase use
```

Projeto esperado:

```
guiasys-licensing
```

O secret master deve existir:

```powershell
firebase functions:secrets:set ADMIN_FIREBASE_UID --project guiasys-licensing
```

Depois dos gates e do smoke em emulator:

```powershell
firebase deploy --only functions:licensing,hosting --project guiasys-licensing
```

Somente após validar a URL Firebase Hosting, conecte `licencas.guiasys.online` ao site e altere DNS conforme os valores apresentados pelo Firebase Console.

Nunca versione Service Account JSON, tokens, UID master ou outros segredos.
