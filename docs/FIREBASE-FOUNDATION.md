# Firebase Foundation

Este repositório versiona a configuração base do projeto Firebase `guiasys-licensing`.

## Estado do C03

- Firestore Rules: **deny-all para clientes**
- Storage Rules: **deny-all para clientes**
- Firestore indexes: versionados
- Firebase project alias: versionado
- Hosting: ainda **não configurado**
- Functions: ainda **não configurado**

O Worker atual usa credencial server-side e não depende das Security Rules de cliente para acessar o Firestore.

## Regra de segurança

Enquanto o backend definitivo não estiver migrado para Firebase Functions/Admin SDK e os fluxos de cliente não estiverem formalizados, nenhuma aplicação Web/Mobile deve acessar Firestore ou Storage diretamente.

Por isso, as Rules deste bloco usam:

```
allow read, write: if false;
```

Qualquer abertura futura deve ser feita por coleção/caso de uso específico, com testes antes do deploy.

## Validação local

Com Node.js 22 e Java instalados:

```powershell
node scripts/verify-firebase-config.mjs
npx --yes firebase-tools@15.32.1 emulators:exec --project guiasys-licensing --only firestore,storage "node scripts/verify-firebase-config.mjs"
```

## Deploy

Não execute deploy de Rules sem revisar o projeto selecionado:

```powershell
firebase use
```

O alvo esperado é:

```
guiasys-licensing
```

Depois da validação e somente quando aprovado:

```powershell
firebase deploy --only firestore:rules,firestore:indexes,storage --project guiasys-licensing
```

Nunca versione Service Account JSON, tokens ou arquivos de segredo.
