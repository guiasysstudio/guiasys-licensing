# Arquitetura — GuiaSys Licensing

## Princípio

Existe um único motor de licenciamento e múltiplos ambientes independentes. Cada `projectId` define uma fronteira de dados.

## Componentes

### Firebase Hosting
Opera em arquitetura multi-site no mesmo projeto Firebase. O site `guiasys-licensing` hospeda o catálogo comercial e funciona como gateway público da API GSL-v1 em `licencas.guiasys.online`; o site `guiasys-licensing-admin` hospeda o painel em `painel.licencas.guiasys.online`. O painel é preparado em `.hosting-admin-dist/`; o frontend público isolado é preparado em `.hosting-public-dist/`. Ambos reescrevem `/api/**` e `/health` para a Function `licensingApi`.

### Firebase Authentication
Autentica o administrador usando Google ou e-mail/senha. O Firebase ID Token é enviado ao backend.

### Firebase Functions v2
É o runtime principal do backend a partir do C10. A função HTTP `licensingApi` executa a lógica privilegiada em Node.js 22, região `southamerica-east1`, usando Firebase Admin SDK e as credenciais nativas da service account do runtime.

O UID do administrador master é lido de `ADMIN_FIREBASE_UID` via Secret Manager. O backend Firebase não utiliza chave JSON de service account persistida no repositório nem em variável de ambiente.

### Cloudflare Worker legado
Permanece somente como contingência temporária durante a janela de cutover. O frontend não depende mais do endpoint `workers.dev`; o tráfego alvo passa por Firebase Hosting → Firebase Functions v2.

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

## Domínio comercial e catálogo — C13

`projects/{projectId}` é simultaneamente a raiz técnica de isolamento e o programa/produto comercial. `projects/{projectId}/plans/{planId}` continua sendo a oferta comercial. O C13 não introduz uma coleção `products` nem um segundo domínio de licenças.

```text
Programa/Projeto
  -> Planos/Ofertas
  -> Catálogo público
  -> futuro Pedido
  -> futuro Pagamento
  -> futura Licença
```

O C15 amplia o projeto com CMS comercial: logo, ícone, banner, descrições, screenshots, recursos, requisitos, SEO, destaque e ordens. O plano preserva os dados técnicos e adiciona os campos comerciais necessários, incluindo `publishedInCatalog`.

O catálogo aplica uma projeção explícita por allowlist. Um programa precisa ter `status == "active"` e só é incluído quando possui ao menos um plano com `active != false` e `publishedInCatalog == true` (com fallback legado para `publicCatalog` apenas quando o novo campo não existe). Assim, não existe uma segunda trava manual de publicação no projeto. Produtos e ofertas são ordenados por suas ordens comerciais, nome e ID.

O `integrationCode` permanece no catálogo por compatibilidade deliberada com o contrato público GSL-v1. Chaves privadas, origens permitidas, permissões, clientes, logs, tokens e configurações internas não são projetados.

O portal em `public/` usa DOM seguro (`textContent`/`createElement`), imagens HTTPS, autenticação Firebase, favoritos, carrinho, perfil, pedidos, compras/licenças e checkout PIX manual. Preço, pagamento, fulfillment e emissão permanecem autoritativos no backend.


## Contrato de integração

O contrato público atual é `GSL-v1`.

A API base entregue aos produtos integrados é `https://licencas.guiasys.online`. O painel administrativo continua usando `window.location.origin` em `painel.licencas.guiasys.online`. Isso separa o endereço público de integração do endereço administrativo.

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

## Portal do cliente — C15

O portal público usa Firebase Authentication para Google e e-mail/senha. A conta global é derivada do UID, enquanto carrinho, favoritos, perfil, pedidos e referências de licenças permanecem acessíveis somente pela Function. Firestore e Storage continuam deny-all para acesso direto do navegador.

O checkout exige e-mail verificado e perfil completo. O backend recalcula preço, cria snapshot imutável do pedido e gera PIX manual. A confirmação administrativa é a única operação que promove o pagamento a pago e dispara fulfillment.


## Autorização offline assinada

Cada projeto possui um par ES256 (ECDSA P-256/SHA-256). A chave privada fica em `projects/{projectId}/internal/signing`, coleção que não é exposta pelo roteamento administrativo. A chave pública fica no documento do projeto e é entregue pela configuração pública/contrato.

Após uma ativação ou validação bem-sucedida, o backend Firebase assina um JWS contendo, entre outros:

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


## Hosting e cutover — C11

O target `admin` publica somente `index.html` e `assets/`, preparados por script em `.hosting-admin-dist/`. Backend, documentação, Rules e arquivos operacionais não entram no artefato administrativo. O target `public` publica somente `public/index.html`, `public/404.html` e `public/assets/` em `.hosting-public-dist/`; ele não contém o painel administrativo.

Os rewrites `/api/**` e `/health` apontam para `licensingApi` em `southamerica-east1` sem `pinTag`. Functions e Hosting são implantados separadamente para que o Hosting não precise modificar tags/tráfego do serviço Cloud Run durante a finalização. O path e a query originais são preservados pelo Hosting ao encaminhar a requisição.

O domínio `painel.licencas.guiasys.online` deve ser conectado ao site `guiasys-licensing-admin` somente depois do smoke test em `guiasys-licensing-admin.web.app`. O domínio `licencas.guiasys.online` permanece reservado ao portal público. O antigo `CNAME` de GitHub Pages não faz mais parte do repositório.

Durante a janela de migração, Cloudflare pode permanecer online para rollback operacional, mas não é mais referência do frontend nem da documentação de integração.


## Fluxo de versionamento e deploy

O GitHub é mantido como repositório de código, histórico e validação de testes. Produção não é publicada por GitHub Actions.

O deploy operacional é feito diretamente da máquina de desenvolvimento autenticada na Firebase CLI:

```bash
firebase deploy --only functions:licensing --project guiasys-licensing
firebase deploy --only hosting:admin --project guiasys-licensing
firebase deploy --only hosting:public --project guiasys-licensing
```

## Dominio comercial C14-A

`projects` continua sendo Produto/Programa e `projects/{projectId}/plans` continua sendo a fonte de Ofertas; nao ha colecao duplicada de produtos. `customerAccounts` representa a identidade global derivada do UID imutavel. Subcolecoes de referencia listam pedidos/licencas e mantem um customer estavel por projeto.

Pedidos, pagamentos e fulfillment separam estado comercial, financeiro e de processamento. `finalizePaidOrder()` e servico interno sem rota HTTP. Emissao administrativa e automatica compartilham `issueLicenseInTransaction`; renovacoes administrativas e comerciais compartilham `transitionLicense`. Veja [COMMERCE.md](COMMERCE.md) e [PAYMENTS.md](PAYMENTS.md).

Workload Identity Federation (WIF) não faz parte da arquitetura de implantação deste projeto.
