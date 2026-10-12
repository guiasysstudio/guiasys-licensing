# INT-08.1 — Consolidação de backend sobre C15.3

**Data:** 12/10/2026 · **Estado:** backend consolidado e testes automáticos aprovados; **NÃO LIBERADO para deploy**.

## Bases imutáveis verificadas

- **C15.3 (base preservada):** `fix/c15-auditoria-completa` — `8b47c95aa9938f06e6eb0de234057fcc93cd7354`.
- **Fonte da integração:** `fix/int07-integration-only-rc` — `4cc23fb0c50adedc22a0a8f8b54c763a8a4cec6c`.
- **Destino isolado:** `fix/int08-consolidacao-c15-int07`, criada da C15.3.
- O ZIP GCF v2 de produção da revisão `licensingapi-00016-lij` foi obtido e sua integridade MD5 confirmada externamente pelo responsável; **17/17 arquivos `worker/src` + `worker/package.json` rastreados coincidiram com a C15.3**, no escopo dessa comparação. Não implica identidade do catálogo/Hosting nem de todo o ZIP.
- Backups Hosting em canais `int08-backup-20261012` foram confirmados externamente, mas são temporários e não incluem Firestore/Functions.

## Mudanças aplicadas na INT-08.1

1. **`worker/src/index.js`: transplante cirúrgico do código de integração** (somente aprox. 29 adições e 7 remoções sobre C15.3):
   - `publicSigningJwk` retira atributos privados/legados da resposta JWK pública e garante somente `kty,crv,x,y,ext,key_ops`.
   - sanitização de JWK na geração de material e nos contratos `/project/config` e visão do Admin;
   - quando informados simultaneamente, `projectId` e `integrationCode` devem designar o mesmo projeto, com erro `project_selector_mismatch` sem escrita de migração;
   - extração da identidade do ingress no helper isolado `rateLimitIngressPeer` em lugar de `CF-Connecting-IP` ou prefixo XFF livre.
2. **`worker/src/activity-policy.js`:** idempotência transacional de validação para sequência A→B→A, retenção limitada a 64 IDs por sete dias; compatibilidade com `lastValidationRequestId` legado.
3. **`worker/src/rate-limit-identity.js`:** helper conservador importado da INT-07; **não está homologado para publicação** em CDN / Firebase Hosting compartilhado.
4. **`worker/package.json`:** `npm run check` abrange a nova dependência JS.
5. **Testes existentes C15.3 preservados e ampliados:** `activity-policy.test.mjs`, `c12-regression.test.mjs`; novo `int06-rate-limit-identity.test.mjs`. Foram transferidos somente os cinco hunks de testes INT-07 que se aplicaram sem conflito à base C15.3; **não** foi substituído o arquivo C15.3 por um teste antigo.
6. Teste de key pinning no frontend adiado: na INT-08.1 a verificação exercita assinatura criptográfica inválida, não o erro específico `untrusted_signing_key` do browser, ainda não implementado nesta branch. Testes INT-03/INT-04 do frontend aguardam a integração da interface.

## Evidências

- GitHub Actions **Backend Security Tests** em `498fb6fa42645cfaf102330cf64307621607ebce`, run **38315814301**: **308/308 testes aprovados**, 0 falhas, `npm audit --omit=dev` sem vulnerabilidades, sintaxe backend e frontend OK.
- GitHub Actions **Firebase Config Check** em `89b4209398898b1b703e6bf4dd8f9b9b01d9a88b`, run **38315694256**: aprovado. Não houve mudança posterior de regras/Hosting/firebase.json.
- Diff final ANTES deste documento: **somente sete arquivos em `worker/**`**, com *ahead* de oito commits em relação à C15.3 e nenhuma alteração em `assets/**`, `public/**`, `firebase.json`, pagamento PIX ou regras. Nenhuma branch fonte alterada.
- Falhas intermediárias no CI antes de encerrar a inclusão de testes foram corrigidas; último commit de código passou 308/308.

## Bloqueadores reais para publicação

**INT-08.2 — Identidade/rate limit:** `rateLimitIngressPeer` usa o último IP do XFF, que pode ser endereço de balanceador compartilhado. Clientes independentes podem compartilhar quotas e obter 429 indevido; o helper não prova identidade de usuário. Antes de deploy, desenhar uma identidade comprovadamente confiável para Firebase Hosting/CDN e testar spoofing / limites com dois clientes independentes. O código anterior da C15.3 confiava em `CF-Connecting-IP` ou primeiro XFF, também não seguro para cabeçalhos manipuláveis. A existência de testes unitários para ambos os casos não valida o comportamento real no ingress Google.

**INT-08.3 — Frontend e integração GuiaPlay:** novos contratos do gerador e `assets/js/entitlement-verifier.js` de INT-07 ainda **não** estão na branch de consolidação; as diferenças de produção com Hosting exigem reconciliação. Verificar pinning de chave, comportamento offline, identidade estável do dispositivo e fluxos de clientes reais em staging. O novo `integration-contract-support.js` segue não publicado.

**Gate operacional:** identificar rollback testável do backend (revisão `licensingapi-00016-lij`, imagem `sha256:023a9297bd14f1fe428ff3f72abd724ce3bd7716f637d5c91348f2188b06907c`) e preservar estado Firestore/comércio. Os canais de backup Hosting não equivalem a backup de backend. Não publicar a branch INT-08.1.

## Conclusão

**INT-08.1 encerrada no escopo de consolidação do backend e testes unitários.** Ainda **NO-GO** para release de produção por bloqueios INT-08.2/08.3. A saída correta desta etapa é uma branch backend C15.3 + integração e sem qualquer modificação no sistema comercial em produção.
