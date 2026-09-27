# GuiaSys Licensing

Central universal de licenciamento multi-projeto da GuiaSys Studio.

## Estado

**Painel:** v0.7.0  
**API:** v1.4.0  
**Protocolo público:** GSL-v1

A aplicação já possui a estrutura funcional para:

- autenticação administrativa exclusiva com Firebase Auth;
- dashboard geral;
- cadastro, edição e arquivamento de projetos;
- isolamento de dados por projeto;
- planos independentes por projeto;
- clientes independentes por projeto;
- geração de license keys;
- licenças por período ou vitalícias;
- validade iniciando na emissão ou na primeira ativação;
- limite de dispositivos;
- renovação, suspensão, reativação e revogação;
- ativações e revalidações;
- desativação de dispositivos;
- logs e auditoria;
- configurações individuais por projeto;
- administradores adicionais por e-mail Google, com projetos e permissões limitadas;
- campos tipados, máscaras e ajuda contextual;
- planos com regras imutáveis durante a emissão de licenças;
- página de integração por projeto com contrato personalizado para Universal, .NET, Web e Android;
- protocolo público versionado `GSL-v1`;
- API pública para ativar, validar e desativar licenças.

## Arquitetura

```text
GitHub Pages
    |
    | Firebase ID Token
    v
Cloudflare Worker
    |
    | Service Account / OAuth
    v
Cloud Firestore
```

O navegador não possui credencial administrativa do Firestore. Todas as operações privilegiadas passam pelo Worker.

## Isolamento de projeto

```text
projects/{projectId}
├── plans
├── customers
├── licenses
├── licenseKeys
├── devices
├── activations
└── logs
```

Clientes, licenças e dispositivos de um projeto não são compartilhados automaticamente com outro projeto.

## Frontend

O frontend estático fica na raiz e em `assets/` e é compatível com GitHub Pages.

Configuração Firebase Web atual:

- Project ID: `guiasys-licensing`
- Authentication: Google
- Firestore: acesso direto do navegador bloqueado

## Worker

Código-fonte:

```text
worker/src/index.js
```

Configuração:

```text
worker/wrangler.jsonc
```

Variáveis necessárias no Cloudflare:

- `FIREBASE_PROJECT_ID=guiasys-licensing`
- `ADMIN_FIREBASE_UID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` como **Secret**

Nunca versione o JSON da Service Account.

## API pública para os programas

### Ativar

`POST /api/v1/license/activate`

```json
{
  "projectId": "prj_xxx",
  "licenseKey": "GPL-XXXXX-XXXXX-XXXXX-XXXXX",
  "deviceId": "identificador-estavel-da-maquina",
  "deviceName": "PC Principal",
  "platform": "Windows",
  "appVersion": "1.0.0"
}
```

### Validar

`POST /api/v1/license/validate`

### Desativar

`POST /api/v1/license/deactivate`

## Segurança

- Firestore bloqueado para leitura e escrita direta pelo frontend.
- Login administrativo conferido no Worker por Firebase ID Token.
- UID administrativo comparado com `ADMIN_FIREBASE_UID`.
- Service Account armazenada apenas como Secret da Cloudflare.
- License keys geradas com `crypto.getRandomValues()`.
- Lookup de key no Firestore feito por SHA-256 da key.
- Device ID convertido para SHA-256 antes de persistência.
- Logs de auditoria separados por projeto.

## Próximas evoluções

- assinatura criptográfica das respostas para cache offline nos aplicativos;
- SDK `GuiaSys.Licensing` para .NET;
- área do cliente;
- pacotes com múltiplos produtos;
- billing e automações comerciais.


## Protocolo GSL-v1

O projeto integrado não decodifica a key e não mantém uma tabela fixa de planos. A key identifica uma licença; o Worker devolve o entitlement real dessa licença.

A resposta pública inclui, entre outros campos:

- `protocolVersion`
- `projectId`
- `licenseId`
- `planName`
- `customerName`
- `customerEmail`
- `issuedAt`
- `activatedAt`
- `expiresAt`
- `startMode`
- `durationDays`
- `lifetime`
- `maxDevices`
- `offlineDays`
- `validationHours`
- `serverTime`

Cada projeto possui uma página **Integração** que gera as instruções completas e personalizadas para serem entregues ao projeto de destino.
