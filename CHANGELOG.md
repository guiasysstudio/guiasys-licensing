# Changelog

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
