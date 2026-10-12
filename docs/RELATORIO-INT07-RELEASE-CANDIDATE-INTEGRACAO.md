# INT-07 — Release candidata isolada de integração GSL-v1

**Data:** 12/10/2026  
**Repositório:** `guiasysstudio/guiasys-licensing`  
**Branch de release candidata:** `fix/int07-integration-only-rc`  
**Baseline imutável:** `9a042b771703ee527426ec5a54501f2155a8fcfa` (última revisão de produção **documentada** na C15.3, não confirmada como a revisão realmente ativa agora)  
**Origem técnica do módulo:** `fix/int06-rate-limit-idempotency`, após INT-01 a INT-06  
**Deploy realizado? NÃO. Merge realizado? NÃO.**

## Motivo desta conciliação

A INT-06 partia da auditoria C15.3, que modifica checkout PIX, autenticação, catálogo, UI pública e outras funções em paralelo. Comparar `main` com `fix/int06-rate-limit-idempotency` também inclui o histórico C14/C15; **não usar `main` como prova de qual revisão está ativa no Firebase.**

Em vez de publicar a branch de INT-06, esta RC foi criada diretamente da versão C15.2 de produção **documentada** e recebeu apenas os componentes de integração. Nenhum commit da C15.3 foi incorporado integralmente.

## Escopo transportado (conferir no diff da RC)

- `assets/js/app.js` — substituição **somente** das quatro funções do gerador de integração e adição do import do módulo de exemplos; checkout, login e restantes páginas não foram alterados nesta RC.
- `assets/js/entitlement-verifier.js` — segurança ES256/JWS, validação offline, datas e chave fixada.
- `assets/js/integration-contract-support.js` — normalização da JWK pública e exemplos de respostas.
- `worker/src/index.js` — saneamento da chave pública, validação dos seletores, rate limiting pelo candidato de ingresso e import da política; nenhuma outra regra comercial deliberadamente modificada.
- `worker/src/activity-policy.js` — revalidações idempotentes em janela limitada.
- `worker/src/rate-limit-identity.js` — extração do último endereço sintaticamente válido de XFF (assunto de homologação, veja ressalva).
- `worker/tests/activity-policy.test.mjs`, `worker/tests/entitlement-verifier.test.mjs`, `worker/tests/c12-regression.test.mjs`, `worker/tests/int03-integration-contract.test.mjs`, `worker/tests/int04-jws-hardening.test.mjs`, `worker/tests/int06-rate-limit-identity.test.mjs` — testes unitários, contrato, API, replay e criptografia.
- `scripts/int05-integration-smoke.mjs` — smoke externo sem ativação de licenças; `/project/config` pode migrar campos legados no Firestore.
- `scripts/verify-hosting-dist.mjs` — require do módulo de integração nos arquivos do painel.
- `.github/workflows/worker-security-tests.yml` e `worker/package.json` — gates de CI e de sintaxe.

**Não incluído:** mudanças C15.3 em PIX, checkout, dados de perfil, catálogo, regras Firestore/Storage, Firebase runtime e UI comercial. Em particular não há necessidade de fazer deploy do Hosting público por conta exclusiva das mudanças nesta RC.

## Limites do gate

A) O GitHub não revela o estado da pasta do VS Code nem commits locais não enviados pelo Codex. O `fix/c15-auditoria-completa` remoto estava em `8b47c95aa9938f06e6eb0de234057fcc93cd7354` no início da conciliação; não substituir trabalho local por checkout forçado nem por hard reset.

B) A revisão ativa do Firebase não foi consultada na implantação; `9a042b...` é baseline **documentado**, não comprovação do estado ao vivo.

C) **Rate limiting**: o último XFF pode identificar o mesmo ingress para visitantes distintos no Firebase Hosting/Google Front End. O script atual reduz confiança no primeiro XFF e no CF-Connecting-IP, mas **não garante IP real de usuário**. Antes de deploy, verificar a cadeia de proxy em homologação e ocorrência de falsos 429; se houver rate limit compartilhado, preparar modelo seguro por origem verificada ou aplicação.

D) Idempotência de revalidação é limitada: 64 IDs e até 7 dias em cada registro; não garante retenção vitalícia.

E) Rotação da chave ES256 não foi implementada automaticamente; não girar chaves ativas sem política de migração.

F) Integração GuiaPlay (.NET/Windows) ainda não passou por teste real.

## Plano operacional seguro

### 1. Validar a RC sem tocar na pasta do Codex

No PowerShell, em uma pasta livre de mudanças do projeto:

```powershell
git -C "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing" fetch origin
git -C "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing" worktree add --detach "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing-INT07" origin/fix/int07-integration-only-rc
Set-Location "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing-INT07"
npm --prefix worker ci --no-audit --no-fund
npm --prefix worker test
npm --prefix worker run check
node scripts/prepare-hosting.mjs
node scripts/verify-hosting-dist.mjs
node scripts/prepare-public-hosting-dist.mjs
node scripts/verify-public-hosting-dist.mjs
node scripts/verify-firebase-config.mjs
```

O worktree precisa ter um destino ainda inexistente. Não usar `git reset --hard`, não apagar arquivos e não trocar a branch na pasta ocupada por correções paralelas.

### 2. Gate de release, sem publicar

- Confirmar `git status` limpo e `git rev-parse HEAD` da RC.
- Verificar no GitHub Actions **Backend Security Tests** e **Firebase Config Check** do SHA final da RC.
- Confirmar que o diff desde o baseline C15.2 não inclui checkout PIX, regras Firebase ou portal público.
- Validar compatibilidade no Firebase Emulator e verificar rate limit em homologação; guardar logs por bucket/ingress sem dados pessoais em claro.
- Confirmar com o mantenedor das correções paralelas qual branch será a release geral; se optar pela RC isolada, publicar somente o módulo de integração com rollback preparado.

### 3. Deploy somente após aprovação operacional

Após confirmar a implantação vigente, fazer backup das revisões e liberar o gate, a publicação precisa das Functions e do Hosting administrativo na mesma revisão; **não executar deploy agora**:

```powershell
firebase deploy --only "functions:licensingApi,hosting:admin" --project guiasys-licensing
```

Publicar `hosting:public` somente se o conjunto de alterações finais incluir mudanças no portal público. Executar smokes de saúde/autenticação, integração e pagamento PIX (não mutativos), depois homologar ativação/trial em ambiente de teste dedicado.

## Veredito INT-07

**RC isolada preparada; produção NÃO homologada nem publicada.** Não afirmar que INT-07 elimina o conflito com trabalhos locais que não foram fornecidos. O propósito da RC é proporcionar um caminho de publicação da integração sem carregar automaticamente o pacote C15.3.
