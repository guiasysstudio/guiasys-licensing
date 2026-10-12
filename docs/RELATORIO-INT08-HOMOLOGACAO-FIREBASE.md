# INT-08 — Pré-homologação Firebase / gate de publicação

**Data:** 12/10/2026. **Projeto Firebase:** `guiasys-licensing`.  
**Branch:** `fix/int08-firebase-preflight` (base `fix/int07-integration-only-rc`, `4cc23fb0c50adedc22a0a8f8b54c763a8a4cec6c`).  
**Estado:** **NO-GO para deploy**, por divergência real entre produção e versões rastreadas + cadeia de IP ainda não homologada.  
**Nenhuma publicação foi realizada.** GitHub é o repositório, Firebase Hosting/Functions é o runtime.

## 1. Evidências LIVE (HTTP GET, execução GitHub Actions)

Foi executado um job independente, sem credenciais Firebase e sem qualquer POST:
- Painel `https://painel.licencas.guiasys.online/health`: **200**, `ok: true`, `GSL-v1`, `firebase-functions-v2`, API `2.1.0`.
- Público `https://licencas.guiasys.online/health`: **200**, mesmos indicadores.
- Raiz HTTP de ambos sites: **200**, `X-Content-Type-Options: nosniff`.
- Painel `/assets/js/app.js`: **200** — SHA-256 publicado `ca9e9d92ab57c86e1ad6e5dc671cd06d002ec414861099bbc9806a312b70ad21`; candidato `28fb9ea42e35b11a010ba1a4155859a05c958420c7f32f105fe7e6e751c81eb4`.
- Painel `/assets/js/entitlement-verifier.js`: **200** — publicado `23b989c9ad33e6e21c9fabc6d98d57d5e8c3b7d6cc4a814e06a847b8857a2aff`; candidato `f7f5ff06f523162177fcaa41a73b16e936d65a30f2720cee2333dd4381ec2b95`.
- Painel `/assets/js/integration-contract-support.js`: **404**; o módulo novo ainda NÃO está publicado.
- Público `/assets/catalog.js`: **200** — publicado `92f4de1913200667db324c017bfc924a13813abb21f9c23f31e0d2614eee0b17`; baseline C15.2/RC `044d1f16812b2976f6b4136e434b3122d17e575f979bcd5005ef4d44080ef25d`.

Scripts e workflow implementados:
- `scripts/int08-firebase-preflight.mjs --pre` (GET-only, health, headers, inventário de fingerprints).
- `scripts/int08-firebase-preflight.mjs --post` (exige hashes idênticos nos três assets administrativos).
- `scripts/int08-detect-live-source.mjs` (compara SHA-256 da produção com branches e histórico completo recuperável pelo Git).
- `.github/workflows/int08-live-readonly-smoke.yml` (executa observação real externa em GitHub Actions).
- `worker/tests/int08-production-gate.test.mjs` (garante que o smoke é somente GET e não altera licenças).

Os hashes reais **não corresponderam** a qualquer commit encontrado no histórico Git examinado: `app.js` (82 commits que alteraram o arquivo), `entitlement-verifier.js` (8 commits), `catalog.js` (18 commits), bem como nenhum dos refs atuais. Isso **não prova** que a produção esteja errada; significa que seu código real publicado não está identificável pelos artefatos rastreados disponíveis. Pode ter sido publicado de arquivos locais não commitados ou pós-processados. Não presumir baseline de produção apenas pelo relatório C15.2.

**Evidências GitHub Actions:**
- Checks e hashes: `38311267746`;
- comparação de refs corrigida: `38311437369`;
- varredura completa dos commits: `38311510022`;
- testes automáticos do preflight: `38311127789`, **236/236**.

## 2. Riscos que impedem implantação neste momento

**BLOQUEADOR 1: produção divergente e origem desconhecida.** Publicar o código da RC de INT-07 pode sobrescrever modificações importantes no painel público/administrativo não representadas no GitHub. A C15.3 Codex pode existir apenas no VS Code. Antes de publicar, capturar e reconciliar HEAD local, arquivos modificados e informação real de versões Hosting / Cloud Run em uso.

**BLOQUEADOR 2: rate limiting atrás de ingress compartilhado.** A INT-06 usa o último IP de `X-Forwarded-For` para não confiar no prefixo enviado pelo cliente. A documentação Google Cloud afirma que o balanceador pode acrescentar `client-ip, load-balancer-ip` à cadeia, inclusive com prefixos não validados; portanto o último endereço NÃO é necessariamente o IP individual do cliente. No Firebase Hosting pode haver intermediários compartilhados. O código atual pode atribuir uma mesma quota a múltiplos clientes. **Rever o algoritmo e homologar atrás dos reais caminhos Hosting, Function e CDN antes do deploy.** Não retornar a simplesmente confiar no primeiro XFF/CF.

**BLOQUEADOR 3: versão Cloud Run da Function desconhecida.** `/health` informa protocolo e versão funcional estática, mas não fornece o hash do código nem a revisão efetivamente em execução. O job de consulta GET não possui credenciais administrativas Firebase. Registrar no Console Google Cloud / Cloud Run a revisão `licensingApi` realmente ativa antes de fazer alteração.

**DEPENDÊNCIA DE HOMOLOGAÇÃO:** testes reais do cliente GuiaPlay .NET, trial/dispositivo de homologação, verificação de licença vitalícia e temporária, HTTP 429, comportamento offline, revisão de rollback. A CI não substitui essas etapas.

## 3. Próximos comandos somente de leitura no computador do desenvolvedor

**Execute na pasta já clonada, sem checkout ou reset, para não apagar trabalho local:**

```powershell
Set-Location "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing"
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
firebase --version
firebase hosting:sites:list --project guiasys-licensing
firebase hosting:channel:list --site guiasys-licensing-admin --project guiasys-licensing
firebase hosting:channel:list --site guiasys-licensing --project guiasys-licensing
firebase functions:list --project guiasys-licensing
```

Esses comandos NÃO publicam nada. Eles estabelecem o contexto necessário para identificar a revisão real e preservar trabalhos paralelos. Se `git status` listar arquivos modificados, preservar tudo e NÃO executar reset. Para checar a release candidata isoladamente, criar um worktree em pasta nova e verificar o SHA:

```powershell
git fetch origin
git worktree add --detach "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing-INT08" origin/fix/int08-firebase-preflight
Set-Location "E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing-INT08"
git rev-parse HEAD
node scripts/int08-firebase-preflight.mjs --pre
```

**Se a pasta de destino já existir, não sobrescrever.**

## 4. Plano de deploy FUTURO, não executado

Quando a origem da versão atual estiver identificada, o rate limiter estiver seguro para clientes distintos e a homologação de API/cliente estiver concluída:

1. Criar commit/release que preserve o conteúdo aprovado que **deve** continuar em produção; rodar CI exata e registrar SHA.
2. Salvar IDs das versões **Hosting** atuais nos dois sites (Console Firebase > Hosting > histórico); registrar a revisão Cloud Run/Functions v2 (Console Google Cloud), bem como as variáveis de ambiente e secrets **sem expor valores**.
3. Garantir caminho de rollback de Hosting e Functions. O Hosting oferece `Rollback` no Console; Functions exige estratégia própria de revisão/redeploy anterior.
4. Publicar `licensingApi` + `hosting:admin` da MESMA release com Firebase CLI. Não publicar `hosting:public` se não houver alterações aprovadas do catálogo.
5. Rodar `node scripts/int08-firebase-preflight.mjs --post`, `node scripts/smoke-production.mjs` e `node scripts/int05-integration-smoke.mjs` com integrationCode de projeto de homologação.
6. Verificar erros 5xx, 429 indevidos, licença/trial de testes e rollback.

Comando de deploy **não autorizado neste relatório** (para posterior release homologada):
```powershell
firebase deploy --only "functions:licensingApi,hosting:admin" --project guiasys-licensing
```

O rollback de Hosting pode ser feito pelo Firebase Console. A documentação Firebase ressalta que rollback de Hosting não reverte automaticamente código Functions nem regras.

## 5. Conclusão

**INT-08 teve sucesso na auditoria externa de saúde, mas encontrou bloqueios objetivos à publicação segura.** É inadequado relatar INT-08 como deploy concluído. O módulo de integração segue no GitHub e ainda não está no Hosting. Prioridade agora é identificar a procedência do que já está publicado e ajustar a política de rate limiting para não compartilhar quotas indevidamente.
