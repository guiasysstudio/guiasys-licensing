# GuiaSys Licensing

Central universal de licenciamento multi-projeto da GuiaSys Studio.

## Estado

**Painel:** v0.9.0  
**API:** v1.6.0  
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
- página de integração por projeto com contrato personalizado para Universal, .NET, Web, Android, iOS e Flutter;
- protocolo público versionado `GSL-v1`;
- código de integração permanente por projeto;
- trial centralizado e dinâmico por projeto, com início/expiração registrados por dispositivo;
- catálogo público opcional para futuro portal do cliente;
- API pública para configuração, trial, ativação, validação e desativação de licenças;
- entitlement offline assinado com ES256 por projeto;
- rate limiting nos endpoints públicos;
- CORS configurável por projeto para integrações Web.

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
├── trials
├── devices
├── activations
├── logs
└── internal/signing   # chave privada ES256, nunca exposta pela API administrativa

integrationCodes/{sha256(integrationCode)}
rateLimits/{sha256(client|bucket)}
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

O cliente integrado deve preferir o **Código de Integração** do projeto. O `projectId` permanece aceito por compatibilidade.

### Configuração dinâmica

`POST /api/v1/project/config`

```json
{
  "integrationCode": "GSLI-XXXX-XXXX-XXXX"
}
```

### Iniciar trial

`POST /api/v1/trial/start`

```json
{
  "integrationCode": "GSLI-XXXX-XXXX-XXXX",
  "deviceId": "identificador-estavel-da-maquina",
  "deviceName": "PC Principal",
  "platform": "Windows",
  "appVersion": "1.0.0"
}
```

### Validar trial

`POST /api/v1/trial/validate`

### Ativar licença

`POST /api/v1/license/activate`

```json
{
  "integrationCode": "GSLI-XXXX-XXXX-XXXX",
  "licenseKey": "GPL-XXXXX-XXXXX-XXXXX-XXXXX",
  "deviceId": "identificador-estavel-da-maquina",
  "deviceName": "PC Principal",
  "platform": "Windows",
  "appVersion": "1.0.0"
}
```

### Validar licença

`POST /api/v1/license/validate`

### Desativar licença neste dispositivo

`POST /api/v1/license/deactivate`

### Catálogo público

`GET /api/v1/catalog`

Retorna somente projetos e planos explicitamente marcados para aparecer no futuro portal do cliente.

## Segurança

- Firestore bloqueado para leitura e escrita direta pelo frontend.
- Login administrativo conferido no Worker por Firebase ID Token.
- UID administrativo comparado com `ADMIN_FIREBASE_UID`.
- Service Account armazenada apenas como Secret da Cloudflare.
- License keys geradas com `crypto.getRandomValues()`.
- Lookup de key no Firestore feito por SHA-256 da key.
- Device ID convertido para SHA-256 antes de persistência.
- Logs de auditoria separados por projeto.
- Respostas de trial/licença recebem `entitlement.token` JWS assinado com ES256.
- A chave pública de verificação é exposta em `/api/v1/project/config`; a privada permanece somente no armazenamento interno do backend.
- `offlineUntil` limita explicitamente o uso do cache offline.
- Rate limiting por IP/rota reduz brute force e abuso dos endpoints públicos.
- Integrações Web só são aceitas a partir das origens cadastradas no projeto.

## Próximas evoluções

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


### Regra de trial

- O primeiro início do trial exige internet.
- O servidor registra `startedAt` e `expiresAt`.
- Atualização ou reinstalação não reinicia o trial para o mesmo Device ID.
- Alterar a duração no painel afeta novos trials; trials já iniciados preservam o snapshot original.
- O produto nunca deve funcionar além de `expiresAt`, mesmo offline.
- Uma licença paga ativa passa a comandar o acesso e não soma dias restantes do trial.


### Entitlement offline assinado

As respostas bem-sucedidas de trial e licença incluem:

- `offlineUntil`;
- `entitlement.format = JWS`;
- `entitlement.algorithm = ES256`;
- `entitlement.keyId`;
- `entitlement.token`.

O cliente deve validar o JWS com `signing.publicJwk` retornado por `/api/v1/project/config`, conferir o hash do Device ID e nunca usar o cache depois de `offlineUntil` ou `expiresAt`.

### Integração Web

Cada projeto pode cadastrar origens HTTPS permitidas. Navegadores só conseguem consumir os endpoints públicos do projeto quando o cabeçalho `Origin` corresponde a uma origem cadastrada. Aplicativos nativos desktop/mobile normalmente não enviam `Origin` e não dependem dessa lista.
