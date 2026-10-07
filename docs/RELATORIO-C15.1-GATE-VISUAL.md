# Relatório C15.1 — Assets oficiais e gate visual

Data: 7 de outubro de 2026  
Branch: `feat/c15-public-commerce-portal`  
HEAD inicial: `daf2bfac313db54881209c17827633b7a58202ae` (`daf2bfa`)  
HEAD técnico validado: `43fe90e`  
HEAD final da entrega: commit documental que contém este relatório; hash exato registrado no handoff após o push (um commit não pode gravar o próprio hash).  
Escopo: integração dos SVGs oficiais, gate visual/funcional da C15 e correções pontuais. Nenhum deploy, merge ou release foi executado.

## Estado de entrada

- `git fetch origin --prune --tags` executado.
- Branch correta e working tree inicialmente limpa.
- HEAD de entrada conferido com o esperado.
- Os três SVGs oficiais já existiam e seus desenhos internos não foram modificados.

## Assets oficiais

- `guiasys-licensing-symbol.svg`: favicon do portal e do Admin, boot do Admin e marca compacta do header público em telas de até 560 px.
- `guiasys-licensing-lockup.svg`: header desktop, hero, autenticação, footer, login e sidebar do Admin.
- `guiasys-licensing-wordmark.svg`: preservado e incluído nas duas distribuições de Hosting; não foi aplicado onde duplicaria o lockup.

Os SVGs mantêm formato vetorial, `viewBox`, proporção e aspect ratio. Como o grafite faz parte dos desenhos oficiais, a aplicação em tema escuro usa superfície clara da paleta, sem alterar internamente os arquivos.

## Correções realizadas

- Removidos placeholders `GS` e textos de identidade pendente das superfícies públicas e administrativas.
- Aplicada ao Admin a identidade dourada/grafite oficial, preservando verde, vermelho e amarelo para estados semânticos.
- Adicionados favicon oficial, metadados Open Graph básicos e `theme-color` oficial.
- Corrigida a exibição simultânea do SVG do hero e do fallback por conflito com o atributo `hidden`.
- Ajustado o uso do lockup no hero, nas telas de autenticação e no footer.
- Mantido o símbolo compacto no header mobile e o lockup no desktop.
- Reordenado o detalhe do programa para deixar os planos no final, após conteúdo, requisitos e screenshots.
- Corrigidos overflow e quebra de keys/status em Minhas Compras no mobile.
- Tornado o toast responsivo e sem interceptação de ponteiro.
- Substituído o ponto provisório do avatar pelo fallback de inicial do nome/e-mail.
- Limitados altura e overflow do menu público mobile.
- Eliminado overflow horizontal latente provocado pela sidebar off-canvas do Admin.
- Incluída a pasta de marca oficial no staging Admin e os três SVGs na allowlist do staging público.
- Atualizada a documentação local dos assets oficiais.

## Gate visual e funcional

Método: revisão em Microsoft Edge headless com servidor/harness local e dados mockados apenas em memória. O conector de controle visual não expunha navegador ou aplicação nesta sessão, portanto a revisão foi executada por automação local com as dimensões exatas abaixo. Nenhum dado de produção foi alterado.

### Desktop — 1440 × 900

- Portal público: Home, Programas, detalhe, carrinho, login, perfil, favoritos e compras revisados sem overflow horizontal (`scrollWidth = 1440`).
- Header, hero, cards, planos, footer, logos e estados de conta permaneceram alinhados e legíveis.
- Admin: login e configurações comerciais do projeto revisados; sidebar, formulário, uploads e identidade oficial sem corte (`scrollWidth = 1440`).

### Tablet — 768 × 1024

- Portal público revisado sem overflow horizontal (`scrollWidth = 768`).
- Menu, cards, formulários, carrinho, conta e keys permaneceram dentro do viewport.
- Admin inicialmente apresentou largura de documento de 905 px por causa da sidebar fora da tela; após a correção, `scrollWidth = 768` e `scrollX = 0`.

### Mobile — 390 × 844

- Portal público revisado sem overflow horizontal (`scrollWidth = 390`).
- Símbolo oficial exibido no header compacto; menu, carrinho, avatar e badge acessíveis.
- Home, Programas, detalhe, planos, carrinho, login, perfil, favoritos e compras revisados sem texto/botão fora da tela.
- Admin inicialmente apresentou largura de documento de 596 px; após a correção, `scrollWidth = 390` e `scrollX = 0`.
- Menu Admin aberto e validado com sidebar de 280 px, lockup oficial visível e documento ainda limitado a 390 px.

### Matriz por área

- Home: hero com lockup oficial, CTA para `/programas`, título “Programas em destaque”, cards sem preço/plano e seção institucional.
- Programas: cards com logo, nome, descrição, favorito e CTA; regra de projeto/plano publicada preservada e coberta pelos testes existentes.
- Detalhe: identidade, conteúdo, recursos, requisitos, screenshots e planos no final.
- Carrinho: adicionar permanece na página, comprar agora navega a `/carrinho`, quantidade e total atualizam, remoção restaura o estado vazio e badge permanece sincronizado.
- Checkout PIX: fluxo manual existente preservado; nenhuma alteração em BR Code, CRC16, TXID, WhatsApp, fulfillment ou idempotência.
- Auth: login, cadastro e recuperação com lockup oficial; Auth Emulator validou cadastro, senha e recuperação.
- Perfil: campos, validações, responsividade e área de foto revisados.
- Favoritos: cards, remoção, abertura e estado vazio revisados.
- Compras: pedido, linhas, status, valores, múltiplas keys e ação de copiar revisados; duas licenças distintas foram exibidas sem corte.
- Admin/CMS: login, sidebar e campos comerciais (identidade, slug, mídias, textos, listas, destaques, ordenação e SEO) revisados; módulos existentes permaneceram disponíveis.
- Uploads: controles, previews/estado atual, troca/remoção e mensagens existentes revisados; validação de MIME, extensão, assinatura e autenticação permaneceu coberta por testes.
- Estados vazios/erros: carrinho, favoritos e ausência de conteúdo revisados sem `undefined`, `null`, IDs técnicos ou stack traces na interface.
- Acessibilidade: foco visível, contraste, labels, alvos de toque, semântica do toast, menu e botões revalidados pela suíte e pelo gate.

### Evidências funcionais do navegador

- “Adicionar ao carrinho”: permaneceu no detalhe, badge `2 → 3` e toast “GuiaPlay — Semanal adicionado ao carrinho.”.
- Quantidade: `2 → 3`, badge 3 e total `R$ 29,70` atualizados imediatamente.
- Remover item: carrinho vazio e badge numérico oculto.
- “Comprar agora”: navegação para `/carrinho`.
- Remover favorito: estado vazio apresentado.
- Copiar key: toast “Chave copiada.”.
- Nenhum erro de página foi observado nos viewports revisados.

## Validações automatizadas

- `npm --prefix worker test`: **196/196 testes aprovados**.
- A base esperada era 195. A contagem passou para 196 porque foi adicionado um teste dedicado à paleta oficial do Admin e à preservação das cores semânticas; o teste existente do portal também foi ampliado para conferir os três SVGs e os ajustes responsivos.
- `npm --prefix worker run check`: aprovado.
- Sintaxe: `public/assets/catalog.js`, `assets/js/app.js` e `assets/js/entitlement-verifier.js` aprovados.
- `node scripts/verify-firebase-config.mjs`: aprovado.
- `git diff --check`: aprovado.
- `npm audit --prefix worker --omit=dev --audit-level=moderate`: indisponível porque `worker` não possui lockfile (`ENOLOCK`); nenhum lockfile artificial foi criado nesta etapa.

## Emuladores e Rules

Bateria sequencial concluída com código de saída 0 usando Firebase CLI 15.32.1 e OpenJDK 25.0.2:

- Auth Emulator: cadastro, login por senha e recuperação aprovados.
- Functions Emulator: raiz e health da Function v2 aprovados.
- Firestore/Storage Rules: suítes gerais e C15 aprovadas.
- Firestore Transactions: suíte transacional aprovada.
- C14-C Firestore/Storage: concorrência, preço server-side, ownership, RBAC, estados do pagamento, catálogo, perfil, fulfillment, carrinho, favoritos e compras aprovados.
- PagBank nos emuladores: zero chamadas de rede e execução sem `PAGBANK_TOKEN`.

## Builds locais

- Hosting público: staging e verificação aprovados, com 8 arquivos permitidos.
- Hosting Admin: staging e verificação aprovados, com 8 arquivos permitidos.
- Nenhum Hosting, Function ou Rules foi publicado.

## Pagamentos

- `PAYMENT_PROVIDER=manual_pix` confirmado.
- `PAGBANK_ENABLED=false` confirmado.
- PagBank permaneceu congelado, sem chamadas externas e sem exigir token.
- Secrets históricos não foram alterados.

## Commits técnicos

- `0eb1f80` — `style(branding): integrate official GuiaSys Licensing identity`
- `43fe90e` — `test(c15): validate official assets and responsive gate`
- Commit documental: contém este relatório e é identificado no handoff final.

## Pendências

Não há pendência técnica conhecida dentro do escopo C15.1. A etapa para no push da branch para revisão humana, sem deploy, merge ou release.
