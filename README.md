# GuiaSys Licensing

Central de licenciamento multi-projeto da GuiaSys Studio.

## Arquitetura

- Frontend estático: GitHub Pages
- Autenticação: Firebase Authentication (Google)
- Banco: Cloud Firestore
- Backend/API: Cloudflare Workers
- Isolamento: dados separados por `projectId`

## Estado atual

M01 — Fundação do painel:

- Login com Google
- Shell administrativo responsivo
- Dashboard geral inicial
- Navegação global
- Seletor de projeto preparado
- Exibição do Firebase UID para autorização administrativa
- Monitoramento básico da API
- Firestore mantido sem acesso direto pelo frontend

## Segurança

O frontend não possui credenciais de Service Account. O Firestore deve permanecer bloqueado para leitura/escrita direta do navegador. Operações administrativas serão executadas somente pelo Worker autenticado.

> A `apiKey` do Firebase Web é uma identificação pública do aplicativo web; ela não substitui regras de segurança nem credenciais de backend.
