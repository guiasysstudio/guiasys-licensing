# Relatório C15 — Portal público / e-commerce completo

Data da validação: 6 de outubro de 2026
Projeto Firebase: `guiasys-licensing`
Site público futuro: `https://licencas.guiasys.online`
Painel futuro: `https://painel.licencas.guiasys.online`

## Estado de origem

- Branch base: `feat/c14d-production-gate`
- Commit base validado: `e2651c917fc5e37db9cec9159ada3904c30770d9`
- Branch de implementação: `feat/c15-public-commerce-portal`
- A branch foi criada exatamente a partir do commit base e publicada no `origin` antes da implementação.
- Nenhum deploy Firebase, merge ou release foi executado na C15.

## Arquitetura

O portal continua no Firebase Hosting e é uma SPA em JavaScript modular, sem framework
adicional. O Hosting público mantém os rewrites de `/api/**` e `/health` para a
Function `licensingApi` e acrescenta fallback final para `/index.html`, permitindo
deep links sem interferir na API.

Toda operação privilegiada continua na Cloud Function/Firebase Admin SDK. Firestore e
Storage permanecem fechados para acesso direto do navegador. O frontend nunca é
autoridade de preço, status financeiro ou geração de licença.

## Rotas públicas

- `/`: Home, hero, programas em destaque, seção institucional e rodapé.
- `/programas`: catálogo de programas comercialmente visíveis.
- `/programas/:slug`: detalhe genérico do programa, conteúdo CMS e planos.
- `/carrinho`: carrinho, identificação e pagamento PIX manual.
- `/entrar`: login por Google ou e-mail/senha.
- `/cadastro`: cadastro por Google ou e-mail/senha, com confirmação de senha.
- `/recuperar-senha`: envio real via Firebase Authentication.
- `/conta/perfil`: perfil, endereço e foto.
- `/conta/favoritos`: favoritos da conta.
- `/conta/compras`: pedidos, itens, quantidades e licenças.
- `/termos` e `/privacidade`: páginas institucionais básicas.

O endpoint público `GET /api/v1/catalog/:slug` resolve somente slugs publicados; IDs
Firestore não funcionam como URL comercial.

## Catálogo e migração

A visibilidade passou a obedecer:

1. projeto com `status == active`;
2. pelo menos um plano ativo;
3. plano com `publishedInCatalog == true`.

O booleano legado `project.publicCatalog` não participa mais da decisão. Para dados
antigos, um plano sem `publishedInCatalog` ainda lê `plan.publicCatalog` como
fallback de compatibilidade. Assim que o plano é salvo pelo Admin, o novo campo vira a
fonte explícita e o legado é sincronizado somente para clientes antigos.

Projetos sem plano elegível desaparecem integralmente do catálogo e dos destaques.
`catalogOrder` ordena projetos/planos e `featuredOrder` ordena destaques. Slugs
novos são normalizados, verificados contra projetos existentes e protegidos por um
registro transacional em `catalogSlugs/{sha256(slug)}`.

## Schema comercial

Projetos agora aceitam:

- identidade: `name`, `slug`, `logoUrl`, `iconUrl`, `bannerUrl`;
- conteúdo: `tagline`, `shortDescription`, `fullDescription`,
  `commercialText`, `additionalInfo`;
- mídia/listas: `screenshots[]`, `features[]`, `requirements[]`;
- Home/catálogo: `featured`, `featuredOrder`, `catalogOrder`;
- SEO: `seoTitle`, `seoDescription`.

Planos agora aceitam `publishedInCatalog`, `catalogOrder`,
`commercialDescription` e `termsVersion`. Configuração comercial e configuração
técnica de licenciamento permanecem campos distintos.

## Admin/CMS e mídia

O editor de projetos foi ampliado com conteúdo comercial, mídia, listas, destaque,
ordenação e SEO. O editor de planos passou a usar `publishedInCatalog` como controle
único da oferta pública. A prévia considera o projeto publicado somente quando há
plano elegível.

Uploads administrativos usam:

- `commerce/projects/{projectId}/logo/{uuid}.{ext}`
- `commerce/projects/{projectId}/icon/{uuid}.{ext}`
- `commerce/projects/{projectId}/banner/{uuid}.{ext}`
- `commerce/projects/{projectId}/screenshot/{uuid}.{ext}`

Somente Admin com acesso ao projeto e `manageProjectSettings` pode enviar essas
mídias. JPG/JPEG, PNG e WebP são aceitos, com limite de 5 MiB, validação de MIME,
extensão e assinatura binária. O painel exibe todos os itens e quantidades do pedido,
preços snapshot, termos, total, cliente, status e TXID.

## Autenticação, perfil e foto

Firebase Authentication continua oferecendo Google e e-mail/senha. O portal também
implementa logout, verificação de e-mail e recuperação de senha.

A conta pode navegar, favoritar e montar carrinho incompleta. O backend bloqueia a
criação do pedido até que existam nome, CPF válido, telefone brasileiro com DDD, CEP,
logradouro, número, bairro, cidade e UF. O e-mail vem do Auth e é somente leitura.

Fotos usam `profiles/{firebaseUid}/avatar-{uuid}.{ext}`, limite de 2 MiB e as mesmas
validações de imagem. A foto Google é usada como fallback inicial; upload e remoção
ficam disponíveis no perfil.

## Carrinho e favoritos

O carrinho deslogado fica em `localStorage`. Após login ele é mesclado com o
carrinho da conta por `projectId + planId`, usando a maior quantidade em vez de
somar e criar duplicidade. Para usuários autenticados são persistidos apenas IDs e
quantidade em `customerAccounts/{accountId}/state/cart`; nenhum preço local é
autoridade.

`Adicionar ao carrinho` mantém a rota, atualiza badge e emite toast acessível.
`Comprar agora` adiciona pela mesma regra e navega para `/carrinho`. O badge fica
oculto com zero unidades. Quantidades e remoção recalculam a visão imediatamente.

Favoritos ficam em
`customerAccounts/{accountId}/favorites/{projectId}`. As APIs derivam a conta do
token, impedindo leitura ou escrita cruzada.

## Pedido, snapshot e PIX

Na criação do pedido o backend relê projeto e plano, recalcula `unitPriceCents` e
salva por item:

- `orderItemId`, `projectId`, `planId`;
- nomes snapshot;
- `unitPriceCents` e `unitPrice`;
- `quantity` e `lineTotalCents`;
- duração, vitaliciedade, dispositivos e regra de início;
- descrição comercial e versão dos termos comprados.

Alterações futuras do plano não modificam pedidos existentes. O checkout reutiliza
integralmente o provider `manual_pix`, BR Code, CRC16, QR Code, TXID, botão de
pagamento informado e WhatsApp. O cliente só pode avançar de
`pending_payment` para `payment_reported`; `paid` depende de confirmação Admin.

`PAYMENT_PROVIDER=manual_pix`, `PAGBANK_ENABLED=false`; não há dependência de
`PAGBANK_TOKEN` nem chamada PagBank no fluxo validado.

## Fulfillment e rastreabilidade

Cada unidade de um item gera uma licença independente. Quantidade 2 gera duas keys,
sem somar duração. Cada licença e referência de ownership registra `orderId`,
`orderItemId`, `customerUid`, `projectId` e `planId`. O resultado do pedido
também inclui o índice da unidade.

A transação e o estado `fulfillmentStatus=fulfilled` preservam idempotência:
repetir a confirmação não cria novas keys.

## Segurança e Rules

- Firestore Rules: deny-all para acesso direto; toda leitura/escrita passa pelo backend.
- Storage Rules: deny-all para acesso direto; uploads passam pelo backend autenticado.
- Preço, `customerUid`, status pago e fulfillment não são aceitos do cliente.
- APIs de conta usam o UID verificado para derivar `accountId`.
- Usuário comum não acessa APIs administrativas.
- Conteúdo comercial exige RBAC e escopo do projeto.
- URLs públicas são HTTPS sem credenciais.
- A renderização pública usa APIs DOM e não usa `innerHTML`.

O Emulator confirmou recusas reais de leitura/escrita direta em Firestore e Storage.

## Testes e builds executados

- Suíte Node completa: 195 testes (incluindo subtestes), todos aprovados.
- Suíte específica C15: 8/8 aprovada.
- `npm --prefix worker run check`: aprovado.
- Sintaxe dos frontends Admin e público: aprovada.
- Build/staging público e allowlist: aprovado.
- Build/staging Admin e allowlist: aprovado.
- Functions, Hosting, Firestore e Storage Emulator: inicialização aprovada.
- Functions Emulator: smoke HTTP real da raiz e de `/health` aprovado na Function v2.
- Auth Emulator: cadastro, login por senha e recuperação de senha aprovados.
- Firestore/Storage Rules Emulator: leitura e escrita direta recusadas.
- Testes de transação Firestore: aprovados.
- Fluxo integrado Firestore Emulator C14-C/C15: aprovado, inclusive concorrência,
  isolamento, RBAC, preço server-side, perfil, catálogo por slug, carrinho,
  favoritos, quantidade 2, idempotência, PIX manual e zero chamadas PagBank.
- `git diff --check`: aprovado.

## Assets oficiais pendentes

Nenhum dos três SVGs oficiais foi encontrado no repositório. Não foi criada uma
imitação. O fallback atual é técnico e se identifica como pendente.

Antes do deploy, inserir os arquivos originais, preservando seus `viewBox`, em:

- `public/assets/brand/guiasys-licensing-symbol.svg`
- `public/assets/brand/guiasys-licensing-lockup.svg`
- `public/assets/brand/guiasys-licensing-wordmark.svg`

O cabeçalho e o hero já referenciam os dois primeiros caminhos. A documentação do
diretório reserva também o wordmark sem exigir alteração estrutural.

## Pendências humanas e deploy futuro

1. Fornecer e revisar os três SVGs oficiais nos paths acima.
2. Preencher pelo Admin o conteúdo comercial definitivo, screenshots, SEO e versão
   dos termos dos produtos existentes.
3. Conferir textos jurídicos de Termos e Privacidade com o responsável legal.
4. Fazer revisão visual final em desktop/tablet/mobile com os assets oficiais.
5. Em etapa autorizada posterior, repetir testes/checks, preparar staging, revisar
   variáveis/secrets e executar o deploy Firebase dos targets apropriados.

Nenhum deploy, merge ou release integra esta entrega.
