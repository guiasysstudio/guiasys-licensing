# INT-08.2 — Segurança e rate limiting atrás de Firebase Hosting

**Data:** 12/10/2026  
**Branch:** `fix/int08-consolidacao-c15-int07`  
**Estado do código:** implementação e testes automatizados concluídos.  
**Produção:** não houve deploy, mudanças em `main` ou alteração das políticas TTL do projeto real. **NO-GO para deploy até INT-08.3 e homologação em staging.**

## 1. Problema efetivamente encontrado

A função HTTP `licensingApi` é acessada por reescrita do Firebase Hosting, que usa infraestrutura de CDN e proxies. A borda Google pode acrescentar `X-Forwarded-For` ao tráfego. O último endereço do cabeçalho não garante o IP do usuário; pode ser a identidade do CDN. Confiar no primeiro valor permite spoofing de headers. Confiar no último como se fosse cliente faz usuários distintos consumirem a mesma quota pequena (429 indevido).

Também não podemos assumir que `CF-Connecting-IP` seja autenticamente definido pelo Cloud Run. Cabeçalhos `Origin`, `Referer`, `X-Request-Id`, `User-Agent`, `X-Forwarded-For` e um `uid` enviado no corpo **não são prova de identidade**.

Referências:
- Google Cloud — request headers: https://docs.cloud.google.com/functions/docs/reference/headers
- Google Cloud — load balancing XFF append: https://docs.cloud.google.com/load-balancing/docs/https
- Firebase Hosting serverless rewrites: https://firebase.google.com/docs/hosting/serverless-overview

## 2. Correções implementadas

Os limites foram separados em **dois níveis**:

1. **Teto de segurança por ingress**: `rateLimitIngressPeer` extrai só o último IP válido, sem acreditar em prefixos XFF/CF falsificáveis. Os limites desse teto são deliberadamente amplos para mitigar o risco de compartilhamento por um CDN. É um *backstop* de custo/tráfego, **não** uma quota por usuário.
2. **Quota granular**: `customer-api` e `cep-lookup` usam o UID somente **após** `requireFirebaseUser` validar criptograficamente as credenciais Firebase e a conta. `trial/start`, `trial/validate` e `license/activate`, `validate`, `deactivate` têm quotas granulares por projeto + identificador estável do dispositivo (e chave de licença normalizada, quando aplicável). O escopo público é informado pelo cliente e **não é prova criptográfica de identidade**. Por isso, o teto de ingress sempre é aplicado antes do processamento do escopo público.
3. **GETs anônimos** `/catalog`, `/catalog/:id`, `/payment-config` e `/project/config`: sem identidade autenticada não existe quota individual confiável. Permanecem somente com teto amplo no ingress.
4. **Firestore:** `rateLimits` continua usando documento com ID derivado por SHA-256; campos sensíveis brutos não são armazenados. Adicionado `expireAt` como `Date`, que o Firebase Admin SDK persiste como Timestamp. Retenção prevista: fim da janela + 48 h. Versionado `firestore.indexes.json` com `fieldOverrides: [{ collectionGroup: "rateLimits", fieldPath: "expireAt", ttl: true, indexes: [] }]`, para limitar o armazenamento de alta cardinalidade de rate limits. **A política versionada só passa a valer no Firebase quando implantada explicitamente**, e exclusões TTL são assíncronas.
5. **Sem mudança** em PIX, cadastro, preços, regras deny-all, hosting público/admin, mecanismos de autenticação, licença/trial de negócios ou endpoints de pagamento.

### Limites da nova implementação

| Rota / família | Cota granular | Teto ingress (por minuto) |
|---|---|---|
| `/api/v1/catalog` | Não há identidade individual confiável | 6000 |
| `/api/v1/catalog/:id` | Não há identidade individual confiável | 6000 |
| `/api/v1/payment-config` | Não há identidade individual confiável | 3600 |
| `/api/v1/project/config` | Não há identidade individual confiável | 3600 |
| `/api/v1/customer/**` | UID verificado: 180 / minuto | 3600 |
| `/api/v1/customer/address/cep` | UID verificado: 30 / minuto (além da família customer) | herda customer |
| `/api/v1/trial/start` | Projeto/dispositivo: 10 / 10 min, 30 / hora | 1200 |
| `/api/v1/trial/validate` | Projeto/dispositivo: 120 / 5 min | 2400 |
| `/api/v1/license/activate` | Projeto/chave/dispositivo: 30 / 10 min | 1200 |
| `/api/v1/license/validate` | Projeto/chave/dispositivo: 180 / 5 min | 3600 |
| `/api/v1/license/deactivate` | Projeto/chave/dispositivo: 30 / 10 min | 1200 |

Os tetos foram escolhidos como salvaguardas provisórias, não derivam de medições reais de tráfego/usuários e **podem precisar de ajuste**. Também existem custos e contenção de Firestore por cada chamada; não são um WAF ou um bloqueio absoluto a DoS. Um atacante pode variar recursos públicos falsificados para contornar quotas granulares, sujeito aos tetos amplos. Para ameaças avançadas e crescimento, usar Cloud Armor/edge protection, monitoramento de custo, App Check onde compatível com a plataforma, e/ou credenciais por cliente emitidas pelo backend.

## 3. Evidências de CI

- **Backend Security Tests**, run **38316819808** (código `b7197a53c355fd9401f3c3306bfde40d29864a5d`): **317/317 testes aprovados**, 0 falhas; auditoria de dependências de produção sem vulnerabilidades; `npm run check` e sintaxe frontend aprovados.
- **Firebase Config Check**, run **38316713429** (config TTL `ead662a3468fe5ecbdb4f63ac033c2927110abdc`): aprovado.
- Novos testes `worker/tests/int08-shared-ingress.test.mjs`: dois clientes com o mesmo proxy e dispositivos diferentes, prefixo XFF adulterado, 429 por dispositivo, CEP por UID, licença por dispositivo, omissão/malformação de sujeito, TTL Timestamp e regras de índice.
- Preservados os testes de segurança e negócio da C15.3 e da INT-08.1.

**Não** foram realizados testes ativos de estresse sobre a produção. Os testes são locais/CI e os checks Firebase Config são sem deploy.

## 4. Homologação indispensável antes do deploy

1. Verificar política TTL de produção **somente leitura**:  
   `gcloud firestore fields ttls list --collection-group=rateLimits --project=guiasys-licensing`
2. Preparar projeto/ambiente Firebase **isolado**, com autenticação e Firestore de teste, sem dados comerciais reais. Aplicar e aguardar ativação da política TTL `rateLimits.expireAt` nesse ambiente, verificar com a CLI.
3. Com dois clientes de redes distintas (Wi-Fi e rede móvel) passando pelo **Hosting real do ambiente de homologação**, confirmar cotas independentes por UID e projeto/dispositivo. Usar projeto/licenças de teste, nunca licenças compradas por clientes.
4. Simular `X-Forwarded-For`, `CF-Connecting-IP`, troca de IP e acesso direto ao endpoint Functions. Confirmar que prefixos falsificados não mudam o bucket coarse e não permitem falsificar uma identidade Firebase validada.
5. Avaliar volume/custo de writes em `rateLimits`, falsos HTTP 429, retries, TTL deletion, quota por dispositivo compartilhado e clientes legítimos com IP de CDN compartilhado.
6. Confirmar `Retry-After`/mensagens e estratégias de backoff no GuiaPlay e no portal; revisar Cloud Run logs e Cloud Monitoring.
7. Registrar imagem/revisão atual do backend para rollback: `licensingapi-00016-lij`, digest `sha256:023a9297bd14f1fe428ff3f72abd724ce3bd7716f637d5c91348f2188b06907c`.
8. Reconciliação do frontend e versões Hosting ainda pendentes em INT-08.3; publicação só após todos os gates e autorização explícita.

**ATENÇÃO:** apenas `functions:licensingApi,hosting:admin` não aplica a nova configuração `firestore.indexes.json`. A política TTL precisa ser habilitada em uma implantação/ação específica de índices antes de habilitar o backend atualizado em produção. Não executar deploy parcial silenciosamente.

## 5. Conclusão

**INT-08.2 (implementação + testes de segurança) concluída.** O risco original de usuários autenticados/devices independentes consumirem a mesma quota *pequena* sob um CDN compartilhado foi mitigado na lógica de quotas granulares. Não há evidência para afirmar que clientes reais jamais terão 429 compartilhado: os tetos globais amplos ainda podem bloquear todos os usuários de um ingress em tráfego extremo. Não é possível comprovar segurança do acesso via Firebase Hosting com testes de memória somente. **Gate de produção segue NO-GO até homologação real em staging e INT-08.3.**
