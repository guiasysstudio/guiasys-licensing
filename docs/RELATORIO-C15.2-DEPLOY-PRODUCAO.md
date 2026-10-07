# Relatório C15.2 — Deploy controlado Firebase e smoke de produção

Data: 7 de outubro de 2026

Branch: `feat/c15.2-production-deploy`

HEAD inicial e técnico publicado: `346aae8de6f129b019e8691d85e25f8dd955164e`

HEAD final da entrega: commit documental que contém este relatório; o hash exato é registrado no handoff após o push, pois um commit não pode gravar o próprio hash.

Firebase Project: `guiasys-licensing`
Escopo: publicação da C15/C15.1 já validada, smoke de produção, inspeção de logs e documentação. Nenhum merge na `main` e nenhuma release foram realizados.

## Estado de entrada e branch

- `git fetch origin --prune --tags`, troca para `feat/c15-public-commerce-portal` e `git pull --ff-only origin feat/c15-public-commerce-portal` executados.
- HEAD de entrada conferido exatamente em `346aae8de6f129b019e8691d85e25f8dd955164e` e working tree limpa.
- Branch `feat/c15.2-production-deploy` criada exatamente desse HEAD e enviada ao `origin` antes do deploy.
- Nenhuma alteração funcional foi feita antes ou depois da publicação.

## Preflight Firebase

- Firebase CLI: `15.32.1`.
- Node.js: `v22.22.3`.
- `firebase projects:list`: projeto `guiasys-licensing` localizado e ativo.
- `.firebaserc` e `firebase.json` auditados; os targets foram usados explicitamente, sem depender do projeto default.
- Target público `public` → site `guiasys-licensing` → `https://guiasys-licensing.web.app` → domínio `https://licencas.guiasys.online`.
- Target Admin `admin` → site `guiasys-licensing-admin` → `https://guiasys-licensing-admin.web.app` → domínio `https://painel.licencas.guiasys.online`.
- DNS conferido: os dois domínios personalizados resolvem por CNAME para os respectivos sites `web.app`.

## Validações antes do deploy

- `npm --prefix worker test`: **196/196 testes aprovados**.
- `npm --prefix worker run check`: aprovado.
- Build/staging público: aprovado, com 8 arquivos permitidos.
- Build/staging Admin: aprovado, com 8 arquivos permitidos.
- `node scripts/verify-firebase-config.mjs`: aprovado.
- `git diff --check`: aprovado.
- Working tree permaneceu limpa até o início da documentação.
- Como não houve mudança desde o HEAD integralmente validado na C15.1, a Emulator Suite não foi repetida; os arquivos remotos dos dois Hostings foram comparados byte a byte aos artefatos locais gerados e todos coincidiram.

## Configuração de pagamento

- `PAYMENT_PROVIDER=manual_pix` confirmado no ambiente de runtime.
- `PAGBANK_ENABLED=false` confirmado no ambiente de runtime.
- `PAGBANK_TOKEN` não é necessário no modo publicado e não foi criado, alterado ou removido.
- Secrets históricos do PagBank não foram apagados.
- PagBank não foi reativado e nenhuma chamada PagBank foi observada.

## Recursos publicados e comandos

Somente os recursos necessários foram publicados, sempre com `--project guiasys-licensing`:

```text
firebase deploy --only functions:licensing:licensingApi --project guiasys-licensing
firebase deploy --only firestore:rules --project guiasys-licensing
firebase deploy --only storage --project guiasys-licensing
firebase deploy --only hosting:public --project guiasys-licensing
firebase deploy --only hosting:admin --project guiasys-licensing
```

O primeiro ensaio com o filtro abreviado `functions:licensingApi` foi abortado pela CLI antes de upload/publicação porque a função pertence ao codebase `licensing`. A sintaxe foi confirmada com ajuda e dry-run, e o deploy real foi executado com o filtro qualificado mostrado acima. Não houve publicação parcial nesse ensaio.

Índices Firestore não foram publicados porque não houve alteração real de índices.

## Resultado do deploy

### Function

- Função: `licensingApi`.
- Codebase: `licensing`.
- Plataforma/runtime: Cloud Functions v2 / Node.js 22.
- Região: `southamerica-east1`.
- Estado pós-deploy: `ACTIVE`.
- Revisão: `licensingapi-00009-xov`.
- Hash do código: `9b91c76d08dc73cac6823ab341c1a0723c527f42`.
- O predeploy repetiu os 196 testes e o check com sucesso.
- A configuração segura `manual_pix`/PagBank desativado foi preservada.

### Rules

- Firestore Rules: deploy concluído; ruleset `7fc66133-f1a6-4aed-b0f8-0f27abb2d9f4`, já equivalente ao conteúdo publicado e liberado novamente sem alteração de dados.
- Storage Rules: deploy concluído; ruleset `a0cbdae9-d7e1-4fc3-bb38-b1f818750163`, já equivalente ao conteúdo publicado e liberado novamente.

### Hosting público

- Target: `public`.
- Site: `guiasys-licensing`.
- Versão publicada: `dddbfd5dc071dfb7`.
- URL padrão: `https://guiasys-licensing.web.app`.
- URL de produção: `https://licencas.guiasys.online`.
- Resultado: release concluída e servindo HTTPS 200.

### Hosting Admin

- Target: `admin`.
- Site: `guiasys-licensing-admin`.
- Versão publicada: `7da5a51d1a1916fe`.
- URL padrão: `https://guiasys-licensing-admin.web.app`.
- URL de produção: `https://painel.licencas.guiasys.online`.
- Resultado: release concluída e servindo HTTPS 200.

## Smoke de produção

O smoke foi executado nos domínios personalizados reais com Microsoft Edge headless. O conector de controle visual não expôs navegador ou aplicação nesta sessão; por isso a inspeção automatizada foi complementada por capturas locais, mas a revisão visual humana continua obrigatória.

### Saúde e artefatos

- Home pública, `/programas` e Admin: HTTPS válido e status 200.
- `/health` nos dois domínios: status 200, versão `2.1.0`, contrato `GSL-v1` e runtime `firebase-functions-v2`.
- `/api/v1/catalog`: status 200 e GuiaPlay público retornado com plano Semanal de R$ 20,00, duração de 7 dias e 1 dispositivo.
- SVGs oficiais públicos e administrativos: status 200 e `image/svg+xml`.
- Os 8 arquivos públicos e os 8 arquivos Admin remotos foram comparados byte a byte com os respectivos builds locais; todos os hashes coincidiram.

### Portal público

- Home: lockup oficial, paleta dourado/grafite, header, hero, CTA “Explorar programas”, seção de destaques, institucional e footer presentes. Como o GuiaPlay está corretamente com `featured=false`, a seção de destaques mostra o estado profissional “Em breve”; o programa permanece disponível em `/programas`.
- Programas: GuiaPlay visível; listagem sem preço e sem planos; somente um card público elegível.
- Detalhe: logo e conteúdo comercial presentes; plano Semanal no final da página, com R$ 20,00 e 7 dias.
- Carrinho: “Adicionar ao carrinho” permaneceu no detalhe, exibiu toast e atualizou o badge para 1; incremento atualizou quantidade/badge para 2 e total para R$ 40,00; remoção restaurou o estado vazio e ocultou o badge; “Comprar agora” navegou para `/carrinho`.
- Nenhum PIX foi iniciado ou pago.

### Auth e conta

- Páginas Entrar, Cadastro e Recuperação de senha abriram corretamente com identidade oficial.
- Botão do Google Auth e formulário de e-mail/senha estão presentes.
- Rota protegida de perfil redirecionou corretamente para `/entrar?next=...` quando não autenticada.
- Login real, cadastro real, recuperação enviada, Google Auth real, perfil, favoritos, compras, avatar e logout autenticados não foram executados por não haver uma conta de teste segura disponível. Nenhum usuário descartável foi criado e nenhuma credencial foi exposta.

### Admin

- Login Admin abriu com logo oficial, botão Google, paleta oficial e sem erros de página.
- O smoke autenticado de sidebar, projetos, CMS comercial, planos, clientes, licenças, pedidos, Configurações PIX e uploads ficou pendente por ausência de conta Admin segura. Nenhum dado ou preço real foi alterado.

### Responsividade

- Portal público nas páginas Home, Programas, detalhe e login: `scrollWidth` igual ao viewport em 1440, 768 e 390 px, sempre com `scrollX = 0`.
- Menu público abriu e o carrinho permaneceu acessível em tablet e mobile.
- Admin não autenticado: login sem overflow em 1440, 768 e 390 px, com identidade e fundo oficiais.
- Nenhum erro de página foi capturado pelo navegador.

## Logs pós-smoke

- A janela mais recente da `licensingApi` foi inspecionada após o smoke.
- A revisão observada foi `licensingapi-00009-xov` e o hash foi o mesmo do deploy.
- Chamadas de `/health`, `/api/v1/catalog` e `/api/v1/catalog/guiaplay` apareceram como `INFO` e status 200.
- Não foram observados exceptions, 5xx, CORS inesperado, erros inesperados de Auth/permissão, falhas de Storage/Firestore ou erro crítico.
- Não foram observadas referências a PagBank, PagSeguro ou `PAGBANK_TOKEN`; chamadas PagBank: zero.

## Correções e commits

- Correções de código: nenhuma; nenhum defeito real foi encontrado no escopo automatizado.
- O harness temporário do smoke não integra a entrega e foi removido antes do commit.
- Commit técnico publicado: `346aae8de6f129b019e8691d85e25f8dd955164e`.
- Commit documental: contém somente este relatório e é identificado no handoff final.

## Pendências humanas obrigatórias

1. Revisão visual humana da versão pública.
2. Teste real de cadastro/login, incluindo e-mail/senha, Google Auth, recuperação, perfil, favoritos, compras, avatar e logout.
3. PIX real, sem alteração artificial de preço.
4. Envio do comprovante pelo WhatsApp.
5. Confirmação manual no Admin, incluindo revisão autenticada de projetos, CMS, planos, clientes, licenças, pedidos, Configurações PIX e uploads.
6. Validação de fulfillment.
7. Conferência da key em Minhas Compras.
8. Ativação da key no GuiaPlay.

## Encerramento

A etapa para no push da branch `feat/c15.2-production-deploy` para revisão. A `main` não foi alterada e nenhuma release foi criada.
