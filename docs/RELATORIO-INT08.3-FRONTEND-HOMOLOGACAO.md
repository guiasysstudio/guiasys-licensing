# INT-08.3 — Consolidação do frontend e pré-homologação da integração

**Data:** 12/10/2026  
**Projeto:** GuiaSys Licensing / `guiasysstudio/guiasys-licensing`  
**Branch de trabalho:** `fix/int08-consolidacao-c15-int07`  
**Base preservada:** C15.3 `8b47c95aa9938f06e6eb0de234057fcc93cd7354`  
**Integração de referência:** INT-07 `4cc23fb0c50adedc22a0a8f8b54c763a8a4cec6c`  

**DECISÃO:** Implementação do frontend e checagem externa **concluídas**; homologação completa de ponta a ponta e liberação para produção **pendentes (NO-GO)**. Nenhum deploy, merge, escrita em Firestore de produção, alteração de tráfego Cloud Run ou mudança nas credenciais do projeto foi realizada.

## 1. Mudanças efetivamente incorporadas

O frontend da C15.3 foi mantido como base. Da INT-07 foram transportados, sem sobrescrever a versão antiga inteira do Admin:

- `assets/js/app.js`: 12 hunks cirúrgicos do gerador de contratos; acrescenta orientações .NET 10/Windows, Android/iOS/Flutter, ES256 P-256/P1363, pinning e rotação de chave, manejo de UUID/reinstalação, datas offline UTC, backoff HTTP 429, resposta JSON dos seis endpoints e saneamento da JWK nas configurações copiadas. Linhas duplicadas foram consolidadas e a redação do rate limiting adaptada à arquitetura INT-08.2.
- `assets/js/integration-contract-support.js`: módulo novo de normalização de JWK pública e exemplos de respostas GSL-v1. Nenhum material privado é incluído nos exemplos.
- `assets/js/entitlement-verifier.js`: verificação reforçada de JWS ES256 (base64url canônico, assinatura 64 bytes), contexto do projeto/dispositivo/ID/algoritmo, expiração, tolerância offline, controle de rollback temporal com referência fornecida pelo consumidor, regras vitalícia/trial, pinning *quando uma chave previamente confiável é informada*. **A verificação de token, isoladamente, não constitui provisionamento ou pinning obrigatório de chave: a aplicação final é responsável por distribuir e exigir a âncora de confiança.**
- `scripts/verify-hosting-dist.mjs`: novo módulo é obrigatório no Hosting admin e o import deve existir no app.
- `worker/tests/entitlement-verifier.test.mjs`: 3 hunks de regressão da INT-07 mesclados à base C15.3.
- `worker/tests/int03-integration-contract.test.mjs` e `worker/tests/int04-jws-hardening.test.mjs`: testes importados da INT-07; teste de pinning da integração reativado em `worker/tests/c12-regression.test.mjs`.
- `.github/workflows/worker-security-tests.yml`: rastreia o novo módulo e os scripts de diagnóstico; compila sintaxe do JS frontend e dos gates.
- `scripts/int08-firebase-preflight.mjs`: auditoria externa via **GET** antes da release; pós-deploy `--post` compara fontes normalizadas apenas para diferenças de CRLF/LF, sem perder SHA-256 bruto no diagnóstico.
- `scripts/int08-live-diff.mjs`: auditoria somente leitura de HTML, CSS e JS dos dois Hosts, compara código publicado com branch candidata e também com o commit fixo C15.3, normalizando CRLF/LF sem despejar código.
- `.github/workflows/int08-live-readonly-smoke.yml`: job GitHub Actions sem secrets, credenciais ou POST; consulta somente status de saúde/fingerprints da produção.
- `scripts/int05-integration-smoke.mjs`: teste potencialmente mutativo (`POST /project/config` pode atualizar metadados legados) agora exige URLs de ambiente explicitamente fornecidas, confirmação `GUIASYS_INTEGRATION_STAGE_ACK=ISOLATED_TEST_PROJECT`, **rejeita domínios de produção e canais de preview do projeto real** e verifica via `GET /health` que ambos os Hosts apontam para projeto Firebase distinto de `guiasys-licensing` antes de qualquer POST. Alias inesperado ainda precisa ser avaliado pelo operador.
- `worker/tests/int08-release-gate.test.mjs`: testes de bloqueio de execução contra produção/preview e de preflight GET-only.

**Não foram alterados:** `public/**`, `firebase.json`, `firestore.rules`, `storage.rules`, serviços de PIX/pedidos, autenticação ou `main` nesta etapa.

## 2. Verificação objetiva da origem dos assets em produção

GitHub Actions `INT-08.3 Live Read-only Release Preflight`, run **38318644178**, comprovou que **todos os sete arquivos consultados que já existiam no commit-base C15.3 são idênticos aos publicados, após normalização de CRLF/LF**:

| Arquivo publicado | Igual à C15.3 normalizado? | Igual ao candidato INT-08.3? |
|---|---|---|
| Admin `assets/js/app.js` | **Sim** | Não, contém adições novas intencionais |
| Admin `assets/js/entitlement-verifier.js` | **Sim** | Não, verificador foi reforçado |
| Admin `assets/css/app.css` | **Sim** | **Sim** |
| Admin `index.html` | **Sim** | **Sim** |
| Público `assets/catalog.js` | **Sim** | **Sim** |
| Público `assets/catalog.css` | **Sim** | **Sim** |
| Público `index.html` | **Sim** | **Sim** |

O módulo novo `assets/js/integration-contract-support.js` não existia na C15.3 nem está publicado (HTTP **404**); é esperado na release candidata. Esse confronto explica a divergência anterior de hashes brutos entre checkout Git Linux e os arquivos implantados via Firebase CLI no Windows, sem suposições sobre commits não rastreados. Os demais arquivos de mídia da publicação não foram submetidos a uma comparação binária exaustiva neste job.

O job `GET /health` confirmou **HTTP 200**, `GSL-v1`, `firebase-functions-v2`, API `2.1.0` e cabeçalhos básicos em ambos os domínios. Nenhuma requisição de teste abriu pedidos, trials ou licenças.

## 3. CI e verificações

- GitHub Actions **Backend Security Tests**, último commit de código da etapa: run **38318862808** — **346/346 testes aprovados**, zero falhas, sintaxe frontend/backend/scripts aprovada e `npm audit --omit=dev` sem vulnerabilidades de dependências de produção.
- GitHub Actions **Firebase Config Check**: run **38318186388** — aprovado após atualizar validação do módulo do Admin (preparo de Hosting, checagem de config). **Não representa deploy**.
- GitHub Actions **INT-08.3 Live Read-only Release Preflight**, run **38318644178** — verificação externa da origem C15.3 aprovada; módulo novo ainda indisponível na produção.
- Falhas transitórias em commits intermediários durante cópia de arquivos e ativação de gates foram resolvidas nas execuções finais acima.
- Não foram executados ensaios com clientes físicos reais, .NET GuiaPlay, redes móveis, cenários de pagamento PIX real nem WebDriver/E2E manual.

## 4. Proteções e referências atuais

Hosting admin `c72a0203ffa2fd66` e público `0d90ec372106b526`. Backups criados nos canais `int08-backup-20261012` de ambos os sites (canais temporários, verificar expiração). Backend atual: `licensingapi-00016-lij`, 100% do tráfego normal, imagem `sha256:023a9297bd14f1fe428ff3f72abd724ce3bd7716f637d5c91348f2188b06907c`. ZIP de origem da revisão (geração `1791831108532401`) preservado fora do GitHub e MD5 conferido pelo operador. Backups de Hosting não revertem Firestore, Functions ou regras.

O código da INT-08.2 adicionou a política `rateLimits.expireAt` em `firestore.indexes.json`; **a política TTL não foi implantada ou verificada em produção**. O rate limiting de proxies compartilhados foi verificado com mocks/testes automatizados, mas **ainda não com múltiplos clientes reais atrás do Firebase Hosting/CDN em staging**. Os tetos gerais podem provocar HTTP 429 compartilhado em condições excepcionais; o sistema ainda não inclui uma garantia de defesa contra DoS distribuído.

## 5. Gates obrigatórios para permitir release de produção

1. Criar/configurar **projeto Firebase isolado** de homologação (não confundir com preview channels do Hosting PROD), com sua própria Function, Auth, Firestore, Hosting e projetos/licenças fictícios.
2. Preparar `firestore.indexes.json` e aplicar/confirmar TTL `rateLimits.expireAt` **no projeto isolado**. Verificar índices, 429, custos/Firestore write contention, acesso direto à Function, header spoofing, dois usuários reais e dois dispositivos atrás de proxies compartilhados.
3. Publicar a candidata apenas nesse projeto isolado, com aprovações e credenciais apropriadas. O script `scripts/int05-integration-smoke.mjs` deve ser chamado **somente nesse ambiente**, com variáveis `GUIASYS_INTEGRATION_API_BASE`, `GUIASYS_INTEGRATION_ADMIN_BASE`, `GUIASYS_INTEGRATION_CODE` (produto de teste) e `GUIASYS_INTEGRATION_STAGE_ACK=ISOLATED_TEST_PROJECT`.
4. Fazer homologação manual de Admin/mobile: gerador/cópia do contrato em todas as plataformas, projeto ativo/inativo, seletores contraditórios, trial, licença mensal/vitalícia, suspensão/revogação/expiração, pinning público confiável, relógio e offline; autorização de clientes e fluxo carrinho → login → perfil → PIX → comprovante → confirmação → licença sem alterar pedido anterior.
5. Verificar integração **GuiaPlay .NET 10** de verdade: assinatura ES256 P1363, chave confiável pré-distribuída, Device ID persistente, reinstalação, offline e expiração, volta da conectividade, revalidação e recuperação de erro 429. Nenhum sucesso desses testes foi reivindicado nesta etapa.
6. Verificar Cloud Monitoring, logs 5xx/429, Firestore TTL e reversão segura do backend (revisão anterior, imagem, configuração), mais rollback dos dois Hosts. Confirmar retenção dos backups de Hosting.
7. Antes do deploy **autorizado**, rodar `node scripts/int08-firebase-preflight.mjs --pre`; depois de uma implantação autorizada do MESMO commit em produção, `node scripts/int08-firebase-preflight.mjs --post` e smoke transacional controlado apenas com dados de teste (não executar `int05` no PROD).
8. Autorizar explicitamente a janela de implantação e os alvos de deploy. Não executar publicação nem mudança de regras como consequência de um teste aprovado.

**Conclusão:** frontend integrado e correspondência C15.3/publicação comprovada, pipeline automatizado verde. **INT-08.3 está pronta para homologação real em staging, mas não é release homologada nem publicada.** O gate de produção permanece **NO-GO**.
