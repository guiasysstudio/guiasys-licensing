# C01 — contrato local da GuiaSys Platform

Esta etapa não altera Firebase, Google Cloud, Cloudflare, DNS, secrets, dados ou produção.

## Limites entre produtos

O projeto `guiasys-licensing` continua sendo a fonte de verdade da plataforma. O Licensing mantém suas
coleções atuais (`projects`, `customerAccounts`, `admins`, `adminUids` e demais coleções de negócio) e todo o
acesso privilegiado continua pelo Admin SDK.

O site institucional utiliza somente:

- `studioAdmins/{uid}`;
- `studioProfiles/{uid}`;
- `studioProjects/{slug}`;
- `studioContactMessages/{messageId}`;
- Storage `studio-projects/{slug}/...` gerenciado pela Function do Studio.

As regras compostas deste repositório liberam apenas as operações de navegador necessárias nesses quatro
namespaces e mantêm o default-deny para todo o restante. A cópia idêntica das regras no repositório GuiaSys
evita que um deploy posterior de um repositório apague involuntariamente a política do outro.

## Identidade canônica

O Firebase Authentication de `guiasys-licensing` é canônico. O caso de e-mail coincidente auditado na C00
deve conservar o UID do destino. O perfil institucional será gravado sob esse UID; `customerAccounts` não será
substituído nem mesclado automaticamente. Contagens, provedores e decisões podem ser registrados, mas e-mails,
UIDs, CPF e outros dados pessoais não devem aparecer nos artefatos de migração.

## Hosting planejado

| Target | Site | Domínio futuro |
|---|---|---|
| `studio` | `guiasys-studio-e1ea8` | `guiasys.com.br` |
| `public` | `guiasys-licensing` | `licencas.guiasys.com.br` |
| `admin` | `guiasys-licensing-admin` | `painel.licencas.guiasys.com.br` |

`www.guiasys.com.br` é redirecionado para `guiasys.com.br`. Os domínios legados foram retirados ao final da
transição e não fazem parte do contrato atual.

## Estado após C02

O projeto mantém o ID `guiasys-licensing` e passou a usar o nome de exibição `GuiaSys Platform`. O Web App
`GuiaSys Studio`, o site `guiasys-studio-e1ea8` e a codebase Functions `studio` foram criados separadamente.
As regras compostas foram publicadas e os domínios `.com.br` foram autorizados no Auth, sem DNS, migração de
dados ou alteração de usuários. A homologação está em <https://guiasys-studio-e1ea8.web.app>.

## Gate antes de produção

Exigir, em ordem: regras no emulador; migração dry-run somente com totais; backup/rollback confirmados; smoke em
`web.app`; domínios autorizados do Auth; App Check em modo monitoramento; verificação de IAM/secrets por
referência; DNS com TTL de transição; e aprovação explícita separada para qualquer escrita ou deploy.
