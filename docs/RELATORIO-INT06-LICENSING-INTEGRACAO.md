# INT-06 — Segurança de rate limiting e idempotência

**Projeto:** GuiaSys Licensing  
**Data:** 12/10/2026  
**Branch isolada:** `fix/int06-rate-limit-idempotency`  
**Base:** INT-05, `8a0cf7a344a697b7b3cd1d3d32f7bbab721a4cee`  
**Publicação:** NÃO realizada.

## 1. Alterações implementadas

**Deduplicação de revalidações:** `worker/src/activity-policy.js` mantém `recentValidationRequests` no documento transacional do dispositivo/licença ou trial. Agora A → B → A não aumenta novamente o contador enquanto os IDs estiverem na janela. O histórico fica limitado a 64 IDs e 7 dias; **não é idempotência eterna**. O último requestId legado é migrado quando há referência temporal disponível. Não foram alteradas regras de plano, número de dispositivos, prazo de trial, licenças existentes ou checkout.

**Rate limiting:** `worker/src/rate-limit-identity.js` concentra a obtenção de identidade de ingresso. O código não confia em `CF-Connecting-IP` nem no primeiro `X-Forwarded-For`, ambos manipuláveis quando vêm do cliente. Usa o endereço IP sintaticamente válido na extremidade direita de `X-Forwarded-For`, que **somente é um candidato confiável quando o caminho do Google/Firebase efetivamente acrescenta seu hop**. Se não houver último hop aceitável, utiliza `unattributed`, que agrupa as requisições desconhecidas.

**Orientação de integração:** documentação do contrato copiado no painel informa janela de deduplicação e tratamento de HTTP 429 com backoff.

## 2. Testes adicionados

- A → B → A com mesmo dispositivo: licença e trial; contador não avança na repetição de A.
- Compatibilidade com registros antigos; histórico limitado a 64 entradas; expurgo após 7 dias.
- Request sem requestId continua aceito e contabilizado sem cache novo.
- Cadeias XFF com prefixo forjado, cabeçalho CF controlado pelo cliente, IPv4, IPv6, tokens inválidos, lista grande e ingress compartilhado.
- Suítes automatizadas: 333 testes aprovados e 0 falhas no GitHub Actions do código final de integração; incluir o status exato de cada nova revisão se o relatório mudar.

## 3. Ponto de atenção obrigatório antes do deploy: Firebase Hosting/CDN

**A proteção IP não pode ser declarada completamente homologada apenas com testes unitários.** Segundo a documentação do Google Cloud, intermediários podem acrescentar IPs a `X-Forwarded-For`. No Firebase Hosting, o último hop pode ser um proxy CDN compartilhado por vários visitantes. Nesse caso, o bucket do rate limiter também é compartilhado, provocando HTTP 429 para clientes distintos; e uma requisição direta à Function pode seguir outra topologia de encaminhamento.

Antes da publicação, conferir o comportamento real com:
1. Requisições ao domínio do painel, domínio público e endpoint nativo da Function em homologação.
2. Dois clientes distintos, verificando quotas de teste e ocorrência de falsos 429.
3. Prova de que cabeçalhos enviados pelo cliente não modificam o IP usado como chave do rate limiter.
4. Se a origem estiver compartilhada, estabelecer solução de identificação confiável do usuário/dispositivo e um limite grosseiro separado por ingress antes de liberar tráfego comercial.

**Sem esse teste e ajuste operacional, o controle de rate limiting permanece uma ressalva de produção, apesar da melhora contra spoofing textual.** Não fazer deploy cego.

## 4. Gate de publicação

O código está no GitHub e não foi implantado no Firebase. Esta branch herda C15.3; assim, **não executar `firebase deploy` diretamente nela**, pois pode incluir correções paralelas ainda não homologadas.

Ordem segura:
1. Concluir as outras correções do site e definir SHA de release.
2. Conciliar somente alterações relevantes de integração, verificar conflitos e revisar o diff desde a revisão efetivamente publicada.
3. Rodar testes, Firebase Config Check e builds públicos/admin na HEAD da release.
4. Validar a cadeia de proxies/rate limiting em homologação antes de produção.
5. Publicar Firebase Functions v2 e Hosting admin, preservando rollback; publicar Hosting público apenas se exigido pelo diff de release.
6. Rodar o smoke do site, `scripts/int05-integration-smoke.mjs` com integração ativa e testes reais .NET/GuiaPlay com dados de homologação.

## 5. Conclusão

A idempotência recente foi corrigida nos caminhos de trial e licença. O rate limiting deixou de utilizar o primeiro XFF/CF como identidade, mas necessita observação do ingress Firebase em ambiente real para garantir segurança **e disponibilidade**. INT-06 é aprovada no âmbito dos testes de código e **não autoriza por si só o deploy de produção**.
