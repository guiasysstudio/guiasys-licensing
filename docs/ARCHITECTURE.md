# Arquitetura — GuiaSys Licensing

## Princípio

Existe um único motor de licenciamento e múltiplos ambientes independentes. Cada `projectId` define uma fronteira de dados.

## Componentes

### GitHub Pages
Hospeda apenas HTML, CSS e JavaScript do painel.

### Firebase Authentication
Autentica o administrador usando Google. O Firebase ID Token é enviado ao Worker.

### Cloudflare Worker
Executa toda lógica privilegiada e valida o UID do administrador.

### Cloud Firestore
Persiste projetos, planos, clientes, licenças, dispositivos, ativações e logs.

## Fluxo administrativo

```text
Administrador
  -> Firebase Auth
  -> ID Token
  -> Worker
  -> valida assinatura + UID
  -> Firestore
```

## Fluxo do aplicativo

```text
Programa GuiaSys
  -> integrationCode + key/deviceId
  -> Worker
  -> valida licença
  -> Firestore
  -> resposta de licença
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

Planos e regras comerciais permanecem no servidor. O cliente recebe o estado efetivo da licença por `activate` e `validate`.

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

O portal do cliente será uma aplicação separada. Ele poderá compartilhar Firebase Authentication e Firestore, mas o Worker continuará sendo a camada de autorização e regras. O catálogo público diferencia projetos e planos explicitamente disponibilizados para venda.
