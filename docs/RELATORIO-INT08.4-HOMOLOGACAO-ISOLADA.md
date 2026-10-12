# INT-08.4 — Preparação segura de homologação Firebase isolada

**Data:** 12 de outubro de 2026  
**Status verificável:** preparação de artefatos e CI **APROVADOS**; infraestrutura Firebase isolada e ensaios reais **NÃO EXECUTADOS**. **NO-GO para produção.**  
**Branch:** `fix/int08-consolidacao-c15-int07`, mantendo C15.3 original, INT-07 e `main` intactas.

## Por que surgiam novos "erros" entre commits?

A etapa de integração substituiu temporariamente partes de bibliotecas ou adicionou testes antes de incorporar todas as dependências. GitHub Actions executou para **cada commit intermediário**, registrando falhas que já foram corrigidas em commits subsequentes. Isso não equivale a novos incidentes na produção. Ao encerrar INT-08.3, o código havia passado **346/346**; ao implementar este kit, passou **349/349**. Verificações de infraestrutura ainda não executadas são **pendências**, não falhas detectadas. Não aumentar o escopo sem evidência nova.

## Descoberta material

Os arquivos `assets/js/app.js` (admin) e `public/assets/catalog.js` incluem `firebaseConfig` específico de **produção**, e o Admin também contém `PUBLIC_API_BASE` apontando ao domínio público produtivo. Usar uma segunda URL de Hosting sem recompilar esses valores faria o navegador continuar usando Firebase Authentication e APIs reais. Os endpoints Cloud Functions têm allowlists de origem apropriadas ao projeto original. **Nenhum preview channel do Firebase de produção é ambiente de homologação isolado.**

## Solução implementada, sem operação na nuvem

### `scripts/int08-staging-kit.mjs`

Comandos `--check` (somente leitura), `--build` (arquivos locais) e `--verify` (somente leitura). Exige:

- `GUIASYS_STAGE_PROJECT_ID` = ID único como `guiasys-licensing-hml` (exemplo, **existência NÃO verificada**);
- `GUIASYS_STAGE_PUBLIC_SITE` = mesmo ID;
- `GUIASYS_STAGE_ADMIN_SITE` = ID + `-admin`;
- `GUIASYS_STAGE_WEB_CONFIG_FILE` = **caminho absoluto para arquivo JSON Firebase Web do projeto de teste guardado fora deste repositório**. Não copiar credenciais comerciais, nem colar valores no GitHub.

O kit verifica correspondência de `projectId`, `authDomain`, `apiKey`, `appId`, `messagingSenderId` e `storageBucket`, rejeitando valores de produção e sites de projetos divergentes. Também troca as configurações **apenas nos outputs locais de staging**, gerando:

- `.int08-staging/hosting-admin/` com Firebase SDK do estágio e `PUBLIC_API_BASE` apontando ao catálogo do estágio;
- `.int08-staging/hosting-public/` com Firebase SDK do estágio e regras de URLs de Storage do estágio;
- `.int08-staging/worker/` com cópia do backend e allowlists de CORS, assets e origens apropriadas ao estágio, sem alterar `worker/src` verdadeiro;
- `.int08-staging/firebase.json` com sites explícitos do projeto de homologação, sources segregados e os index/rules versionados.
- `.int08-staging/.int08-generated` vincula artefatos ao ID/configuração esperados.

A pasta gerada está no `.gitignore`. O gerador **não executa Firebase CLI, não altera `.firebaserc`, não cria um projeto Firebase e não publica Function/Hosting**. O `.firebaserc` original segue tendo o default **`guiasys-licensing`**. **Não executar `firebase deploy` genérico a partir desse checkout.** O caminho da configuração gerada ainda precisa de validação da CLI e guardas de identidade do projeto efetivo antes de orientar um deploy no estágio.

### Segurança dos testes

- `scripts/int08-staging-readonly-smoke.mjs`: somente `GET`; valida os dois `/health` no projeto informado, HTML, arquivos JS, `integration-contract-support.js`, presença do `projectId` do stage no bundle e ausência da API key de produção.
- `scripts/int05-integration-smoke.mjs`: agora exige `GUIASYS_INTEGRATION_EXPECTED_PROJECT` como âncora EXATA, `GUIASYS_INTEGRATION_STAGE_ACK=ISOLATED_TEST_PROJECT`, domínios de estágio explícitos, e compara `GET /health.firebaseProject` dos dois Hosts antes de `POST /project/config`. Esse POST pode gerar/escrever integração/chaves em projetos legados: usar apenas registros fictícios em stage.
- `worker/tests/int08-staging-kit.test.mjs`: bloqueia projeto de produção, sites misturados, uso de Firebase Web config real, e confirma validação sem deploy.
- `worker/tests/int08-release-gate.test.mjs`: exige aprovação do projeto esperado e bloqueia domínios e canais de preview produtivos.
- `.github/workflows/int08-staging-kit-check.yml`: build real dos artefatos **no runner do GitHub** usando Firebase Web JSON inequivocamente **falso**, sem credenciais e **sem publicar**. Verifica JS, sites, backend e isolamento.
- `.github/workflows/worker-security-tests.yml`: inclui sintaxe e triggers dos novos scripts.

## Evidências da preparação

- **Backend Security Tests** run `38319969145`: **349 testes aprovados / 0 falhas**, auditoria de dependências de produção sem vulnerabilidades no nível verificado.
- **INT-08.4 Isolated Firebase Staging Kit** run `38319738874`: build isolado offline **aprovado** (artefatos construídos com credenciais fictícias); não foi deploy.
- **INT-08.3 Live Read-only Release Preflight** run `38318644178`: sete assets públicos/administrativos publicados correspondiam à C15.3 após normalizar CRLF/LF. Continua válido somente para o escopo de arquivos verificado.
- A revisão Cloud Run produtiva `licensingapi-00016-lij` e os releases Hosting conhecidos não foram alterados por esta etapa.

## Próximos gates — NÃO CONFUNDIR COM ERROS

**Gate 1 — infraestrutura (pendente):** verificar se existe projeto novo `guiasys-licensing-hml` OU escolher ID disponível, criar/ativar Firebase, Blaze, Auth de teste com credenciais fictícias, Firestore/Storage, dois sites Hosting separados e Secret `ADMIN_FIREBASE_UID` de usuário de teste. Não copiar secret, contas, clientes, compras, PIX real ou dados de produção. Site ID pode precisar de adaptação se não estiver disponível.

**Gate 2 — build real (pendente):** baixar Firebase Web config do projeto de teste em arquivo local FORA do repositório; fornecer quatro variáveis de ambiente acima; executar `node scripts/int08-staging-kit.mjs --check` e `--build`; validar os outputs e confirmar que a CLI de implantação usará projeto/conta/sites corretos, sem depender do default produtivo.

**Gate 3 — publicação isolada e TTL (pendente):** somente após revisar permissões/targets, publicar Functions v2, Hosting Admin e público, regras deny-all e configuração Firestore TTL `rateLimits.expireAt` **EXCLUSIVAMENTE no projeto de homologação**; verificar status de TTL com `gcloud firestore fields ttls list --collection-group rateLimits --project <stage-project>`. A ativação do TTL pode ser demorada e exclusões são assíncronas. O TTL já está versionado em `firestore.indexes.json`, mas não aplicado.

**Gate 4 — testes reais (pendente):** autenticação Google/e-mail no estágio, duas identidades Firebase e dois dispositivos/rede diferentes com mesmo ingress de proxy, spoofing de headers, HTTP 429, limite/TTL/custos, projeto/config/trial e entitlement ES256/JWK pinning, reinicialização/reinstalação GuiaPlay em staging e checkout manual com pagamento fictício. Testar operação comercial sem cobranças reais nem contato com clientes.

**Gate 5 — release produção (pendente, depende de aprovação):** registrar alterações e reversão de Hosting + Cloud Run, confirmar restauração e saúde, escopos exatos de `--only` em deploy e janela aprovada. **Não foi autorizado nem executado.**

## Primeiro passo operacional, totalmente somente leitura

No PowerShell local conectado ao GCP:

```powershell
gcloud projects describe guiasys-licensing-hml --format="value(projectId,lifecycleState)"
```

- Se retornar `NOT_FOUND`, significa que o ID ainda não existe para a conta, ou não há acesso: confirmar disponibilidade/criação no Console Firebase sem tocar no projeto existente.
- Se retornar `ACTIVE`, **não** considerar automaticamente que é projeto Firebase configurado/isolado: verificar ownership, billing, Auth/Firestore e sites antes de qualquer alteração.
- Nenhum resultado dessa consulta foi recebido até a redação do relatório.

### Decisão de status

**INT-08.4A (preparação de código + validação automatizada): APROVADA.**  
**INT-08.4B (criação/configuração stage e testes em nuvem): NÃO EXECUTADA.**  
**INT-08 como release em produção: NO-GO.**
