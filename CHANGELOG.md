# Changelog

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
