# Relatório C14-C — PIX manual / PagBank congelado

Data da execução: 2026-10-06

Projeto Firebase auditado: `guiasys-licensing`

Branch de implementação: `feat/c14c-manual-pix-checkout`

## Estado inicial

- Branch base: `feat/c14b-pagbank-production`.
- HEAD/base validado: `550ba7d7162a074e418e41c8112e124f8c65eba3`.
- A branch local e `origin/feat/c14b-pagbank-production` apontavam para o mesmo commit.
- O `git status` inicial estava limpo; nenhuma alteração local precisou ser preservada ou descartada.
- Foi executado `git fetch origin --prune --tags` antes de qualquer edição.
- Não foi usado `reset --hard` e nenhum trabalho preexistente foi sobrescrito.

## Backup da C14-B

O estado PagBank foi congelado antes da implementação:

- branch local/remota: `backup/pre-manual-pix-2026-10-06`;
- tag anotada local/remota: `backup-pre-manual-pix-2026-10-06`;
- branch e tag dereferenciada apontam para `550ba7d7162a074e418e41c8112e124f8c65eba3`;
- ZIP criado por `git archive` em `E:\Projetos\GuiaSys\GuiasysLicensing\GuiaSys-Licensing-BACKUP-PRE-MANUAL-PIX-2026-10-06.zip`;
- tamanho validado: 201.159 bytes;
- SHA-256: `9199DBF90654832BE8D61C29481F95B5C99D11A395A806C0F99E7B85468A1650`.

O ZIP representa apenas arquivos versionados do commit e, portanto, não inclui `.env`, tokens ou secrets locais.

## Arquitetura entregue

### Provider e kill switch

- Provider operacional: `manual_pix`.
- Defaults de runtime: `PAYMENT_PROVIDER=manual_pix` e `PAGBANK_ENABLED=false`.
- O PagBank permanece no repositório, inclusive adapters, webhook, normalização, testes e documentação histórica.
- A Function não declara nem lê `PAGBANK_TOKEN`/`PAGBANK_SANDBOX_TOKEN` nesta versão; apenas `ADMIN_FIREBASE_UID` permanece vinculado como secret.
- Webhooks PagBank encerram com `pagbank_disabled` antes de token, assinatura, Firestore, fulfillment ou chamada de rede.
- A reconciliação PagBank administrativa também fica bloqueada.
- Os testes históricos C14-B definem os dois opt-ins explicitamente e continuam cobrindo o código congelado.

### Configuração PIX

`platformSettings/payments` armazena a configuração editável. O formulário administrativo em **Configurações > Pagamentos** exige `managePlatformSettings`; alterações exigem autenticação recente e registram auditoria. Na ausência do documento, o backend usa os valores de bootstrap solicitados e qualquer gravação administrativa passa a prevalecer:

- `paymentProvider=manual_pix`;
- `pixEnabled=true`;
- `pixKeyType=EVP`;
- `pixKey=821fee6e-dbdd-46ea-adfc-8afffc89d422`;
- `pixDisplayName=GuiaSys`;
- `pixMerchantName=Andrew Lindolfo`;
- `pixMerchantCity=JI PARANA`;
- `pixWhatsapp=5569993082084`;
- `manualConfirmationEnabled=true`.

O endpoint público expõe somente a projeção necessária ao pagamento. Não há token, credencial administrativa ou configuração interna na resposta.

### Pedidos e preço

- O frontend envia somente IDs e quantidade; projeto, plano, disponibilidade, preço, duração e limite de dispositivos são carregados no backend.
- Subtotal e total são calculados em centavos e gravados também na representação decimal solicitada.
- `counters/orders` é incrementado na mesma transação de criação e gera `GS-000001`, `GS-000002`, etc.; não existe `count + 1`.
- O pedido guarda snapshots de cliente, produto, plano, duração, provider/método, TXID e campos de fulfillment.
- Renovações usam o mesmo fluxo financeiro e o mesmo núcleo de licenciamento.

### BR Code, TXID e QR Code

- TXID: `GS` + 23 caracteres hexadecimais maiúsculos derivados por SHA-256 do `orderId`; tem 25 caracteres válidos e é determinístico por pedido.
- BR Code EMV inclui PFI, GUI `br.gov.bcb.pix`, chave EVP, MCC, moeda 986, valor exato, país BR, merchant name/city normalizados, TXID e CRC16/CCITT-FALSE.
- `qrcode@1.5.4` gera PNG localmente; o input da biblioteca é exatamente o mesmo texto devolvido como PIX Copia e Cola.
- Não há API bancária, PagBank ou serviço remoto de QR Code no fluxo.

## Fluxo do cliente

1. Cliente autenticado e com e-mail verificado seleciona projeto/plano.
2. O backend valida a oferta e cria o pedido.
3. O checkout cria/reutiliza o pagamento manual idempotente.
4. A tela mostra identidade GuiaSys, pedido, produto, plano, valor, aviso sobre o titular real, QR Code, Copia e Cola, chave e botões de cópia.
5. “Já efetuei o pagamento” chama o backend com corpo vazio.
6. Somente `pending_payment -> payment_reported` é permitido; a operação repetida não regride nem duplica auditoria.
7. Só depois da resposta do backend o navegador abre `wa.me`, com mensagem pronta para o cliente enviar manualmente.
8. “Minhas Compras” traduz estados, permite continuar pedidos pendentes, mostra espera de confirmação e, após fulfillment, a licença e o botão de cópia.

## Fluxo administrativo

O módulo **Vendas / Pedidos** possui filtros Todos, Aguardando PIX, Pagamento informado, Pagos e Cancelados, com contadores. A listagem mostra pedido, cliente/e-mail, produto, plano, valor, data, status e TXID.

Os detalhes incluem UID, WhatsApp, duração, payment reported, licença e auditoria. Apenas `payment_reported`, para administrador com `viewOrders` + `manageOrders`, escopo compatível e autenticação recente, apresenta **CONFIRMAR PAGAMENTO E LIBERAR LICENÇA**.

Após fulfillment aparece **AVISAR CLIENTE PELO WHATSAPP**. Com telefone válido, o navegador abre a conversa; sem telefone, a mensagem é copiada e a UI informa o fallback. Não existe envio automático nem WhatsApp Business API.

## Fulfillment e licenciamento

`finalizePaidOrder()` continua sendo o único núcleo de fulfillment. Na confirmação manual ele revalida pedido, payment, conta, provider, valor e moeda dentro do caminho server-side. A transação:

- marca payment como pago e registra admin/horário;
- avança o pedido por `paid -> fulfilling -> fulfilled`;
- emite nova key ou renova a mesma key conforme o snapshot do item;
- cria os vínculos da conta e do pedido;
- grava `licenseId`, resultados e timestamps;
- registra `payment_confirmed` e `license_issued`/`license_renewed`.

Se a requisição for repetida, `fulfillmentStatus=fulfilled` encerra o replay sem nova licença, renovação ou logs críticos.

Trial, configuração de projeto, ativação, validação, desativação, licenças manuais, clientes, planos e códigos de integração continuam usando os contratos existentes `GSL-v1`; não foi criado um segundo sistema de keys.

## Segurança

- Operações financeiras e de licenciamento são executadas pela Function.
- Firestore Rules continuam `allow read, write: if false` para clientes; Storage também permanece deny-all.
- Ownership é derivado do Firebase ID Token e das referências da conta, nunca de `customerUid` enviado.
- O endpoint `payment-reported` rejeita campos extras; o cliente não consegue enviar `paid`, valor, UID, licença ou timestamps.
- Confirmação exige admin, permissão, escopo e autenticação recente.
- Dados de auditoria não incluem token, credencial, payload bruto ou secret.
- As CSPs já permitem imagens `data:` necessárias ao QR Code e mantêm os demais hardenings.

## Arquivos alterados

- Backend: `worker/src/index.js`, `worker/src/commerce-policy.js`, `worker/src/firebase-entry.js`.
- PIX: `worker/src/payments/manual-pix.js`, `worker/package.json`.
- Cliente: `public/index.html`, `public/assets/catalog.js`, `public/assets/catalog.css`.
- Admin: `assets/js/app.js`.
- Testes: `worker/tests/c14c-manual-pix.test.mjs`, `backend-runtime.test.mjs` e testes históricos C14-B.
- Documentação: `README.md`, `CHANGELOG.md`, `docs/COMMERCE.md`, `docs/PAYMENTS.md`, este relatório e a mensagem do verificador Firebase.

## Validações e resultados

- `npm test`: 187/187 testes aprovados, incluindo C14-C e regressões de trial/licenciamento.
- `npm run check`: sintaxe do backend aprovada.
- `node --check` nos frontends público e administrativo: aprovado.
- parser TLV independente: PFI, Merchant Account Information, GUI, EVP, moeda, R$ 50,00, país, merchant, cidade, TXID e CRC16 aprovados.
- teste de igualdade QR/Copia e Cola: aprovado.
- teste PagBank congelado/startup sem token: zero chamadas de rede, aprovado.
- `scripts/verify-firebase-config.mjs`: aprovado.
- preparação e verificação dos dois artefatos Firebase Hosting: aprovadas.
- `git diff --check`: aprovado.

O emulador Firebase não pôde iniciar nesta estação porque Java não está instalado/no PATH (`spawn java ENOENT`). A suíte de transações com mocks e o adapter Firestore passaram, mas `emulators:exec` deve ser repetido em CI ou máquina com Java antes do deploy. A tentativa de inspeção visual automatizada no navegador local também ficou indisponível por incompatibilidade do runtime da ferramenta de browser; sintaxe, testes estáticos, CSP e builds do Hosting passaram.

## Pendências operacionais

- Revisão humana da branch e do conteúdo/identidade visual em navegador real.
- Repetir os dois gates de emulator com Java disponível.
- Após aprovação, executar deploy em uma etapa separada e autorizada; nenhum deploy foi feito nesta tarefa.
- Validar a chave/conta PIX com uma transação real de baixo valor antes do lançamento.

## Rollback

Nenhum merge ou deploy foi realizado. Para abandonar a C14-C, basta não integrar a branch. Para recuperar exatamente a base congelada:

```text
branch: backup/pre-manual-pix-2026-10-06
tag:    backup-pre-manual-pix-2026-10-06
commit: 550ba7d7162a074e418e41c8112e124f8c65eba3
```

O ZIP validado fornece uma cópia adicional independente do working tree. Um rollback de produção futuro deve usar o procedimento autorizado de deploy do commit/tag congelado; este relatório não executa esse deploy.

## Reativação futura do PagBank

Reativar não é apenas mudar um botão no painel. Exige uma tarefa técnica própria:

1. partir da C14-C revisada ou do backup e revalidar a documentação/whitelist PagBank;
2. revisar os adapters, `notification_urls`, assinatura de webhook, reconciliação e comportamento de produção;
3. recriar `PAGBANK_TOKEN`/`PAGBANK_SANDBOX_TOKEN` no Secret Manager e voltar a vinculá-los explicitamente em `firebase-entry.js`;
4. definir `PAYMENT_PROVIDER=pagbank` e `PAGBANK_ENABLED=true` somente no ambiente aprovado;
5. adaptar a configuração administrativa para aceitar `pagbank` deliberadamente;
6. executar toda a suíte C14-B/C14-C, emulator, homologação Sandbox e testes de zero duplicidade;
7. fazer revisão de segurança e deploy separado.

Até que todos esses passos sejam cumpridos, o PagBank deve permanecer congelado.
