# INT-05 — Gate final da integração GSL-v1

**Projeto:** GuiaSys Licensing  
**Data da revisão:** 12/10/2026  
**Branch:** `fix/int05-integration-release-gate`  
**Baseline:** `fix/int04-license-security-tests` (`963bbc57f6815cd6bb59251b1c477f148c8fe67b`)  
**Produção:** não alterada por INT-01–INT-05.

## 1. Objetivo e resultado

Finalizar a revisão estática e automatizada dos módulos de integração dos aplicativos com a API de licenças: contrato administrativo, configuração pública, geração/validação de JWS ES256, trial, ativação, validação, desativação e limites offline. **O gate de código pode ser aprovado sem significar aprovação para deploy**, porque a branch contém outras correções da C15.3 e o site em produção ainda tem baseline documentado distinto.

INT-05 acrescenta o teste de ponta a ponta **em memória** que consulta a configuração pública e verifica uma licença gerada pelo próprio backend usando a chave pública exposta pela API e fixada pelo cliente. Também reforça o teste de trial com chave fixada e comparação das datas assinadas.

## 2. Arquivos de integração e dependências aprovados

- `worker/src/index.js` — API, verificações, assinatura de autorizações, configuração e seleção do projeto.
- `worker/src/validation.js` — payloads e identificadores aceitos.
- `assets/js/entitlement-verifier.js` — parsing JWS, ES256, chave pública confiável, prazos, dispositivo e status.
- `assets/js/integration-contract-support.js` — sanitização da JWK e exemplos de respostas.
- `assets/js/app.js` — contrato gerado para seis tecnologias e simuladores do painel.
- `worker/tests/c12-regression.test.mjs`, `worker/tests/entitlement-verifier.test.mjs`, `worker/tests/int03-integration-contract.test.mjs`, `worker/tests/int04-jws-hardening.test.mjs` — regressões.
- `scripts/int05-integration-smoke.mjs` — verificação HTTP do ambiente após publicação autorizada; não ativa/desativa licenças, mas **/project/config pode preencher campos de migração de projetos legados**.
- `.github/workflows/worker-security-tests.yml` — verifica a sintaxe do script de smoke.

## 3. Evidências que constituem o gate de código

1. Os seis endpoints do GSL-v1 estão definidos no backend.
2. O módulo `signProjectEntitlement` assina JWS com chave privada interna e publica apenas JWK ES256.
3. Verificador recusa tokens alterados, formato inválido, contexto/chave não reconhecidos, janelas encerradas e dispositivo diferente.
4. Trial e licença expiram segundo campos assinados emitidos pelo servidor; licença vitalícia só dispensa `expiresAt`, não `offlineUntil`.
5. `integrationCode`, `projectId`, `deviceHash`, `typ`, `alg`, `kid` e assinatura precisam corresponder a dados previamente confiáveis.
6. A documentação do gerador diferencia validação periódica, tolerância offline e erro definitivo.
7. A CI executa 324 testes, além de lint/sintaxe e auditoria de dependências. O status final deve ser conferido na execução correspondente ao último commit antes de publicar.
8. Firebase Config Check da INT-04 foi aprovado; repetir verificação de configuração quando houver um commit de release consolidado.

## 4. Limites e riscos ainda não encerrados

- **O código de produção não é a HEAD da INT-05.** O relatório C15.3 informa explicitamente ausência de deploy daquela branch. Nunca interpretar um workflow verde como publicação.
- **Risco de regressão por deploy integral:** a INT-05 herda alterações da C15.3 não relacionadas à integração, algumas sob correção paralela. Não publicar esta branch diretamente sem conciliar a versão aprovada dessas áreas.
- **Rate limiting e cabeçalhos IP:** `enforceRateLimit()` utiliza `CF-Connecting-IP` ou o primeiro item de `X-Forwarded-For`; não há comprovação de confiança desses cabeçalhos em todos os caminhos de entrada. É uma limitação de defesa contra abuso da API, não uma prova de liberação de licença. Validar a configuração do proxy/ingress e planejar mitigação confiável antes de ampliar tráfego comercial.
- **Modo offline zero:** quando `offlineDays=0` ou `trialOfflineHours=0`, o token não oferece janela de cache offline; clientes devem distinguir autorização recebida online de permissão para uso offline. Não interpretar `ok:true` como garantia de cache reutilizável.
- **Revogação offline:** revogações só são conhecidas imediatamente com conexão; cache previamente assinado pode durar até `offlineUntil`.
- **Identidade de dispositivo:** o protocolo recebe `deviceId`; garantir persistência entre reinstalações e detectar fraude deliberada exige implementação específica em cada produto.
- **Rotação ES256:** implementar gestão de chaves e política de migração/expiração de entitlements antigos antes de rotacionar na produção.
- **Testes reais faltantes:** Windows/.NET GuiaPlay, Firebase com projeto real, trial real, ativação, renovação e operações de desativação (ambiente de homologação, não com licenças de clientes).

## 5. Gate para publicação

**Não executar deploy de `fix/int05-integration-release-gate` diretamente.**

Para autorizar produção:
1. Encerrar/conciliar o trabalho paralelo C15.3/Codex e identificar exatamente a branch de release que substituirá o estado documentado de produção.
2. Revisar o diff completo entre a release e o baseline implantado, em especial **checkout, PIX, autenticação, regras Firebase e catálogo**.
3. Rodar a suíte Node, os verificadores Firebase Hosting e a CI na branch de release final; registrar SHA exato.
4. Salvar a revisão anterior do Firebase Hosting e a identificação da revisão `licensingApi` para rollback.
5. Somente então implantar Functions e os targets necessários do Hosting na mesma release. Exemplo de comando **para release revisada**:
   `firebase deploy --only "functions:licensingApi,hosting:admin,hosting:public" --project guiasys-licensing`
6. Executar `node scripts/smoke-production.mjs` e, com `GUIASYS_INTEGRATION_CODE` de um projeto ativo já integrado, `node scripts/int05-integration-smoke.mjs`.
7. Verificar manualmente **Painel > Projeto > Integração > .NET / Windows / desktop**, incluindo cópia de JSON e documento, além de testes reais com licença de homologação.
8. Documentar versões efetivamente publicadas, data, SHA e rollback disponível.

## 6. Validação isolada no PC sem afetar a pasta em uso

Usar um **git worktree** separado para não modificar a pasta aberta pelo Codex:

```powershell
Set-Location 'E:\Projetos\GuiaSys\GuiasysLicensing\Guiasys-Licensing'
git fetch origin fix/int05-integration-release-gate
git worktree add --detach '..\Guiasys-Licensing-INT05' origin/fix/int05-integration-release-gate
Set-Location '..\Guiasys-Licensing-INT05'
npm --prefix worker install --no-audit --no-fund --package-lock=false
npm --prefix worker test
npm --prefix worker run check
node scripts/prepare-hosting.mjs
node scripts/verify-hosting-dist.mjs
node scripts/prepare-public-hosting.mjs
node scripts/verify-public-hosting-dist.mjs
node scripts/verify-firebase-config.mjs
```

O comando de deploy acima **não faz parte desta etapa de validação local**. Se a pasta do worktree já existir, conferir seu conteúdo e não sobrescrever dados.

## 7. Conclusão

A documentação, o protocolo GSL-v1 e os testes de integração foram revisados e a INT-05 contém uma ferramenta de smoke dedicada para o ambiente publicado. **A homologação no GitHub não substitui o deploy nem o teste real no GuiaPlay.** O gate de produção permanece fechado até finalizar a conciliação do trabalho paralelo, revisão do delta de produção e execução dos smokes no Firebase.
