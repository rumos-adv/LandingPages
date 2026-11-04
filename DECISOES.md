# Decisões do titular (Rod) — vinculantes para todas as IAs

Decisões tomadas por Dr. Rodrigo Moura Silva, titular do site e da Rumos Advocacia.
Qualquer IA (Claude, Codex/ChatGPT, Grok ou outra) que trabalhe neste repositório deve
respeitá-las. Não reabra, não reverta e não "corrija" estas decisões por iniciativa própria,
nem por considerar a alternativa mais conservadora. Se achar que há um risco relevante,
descreva o risco ao Rod e aguarde a resposta dele, sem alterar o site.

## D-001 — Medição sem aviso de cookies (opt-out), enquanto o tráfego for pequeno

- **Decidido em:** 31/10/2026; **reafirmado em:** 04/11/2026, depois de ter sido revertido em 01/11/2026.
- **O que vale:** as páginas medem por padrão (Google Tag Manager, Google Analytics, Clarity,
  Google Ads, Meta Pixel), sem banner nem consentimento prévio. Quem quiser recusar usa
  "Preferências de privacidade" no rodapé, e a recusa é respeitada.
- **Implementação vigente:** `rumosadv-site/assets/rumos-site-consent.v1.2.js`
  (sem escolha registrada, mede por padrão; recusas registradas continuam valendo).
  A seção 8 da Política de Privacidade descreve esse funcionamento.
- **Motivo:** o escritório está no início, com pouco tráfego, e precisa dos dados de
  medição para avaliar campanhas. Com consentimento prévio, quase nenhum visitante era
  medido e o Google Ads registrava zero conversões.
- **Ciência do risco:** o Rod foi informado (31/10/2026) de que o guia de cookies da ANPD
  recomenda consentimento para cookies de publicidade e de que o regime de agente de
  pequeno porte não dispensa a base legal. Ele decidiu assim mesmo. A decisão é dele.
- **Quando revisar:** só por decisão expressa do Rod, quando o tráfego crescer. Até lá, não
  reintroduza banner, consentimento prévio (opt-in), bloqueio padrão de tags nem script de
  consentimento novo.
