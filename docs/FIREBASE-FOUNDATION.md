# Firebase Foundation — configuração versionada após C13

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

- `public` -> `guiasys-licensing`, catálogo comercial e gateway público GSL-v1 em `licencas.guiasys.online`;
- `admin` -> `guiasys-licensing-admin`, painel em `painel.licencas.guiasys.online`.

O target `public` publica o staging `.hosting-public-dist/`, gerado exclusivamente de `public/index.html`, `public/404.html` e `public/assets/`, e encaminha `/api/**` e `/health` para a Function. Nenhum artefato administrativo é publicado nesse site.

O frontend busca `GET /api/v1/catalog` no mesmo origin. A CSP permite scripts e estilos apenas locais, chamadas de rede same-origin e imagens HTTPS. A allowlist do staging e a ausência de APIs inseguras de renderização são verificadas antes do deploy.

## Dados comerciais

O C13 reutiliza `projects/{projectId}` como programa/produto e `projects/{projectId}/plans/{planId}` como oferta. Não existe coleção paralela de produtos. O endpoint público serializa somente a projeção comercial permitida e preserva o `integrationCode` público do GSL-v1.

Fluxo previsto: `Programa/Projeto -> Planos/Ofertas -> Catálogo -> futuro Pedido -> futuro Pagamento -> futura Licença`. PagBank é escopo do C14 e não está implementado no C13.

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
node scripts/prepare-public-hosting.mjs
node scripts/verify-public-hosting-dist.mjs
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

## Fundacao comercial C14-A

`customerAccounts`, `orders`, `payments`, `paymentEvents` e subcolecoes auxiliares sao acessadas somente pela Function. Firestore e Storage continuam deny-by-default. O desenho usa referencias por conta e leituras por ID, sem novo indice composto.

O cliente usa o mesmo Firebase Auth com Google e e-mail/senha, mas inicializa a app nomeada `customer-storefront` no dominio publico. O backend verifica ID token, estado real da conta e e-mail confirmado antes de derivar `accountId` do UID.

Nunca versione Service Account JSON, tokens, UID master ou outros segredos.
