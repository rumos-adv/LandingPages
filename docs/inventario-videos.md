# Vídeos contextuais de inventário — versão para revisão

Base: `main`, commit `9576a1d8169b2bf08d7f62d0810b6cd966f7aa6b`.

## Os quatro espaços

| Identificador | Posição na página | Assunto | Duração inicial |
| --- | --- | --- | --- |
| `apresentacao` | Apresentação principal, antes do contato | Quem conduz o caso | 30 segundos |
| `atendimento` | Explicação do primeiro passo, junto ao formulário | Como funciona o primeiro atendimento | 40 segundos |
| `documentos` | Introdução à lista de documentos | O que reunir antes de começar | 30 segundos |
| `atraso` | Introdução à seção de inventário atrasado | Por onde começar quando o inventário está pendente | 30 segundos |

As durações são referências para gravação e devem ser atualizadas quando os arquivos finais forem incluídos. Não há vídeo fictício nem endereço de mídia inexistente. A capa usa o retrato já publicado do advogado e informa que a gravação está em preparação.

## Como revisar e testar uma gravação

1. Abra a URL de preview, no caminho `/inventario/`.
2. Use os atalhos da faixa de revisão para localizar os quatro espaços.
3. Clique em “Dr. Rodrigo explica” para manter o cartão aberto. No desktop, passar o mouse permite visualizar a capa.
4. Na parte inferior do cartão, escolha um vídeo em “Testar uma gravação”.
5. O arquivo é aberto por uma URL local do navegador (`blob:`), sem upload, armazenamento no servidor ou envio à medição da campanha. Ele deixa de estar disponível ao recarregar a página; escolha-o novamente se necessário.
6. Cada espaço pode receber seu próprio arquivo de teste. Apenas um cartão fica aberto por vez e o fechamento pausa a reprodução.

O player preserva a imagem inteira em proporção quadrada; uma gravação de teste com outra proporção recebe espaço livre, sem cortar o rosto. MP4 com vídeo H.264 e áudio AAC oferece uma opção prática para os arquivos finais. Os testes locais não substituem legendas revisadas para a publicação final.

## Inclusão dos vídeos finais

No botão correspondente em `rumosadv-site/inventario/index.html`:

- `data-video-src`: endereço do vídeo final, por exemplo `/assets/video/apresentacao.v1.mp4`.
- `data-video-captions`: endereço do arquivo WebVTT com legendas revisadas.
- `data-video-poster`: capa quadrada aprovada.
- `data-video-duration`: duração real, em segundos; atualizar também a duração visível e o rótulo acessível do botão.

Manter arquivos de mídia ausentes até serem recebidos e revisados. Não acrescentar dados estruturados `VideoObject` para gravações que ainda não existem. Usar nomes versionados para CSS, JavaScript, vídeos e legendas: o site configura cache longo em `/assets/*`.

## Publicação e medição

- Esta alteração deve permanecer no ramo de revisão e em um PR de rascunho até a revisão de Rodrigo.
- O domínio de produção continua usando o código de medição existente. No preview, GTM e Clarity da página de inventário não são iniciados; o seletor de arquivos e a faixa de revisão ficam disponíveis apenas fora dos domínios de produção.
- Em produção, o componente acrescenta eventos de reprodução e progresso (`context_video_start`, `context_video_progress`, `context_video_complete`). Esses eventos não são contatos nem conversões de contratação.
- Textos jurídicos, calculadora, destinos dos contatos, formulário, artigos, Functions e configuração de campanhas não foram alterados.
