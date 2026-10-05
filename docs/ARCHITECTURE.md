# Arquitetura — GuiaSys Licensing

## Princípio

Existe um único motor de licenciamento e múltiplos ambientes independentes. Cada `projectId` define uma fronteira de dados.

## Componentes

### GitHub Pages
Hospeda apenas HTML, CSS e JavaScript do painel.

### Firebase Authentication
Autentica o administrador usando Google ou e-mail/senha. O Firebase ID Token é enviado ao backend.

### Firebase Functions v2
É o runtime principal do backend a partir do C10. A função HTTP `licensingApi` executa a lógica privilegiada em Node.js 22, região `southamerica-east1`, usando Firebase Admin SDK e as credenciais nativas da service account do runtime.

O UID do administrador master é lido de `ADMIN_FIREBASE_UID` via Secret Manager. O backend Firebase não utiliza chave JSON de service account persistida no repositório nem em variável de ambiente.

### Cloudflare Worker legado
Permanece temporariamente compatível apenas como rollback durante a transição. O corte definitivo de tráfego ocorre na etapa de Hosting/implantação; o contrato público `GSL-v1` não muda.

### Cloud Firestore
Persiste projetos, planos, clientes, licenças, dispositivos, ativações e logs.

## Fluxo administrativo

```text
Administrador
  -> Firebase Auth
  -> ID Token
  -> Firebase Functions v2
  -> valida assinatura + UID
  -> Firestore
```

## Fluxo do aplicativo

```text
Programa GuiaSys
  -> integrationCode + key/deviceId
  -> Firebase Functions v2
  -> valida licença/trial
  -> Firestore
  -> assina entitlement ES256
  -> resposta + offlineUntil + JWS
```

## Modelo de dados

```text
projects/{projectId}
  fields do projeto

projects/{projectId}/plans/{planId}
projects/{projectId}/customers/{customerId}
projects/{projectId}/licenses/{licenseId}
projects/{projectId}/licenseKeys/{sha256(key)}
projects/{projectId}/trials/{sha256(deviceId)}
projects/{projectId}/devices/{sha256(deviceId)}
projects/{projectId}/activations/{activationId}
projects/{projectId}/logs/{logId}
projects/{projectId}/internal/signing

integrationCodes/{sha256(integrationCode)}
rateLimits/{sha256(client|bucket)}
```

As coleções de cada projeto nunca são consultadas como dados globais pelos módulos do projeto. O dashboard global é a exceção administrativa e agrega os ambientes.


## Contrato de integração

O contrato público atual é `GSL-v1`.

Um projeto cliente conhece somente:

- API base pública;
- Código de Integração permanente;
- `projectId` público para compatibilidade;
- versão do protocolo;
- license key fornecida pelo usuário;
- Device ID estável gerado pelo cliente.

Planos e regras comerciais permanecem no servidor. O cliente recebe o estado efetivo da licença por `activate` e `validate`. A migração de runtime não altera paths, payloads nem semântica do `GSL-v1`.

A página `Integração` de cada projeto gera o documento oficial que deve ser seguido pelo projeto de destino. Mudanças incompatíveis no protocolo exigem uma nova versão do contrato.


## Trial centralizado

O trial pertence ao projeto e é controlado pelo servidor.

```text
primeira execução sem licença
  -> /project/config
  -> /trial/start
  -> servidor grava startedAt/expiresAt por Device ID
  -> cliente revalida em /trial/validate
```

A política atual vale para novos trials. Um trial já iniciado preserva duração, intervalo de validação e tolerância offline como snapshot.

Atualizar ou reinstalar o aplicativo não reinicia trial nem licença enquanto o Device ID permanecer o mesmo.

## Portal do cliente — fronteira futura

O portal do cliente será uma aplicação separada. Ele poderá compartilhar Firebase Authentication e Firestore, mas Firebase Functions v2 continuará sendo a camada de autorização e regras. O catálogo público diferencia projetos e planos explicitamente disponibilizados para venda.


## Autorização offline assinada

Cada projeto possui um par ES256 (ECDSA P-256/SHA-256). A chave privada fica em `projects/{projectId}/internal/signing`, coleção que não é exposta pelo roteamento administrativo. A chave pública fica no documento do projeto e é entregue pela configuração pública/contrato.

Após uma ativação ou validação bem-sucedida, o Worker assina um JWS contendo, entre outros:

- protocolo;
- tipo (`license` ou `trial`);
- projeto e Código de Integração;
- hash do dispositivo;
- status;
- datas relevantes;
- `offlineUntil`.

O cliente valida a assinatura, compara o Device ID local e respeita `offlineUntil` e `expiresAt`.

## Proteção contra abuso

Endpoints públicos usam rate limiting por IP e categoria de operação. O objetivo é reduzir brute force de keys e abuso sem alterar o protocolo GSL-v1.

## CORS por projeto

Para aplicações Web, cada projeto possui `allowedOrigins`. Requisições com cabeçalho `Origin` só são aceitas se a origem estiver na lista do projeto ou fizer parte das origens administrativas internas. Aplicações nativas sem `Origin` continuam funcionando normalmente.

## Conversão de trial

Ao ativar uma licença paga no mesmo Device ID, um trial existente é marcado como `converted`. Ele deixa de ser reutilizável e não soma tempo restante à licença paga.


## Runtime do backend — C10

O backend Firebase usa:

- Cloud Functions for Firebase v2;
- Node.js 22;
- Firebase Admin SDK;
- região `southamerica-east1`;
- máximo de 20 instâncias;
- Secret Manager para `ADMIN_FIREBASE_UID`;
- `X-Request-Id` em todas as respostas;
- logs estruturados de conclusão e erro;
- transações nativas do Admin SDK para operações atômicas.

O adaptador `firebase-runtime.js` preserva a interface de persistência usada pelo motor existente. Isso permite trocar a infraestrutura sem duplicar as regras de licenciamento, trial, RBAC, assinatura ES256 ou validação GSL-v1.

A autenticação administrativa no runtime Firebase usa `verifyIdToken(..., true)`, consulta o estado real da conta e mantém a validação de provedor, revogação, conta desativada e autenticação recente já existente no domínio.
