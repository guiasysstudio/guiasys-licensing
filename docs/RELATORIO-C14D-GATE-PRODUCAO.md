# Relatório C14-D — Gate de produção

Data: 2026-10-06

## Origem e escopo

- Commit inicial validado: `47b92823cd85aa46f3ab5c6d6640f8eee9aeb542`.
- Branch: `feat/c14d-production-gate`.
- Firebase Project explícito: `guiasys-licensing`.
- Site público: `https://licencas.guiasys.online`.
- Painel administrativo: `https://painel.licencas.guiasys.online`.
- Nenhum merge, release ou dado comercial de teste faz parte deste gate.

## Auditoria de configuração

- `.firebaserc` usa somente `guiasys-licensing` e associa `public` a `guiasys-licensing` e `admin` a `guiasys-licensing-admin`.
- O default local do Google Cloud CLI apontava para outro projeto (`guiadelivery-e99fb`); por isso nenhum comando confiou no default. Todos os reads e deploys usaram `--project guiasys-licensing` ou o project ID explícito na URL da API.
- Os dois sites existem no projeto. Os CNAMEs confirmam `licencas.guiasys.online -> guiasys-licensing.web.app` e `painel.licencas.guiasys.online -> guiasys-licensing-admin.web.app`.
- Ambos os Hostings reescrevem somente `/api/**` e `/health` para `licensingApi`, região `southamerica-east1`, e mantêm os headers de segurança/cache definidos em `firebase.json`.
- A Function `licensingApi` é Gen 2, Node.js 22, 512 MiB, timeout de 60 segundos e máximo de 20 instâncias.
- O código C14-C define `PAYMENT_PROVIDER=manual_pix`, `PAGBANK_ENABLED=false` e vincula somente o secret `ADMIN_FIREBASE_UID`. Secrets PagBank antigos não serão apagados do Secret Manager.
- Firestore e Storage mantêm regras deny-all para clientes. Não existem índices compostos ou overrides no projeto/repositório.
- Firebase Authentication mantém e-mail/senha e Google habilitados; autenticação anônima está desabilitada. Foi encontrada e corrigida a ausência de `painel.licencas.guiasys.online` nos domínios autorizados, preservando integralmente os domínios/providers existentes.
- A configuração bootstrap do PIX permanece `manual_pix`, EVP `821fee6e-dbdd-46ea-adfc-8afffc89d422`, marca GuiaSys, titular Andrew Lindolfo, cidade JI PARANA, WhatsApp `5569993082084` e confirmação manual habilitada. A edição exige Admin com `managePlatformSettings`.

## Gates antes do deploy

- Testes: 187/187 aprovados.
- `npm run check`: aprovado.
- Sintaxe dos frontends e scripts de smoke/emulator: aprovada.
- Verificador Firebase: aprovado.
- Build/verificação do Hosting público: aprovado.
- Build/verificação do Hosting Admin: aprovado.
- Firestore/Storage Emulator: aprovado.
- Transações Firestore Emulator: leitura/escrita atômica, retry e multi-write aprovados.
- Fluxo C14-C no Firestore Emulator: pedidos concorrentes, preço server-side, ownership, RBAC, transições, idempotência, fulfillment/licença única e PagBank sem rede aprovados.
- Rules Emulator: 6/6 acessos indevidos bloqueados.
- `git diff --check`: aprovado.

## Preflight do deploy

Recursos autorizados, sempre com `--project guiasys-licensing`:

1. Function `licensingApi`;
2. Firestore Rules (sem alteração/publicação de índices);
3. Storage Rules;
4. Hosting target `public`;
5. Hosting target `admin`.

Fora da correção necessária do domínio autorizado do Firebase Auth, nenhum outro recurso irrelevante ou dado real será criado, alterado ou apagado. Nenhum secret será exibido ou removido. Os comandos e resultados efetivos serão registrados após cada etapa.

## Rollback documentado antes do deploy

Pontos preservados:

- C14-B: branch/tag de backup no commit `550ba7d7162a074e418e41c8112e124f8c65eba3`;
- C14-C validada: commit `47b92823cd85aa46f3ab5c6d6640f8eee9aeb542`.

Se a C14-D introduzir problema, voltar à C14-C significa selecionar exatamente o commit validado em um working tree limpo, repetir os gates e republicar explicitamente os mesmos recursos para `guiasys-licensing`:

```powershell
git switch feat/c14c-manual-pix-checkout
git rev-parse HEAD
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only functions:licensing
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only firestore:rules,storage
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only hosting:public
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only hosting:admin
```

O `git rev-parse HEAD` deve resultar em `47b92823cd85aa46f3ab5c6d6640f8eee9aeb542`. A adição do domínio Admin no Firebase Auth é compatível com a C14-C e não precisa ser revertida. Nenhum ponto de restauração deve ser apagado.

## Deploy e verificação pós-deploy

### Functions

Comando efetivo:

```powershell
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only functions:licensing --non-interactive
```

- Resultado: sucesso para a única Function do codebase, `licensingApi`, em `southamerica-east1`.
- Revisão pós-deploy: `licensingapi-00008-peb`, estado `ACTIVE`.
- Configuração efetiva confirmada: `PAYMENT_PROVIDER=manual_pix`, `PAGBANK_ENABLED=false`, `PAGBANK_SANDBOX_CHECKOUT_ENABLED=false`.
- Secret bindings pós-deploy: somente `ADMIN_FIREBASE_UID`.
- `PAGBANK_TOKEN` e `PAGBANK_SANDBOX_TOKEN` não estão vinculados à revisão. Os secrets antigos não foram excluídos do Secret Manager.
- Duas tentativas anteriores encerraram antes de qualquer publicação: a primeira usou um filtro incompatível com o codebase; a segunda identificou a ausência dos parâmetros explícitos no dotenv local. O arquivo local ignorado `worker/.env.guiasys-licensing` recebeu somente `PAYMENT_PROVIDER=manual_pix` e `PAGBANK_ENABLED=false`, sem token.

### Rules

Comando efetivo:

```powershell
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only "firestore:rules,storage" --non-interactive
```

- Firestore Rules: compiladas e publicadas com sucesso.
- Storage Rules: compiladas e publicadas com sucesso.
- Índices: nenhuma alteração ou publicação; a configuração permanece vazia.

### Hosting público

```powershell
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only hosting:public --non-interactive
```

- Build/verificador predeploy: aprovado, quatro arquivos permitidos.
- Release do site `guiasys-licensing`: sucesso.
- URLs: `https://guiasys-licensing.web.app` e `https://licencas.guiasys.online`.

### Hosting Admin

```powershell
npx --yes firebase-tools@15.32.1 deploy --project guiasys-licensing --only hosting:admin --non-interactive
```

- Build/verificador predeploy: aprovado, quatro arquivos permitidos.
- Release do site `guiasys-licensing-admin`: sucesso.
- URLs: `https://guiasys-licensing-admin.web.app` e `https://painel.licencas.guiasys.online`.

### Smoke tests

- `scripts/smoke-production.mjs`: aprovado após atualizar a expectativa da API de `2.0.1` para a versão C14-C correta, `2.1.0`.
- Site público e Admin respondem por HTTPS; HTML, CSS e JavaScript publicados carregam com Content-Type correto.
- Headers de hardening do Admin aprovados.
- `/health` nos dois domínios aponta para `guiasys-licensing`, Functions v2, Admin SDK configurado e protocolo `GSL-v1`.
- Rotas de cliente e Admin sem autenticação retornam `401`; o painel não depende de URL oculta.
- Configuração pública confirma `manual_pix`, PIX habilitado, EVP e confirmação manual.
- POST seguro e sem dados para o webhook congelado retorna `404 pagbank_disabled`.
- O frontend público publicado contém catálogo, carrinho/checkout, PIX, QR Code, Copia e Cola e Minhas Compras, sem PagBank, cartão ou boleto.
- O catálogo respondeu corretamente, mas com zero ofertas: o projeto real GuiaPlay está ativo porém `publicCatalog=false`, e seus dois planos existentes não têm os campos comerciais públicos necessários. Nenhum registro/preço real foi modificado; uma oferta deverá ser configurada conscientemente pelo proprietário/Admin antes do teste PIX real.
- A automação visual/responsiva em navegador não pôde ser inicializada por incompatibilidade do runtime da ferramenta disponível. Os testes estáticos responsivos/acessibilidade da suíte passaram; não foi simulado login ou checkout visual.

### Logs

- Logs pós-deploy de `licensingApi`: nenhuma severidade de erro, exception/init failure, permission denied inesperado, falha CORS ou referência a PagBank/`PAGBANK_TOKEN`.
- Nenhum secret foi impresso nos comandos ou no relatório.

## Alterações do gate

- Firebase Auth: adicionado `painel.licencas.guiasys.online` aos domínios autorizados, preservando todos os anteriores e os providers e-mail/senha e Google.
- Ambiente local ignorado: parâmetros não secretos `PAYMENT_PROVIDER=manual_pix` e `PAGBANK_ENABLED=false` adicionados para deploy não interativo.
- `scripts/test-firebase-rules.mjs`: probe reproduzível deny-all para Firestore/Storage Emulator.
- `scripts/smoke-production.mjs`: versão atualizada e cobertura de páginas, assets, proteção Auth, PIX manual e PagBank congelado.
- `docs/RELATORIO-C14D-GATE-PRODUCAO.md`: este relatório.
- Nenhuma alteração no gerador PIX, BR Code, CRC16, TXID, checkout, fulfillment, licensing, trial ou código de produção.

Commit técnico do gate: `02090d9` (`test(production): add C14-D smoke gates`). O commit documental final é informado na saída de encerramento da tarefa.

## Testes humanos obrigatoriamente pendentes

1. PIX real de baixo valor, conferência dos dados e envio manual do comprovante pelo WhatsApp.
2. Confirmação Admin do pagamento real e verificação de `paid/fulfilled`, licença e aviso pelo WhatsApp.
3. Verificação do pedido/licença/key em Minhas Compras.
4. Ativação e revalidação reais no GuiaPlay, incluindo persistência após reabrir.

Antes do item 1, o proprietário/Admin deve publicar conscientemente uma oferta comercial real do GuiaPlay. O gate não alterou `publicCatalog`, planos ou preços de produção.
