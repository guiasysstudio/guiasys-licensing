# INT-08 — Relatório final de homologação técnica

- **Data:** 13 de outubro de 2026
- **Branch:** `fix/int08-consolidacao-final`
- **Commit de referência:** `a2098db`
- **Projeto Firebase oficial:** `guiasys-licensing`
- **Projeto fictício usado nos emuladores:** `demo-guiasys-licensing`
**Classificação:** **GO — tecnicamente preparada para avaliação de publicação.**

Esta classificação não autoriza deploy. Nenhum deploy, push, merge, commit, alteração de
faturamento, secret real ou dado de produção foi executado.

## 1. Atividades executadas

- Conferência da branch, do commit de referência e do estado inicial limpo do Git.
- Auditoria dos contratos entre portal público, painel administrativo e API.
- Revisão de autenticação, RBAC, ownership, CORS, catálogo, perfil, carrinho, pedidos,
  PIX manual, confirmação administrativa, emissão/consulta de licenças, idempotência,
  ativação/validação ES256 e tratamento de erros cobertos pela suíte.
- Verificação de Functions v2, Auth, Firestore, Storage, Hosting multi-site, regras,
  índices/TTL versionados, parâmetros locais e dependências.
- Preparação e validação dos artefatos administrativos e públicos de Hosting.
- Homologação mutativa exclusivamente nos emuladores locais.
- Inclusão de um smoke ponta a ponta com tokens reais do Auth Emulator, Function v2 e
  persistência no Firestore Emulator.

## 2. Problemas identificados

1. Scripts mutativos antigos aceitavam ou fixavam o ID produtivo `guiasys-licensing`,
   embora fossem destinados aos emuladores. O isolamento dependia do comando correto e
   não falhava de forma segura diante de configuração incompleta.
2. README, documentação e dois comandos de CI ainda orientavam emuladores com o ID
   produtivo.
3. Auth, Functions e o fluxo comercial eram testados em blocos, sem um smoke HTTP
   autenticado atravessando os três emuladores na mesma execução.
4. O documento da INT-08.4 ainda descrevia a criação de um segundo projeto Firebase
   como caminho operacional vigente, decisão posteriormente descartada.

Não foi encontrado defeito funcional comprovado no código de produção consolidado.

## 3. Correções realizadas

- Todos os probes mutativos agora exigem `demo-guiasys-licensing` e hosts locais.
- A suíte interrompe antes de escrever se Auth, Firestore, Storage ou Functions não
  estiverem apontados aos emuladores.
- O runner valida PIX manual, PagBank desativado e UID administrativo local fictício,
  sem exibir o secret.
- O teste transacional passou a derivar host/projeto do ambiente seguro, sem fallback.
- Foi criado smoke E2E local cobrindo login real, perfil, pedido e replay, PIX manual,
  comunicação de pagamento, bloqueio entre contas, confirmação administrativa,
  fulfillment, consulta de licença e replay da confirmação.
- Workflows e documentação foram ajustados para o projeto fictício de emulador.
- O relatório INT-08.4 foi marcado como histórico; seu kit não faz parte do fluxo atual.
- Foram adicionados testes de regressão que recusam o projeto produtivo.

## 4. Arquivos modificados

- `.github/workflows/firebase-config-check.yml`
- `.github/workflows/worker-security-tests.yml`
- `README.md`
- `docs/FIREBASE-FOUNDATION.md`
- `docs/RELATORIO-INT08.4-HOMOLOGACAO-ISOLADA.md`
- `docs/RELATORIO-INT08-FINAL.md`
- `scripts/test-c14c-emulator.mjs`
- `scripts/test-c15-auth-emulator.mjs`
- `scripts/test-c15-functions-emulator.mjs`
- `scripts/test-c15-rules-emulator.mjs`
- `scripts/test-firebase-rules.mjs`
- `scripts/test-firestore-transactions.mjs`
- `scripts/test-int08-emulators.mjs`
- `scripts/test-int08-e2e-emulator.mjs`
- `worker/tests/int08-emulator-isolation.test.mjs`

## 5. Testes executados e resultados

- Suíte Node completa: **359/359 aprovados**, 0 falhas, 0 ignorados.
- Sintaxe do backend: aprovada.
- Sintaxe ampliada de 42 arquivos JavaScript/MJS: aprovada.
- Firebase config/Foundation: aprovada.
- Hosting administrativo: preparado e validado, **9 arquivos permitidos**.
- Hosting público: preparado e validado, **9 arquivos permitidos**.
- Auth Emulator: cadastro, login e recuperação de senha aprovados.
- Firestore/Storage: **6/6 bloqueios deny-all** confirmados.
- C14-C integrado no Firestore Emulator: pedidos concorrentes, preço server-side,
  ownership, RBAC, PIX manual, fulfillment, licenças e idempotência aprovados.
- INT-08 E2E: Auth Emulator -> Function v2 -> Firestore Emulator aprovado.
- Functions Emulator: `/` e `/health` HTTP 200 aprovados.
- Cliente transacional Firestore: leitura/escrita, retry por conflito e multi-write
  aprovados em execução isolada.
- Auditoria das dependências de produção: **0 vulnerabilidades**.
- `git diff --check`: aprovado.

## 6. Pendências comprovadas

- Nenhum deploy foi realizado; portanto o smoke pós-deploy da futura revisão continua
  sendo um gate operacional obrigatório.
- O estado efetivo de TTL/índices/secrets no projeto real não foi alterado nem usado
  como teste mutativo. Deve ser conferido no gate de publicação por operação somente de
  leitura e comparado com os arquivos versionados.
- `firebase-functions` 7.4.0 está disponível; o projeto permanece em 7.3.0 porque a
  atualização minor não corrige falha observada e seria mudança adicional no fechamento.

Nenhuma dessas pendências representa bloqueio de código para a avaliação de publicação.

## 7. Riscos para produção

- O Firebase CLI detecta Application Default Credentials na máquina. A suíte mitiga o
  risco exigindo ID `demo-*`, todos os hosts locais e serviços relevantes emulados; o
  próprio CLI confirmou que acessos a serviços não emulados do projeto demo falhariam.
- Um deploy futuro sem escopo explícito ainda pode afetar Functions/Hosting/regras do
  projeto oficial. Usar `--only` explícito, revisar o projeto ativo e manter plano de
  rollback.
- A ativação do TTL é estado de infraestrutura e deve ser conferida antes da publicação.
- A atualização disponível de `firebase-functions` deve ser avaliada em ciclo separado,
  com repetição integral dos testes.

## 8. Situação final da INT-08

A consolidação C15 + INT-08.4 está funcionalmente coerente e protegida por 359 testes,
smokes de emulador e validações de configuração/artefatos. O fluxo crítico comercial foi
validado com dados fictícios, incluindo autenticação real de emulador, separação de contas,
PIX manual, confirmação administrativa, emissão e consulta de licença e idempotência.

## 9. Recomendação

**GO para avaliação de publicação**, condicionado ao gate operacional normal: revisão do
diff, confirmação somente de leitura do projeto/targets/secrets/TTL, janela aprovada,
deploy manual com escopo explícito e smoke pós-deploy. **Não publicar automaticamente.**
