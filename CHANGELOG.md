# Changelog

## 0.14.0 — 2026-10-04

### Firebase Hosting / C11
- Frontend migrado da dependência operacional de GitHub Pages/Cloudflare para Firebase Hosting + Functions v2.
- API base do painel passa a usar `window.location.origin`.
- Rewrites `/api/**` e `/health` apontam para `licensingApi` em `southamerica-east1`.
- Rewrites do Hosting não usam `pinTag`; Functions e Hosting são implantados separadamente para evitar mutação de tags/tráfego do Cloud Run durante a finalização.
- Hosting convertido para multi-site: `public` -> `guiasys-licensing` e `admin` -> `guiasys-licensing-admin`.
- Painel administrativo passa a usar staging `.hosting-admin-dist/` com allowlist estrita de `index.html` e `assets/`.
- `licencas.guiasys.online` fica reservado ao portal público e `painel.licencas.guiasys.online` ao painel administrativo.
- Removido `CNAME` do GitHub Pages.
- Adicionados headers de segurança e política explícita de cache.
- Emulador Hosting configurado na porta 5000.
- CI permanece apenas para testes/validações; o deploy de produção não é executado pelo GitHub Actions.
- Deploy de produção é manual via Firebase CLI autenticada localmente; WIF não faz parte do fluxo.
- Cloudflare permanece apenas como rollback temporário durante o cutover.

# Changelog

## 0.9.0 — 2026-09-27

### Segurança de produção
- API atualizada para v1.6.0.
- Cada projeto recebe par de chaves ES256 próprio para assinatura de autorização offline.
- Respostas válidas de trial/licença passam a incluir JWS assinado e `offlineUntil`.
- Chave pública é entregue no contrato/configuração; chave privada permanece em armazenamento interno do backend.
- Rate limiting aplicado aos endpoints públicos de catálogo, configuração, trial e licença.
- Integrações Web passam a validar origens cadastradas por projeto.
- Novos erros públicos: `origin_not_allowed`, `rate_limited` e `trial_converted`.

### Licenças e trial
- Ativar licença paga converte o trial do mesmo Device ID e impede reinício para obter dias extras.
- Corrigido o limite de dispositivos ao trocar de uma licença para outra no mesmo computador.
- Simulador de licença passou a testar pelo Código de Integração, igual aos produtos reais.
- Histórico de trial diferencia ativos, expirados e convertidos.

### Painel e integração
- Configuração de domínios permitidos para projetos Web.
- Contrato oficial documenta verificação ES256, `deviceHash`, `offlineUntil`, CORS e rate limiting.
- Painel atualizado para v0.9.0.


## 0.8.1 — 2026-09-27

### Integração
- Removidas referências fixas a nomes de outros produtos no gerador; o contrato usa somente o nome do projeto atualmente aberto.
- Exemplos de cadastro foram neutralizados para não sugerir outro produto dentro de um projeto.
- Tecnologia Web ampliada para JavaScript/TypeScript.
- Adicionadas tecnologias-alvo iOS/Swift e Flutter/Dart, com orientações específicas de armazenamento seguro, Device ID e rede.
- Mantidas as opções Universal, .NET/Windows e Android/Kotlin.


## 0.8.0 — 2026-09-27

### Trial centralizado
- Nova página `Trial / Avaliação` por projeto.
- Trial ativado/desativado pelo painel, com duração, intervalo de validação e tolerância offline configuráveis.
- Primeira ativação do trial exige internet.
- Trials são registrados por Device ID no Firestore.
- Atualização/reinstalação não reinicia trial para o mesmo dispositivo.
- Mudanças de política afetam somente novos trials; trials já iniciados preservam o snapshot original.
- Histórico administrativo de trials com opção de redefinição para suporte/testes.
- Novos endpoints `/api/v1/trial/start` e `/api/v1/trial/validate`.

### Integração
- Cada projeto passa a possuir um Código de Integração permanente `GSLI-...`.
- Novo endpoint `/api/v1/project/config` para regras dinâmicas.
- License API aceita Código de Integração, mantendo `projectId` por compatibilidade.
- Contrato de integração atualizado com trial, atualizações de versão e aba Conta/Licença.
- Alterações de versão do produto não invalidam licença nem reiniciam trial.

### Preparação do portal do cliente
- Projetos podem ser marcados como disponíveis no portal.
- Planos podem ser marcados individualmente para venda.
- Novo catálogo público `/api/v1/catalog` retorna somente itens explicitamente publicados.


## 0.7.0 — 2026-09-27

### Integração universal
- Criada página `Integração` em cada projeto.
- Documento personalizado gerado com Project ID, prefixo, políticas, endpoints, payloads, estados, erros e critérios de aceite.
- Modos de orientação: Universal, .NET, Web/JavaScript e Android/Kotlin.
- Botões para copiar integração completa e JSON de configuração.
- Planos permanecem dinâmicos e não precisam ser conhecidos pelo aplicativo integrado.

### Protocolo GSL-v1
- Contrato público versionado.
- Respostas de ativação/validação passam a expor nome/e-mail do cliente, emissão, ativação, expiração, modo de início e duração.
- Códigos públicos de erro padronizados para integração.
- Regra explícita: validade iniciada na primeira ativação usa `activatedAt`, nunca a data de emissão da key.


## 0.6.0 — 2026-09-26

### UX e formulários
- Máscara brasileira para telefone.
- Campo monetário formatado em reais.
- Campos numéricos restringidos a números.
- Prefixo e slug com caracteres válidos.
- Tooltips de ajuda nos principais campos e no simulador.
- Foto da conta Google no cabeçalho.
- Ícones SVG renovados na navegação.

### Planos e licenças
- Plano passa a definir também quando começa a validade.
- Ao selecionar um plano cadastrado, duração, dispositivos, início da validade e vitalício ficam bloqueados.
- O backend também impõe essas regras para impedir alterações manuais pelo cliente web.
- Licença personalizada continua totalmente configurável.

### Administradores
- Cadastro de administradores adicionais por e-mail Google.
- Acesso a todos os projetos, inclusive futuros, ou somente projetos selecionados.
- Permissões por módulo e função.
- Administrador master permanece irrestrito.
- O Worker filtra projetos e bloqueia operações não autorizadas no backend.

## 0.5.0 — 2026-09-26

### Painel
- Dashboard global e por projeto.
- Cadastro e edição de projetos.
- Seletor global de projeto.
- Planos por projeto.
- Clientes por projeto.
- Emissão e gerenciamento de licenças.
- Gerador dedicado de keys.
- Dispositivos, ativações e auditoria.
- Configurações individuais por projeto.
- Interface responsiva e modais administrativos.

### Segurança
- Login Google via Firebase Authentication.
- Validação do Firebase ID Token no Worker.
- Restrição por UID administrativo.
- Firestore isolado do navegador.
- Service Account somente no backend.

### API 1.2.0
- CRUD administrativo.
- Dashboard consolidado.
- Ativação de licença.
- Validação periódica.
- Desativação de dispositivo.
- Controle de limite de dispositivos.
- Renovação, suspensão, reativação e revogação.
