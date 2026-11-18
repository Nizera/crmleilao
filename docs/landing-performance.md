# Validação local de conversão e velocidade

Link único do grupo em src/lib/community.ts, compartilhado pelo site e painel. Destino atualizado conforme solicitado, preservando os parâmetros s, p e iam.

O CTA é um anchor nativo e não espera autenticação, consultas ao catálogo, carregamento do Pixel ou resposta de analytics. O Pixel continua condicionado a produção e consentimento. Não houve publicação.

Otimizações: landing e API pública sem refresh de sessão no proxy; requisições simultâneas do catálogo compartilhadas; limite de dez segundos na consulta do navegador; SDK realtime carregado via import dinâmico.

Medições HTTP locais no servidor de desenvolvimento iniciado pelo usuário, localhost:3001: primeira resposta 808 ms e três respostas aquecidas de 383, 291 e 269 ms. HTML aproximadamente 86 KB sem compressão. Três CTAs renderizados no HTML apontaram ao novo grupo; nenhum apontou ao anterior. Catálogo respondeu em 537 ms, oito lotes e seis produtos, ambos disponíveis.

Estes números medem resposta HTTP local, não LCP/INP/CLS, desempenho em rede móvel ou produção. Recebimento de Lead na Meta e entrega de Broadcast após criação real de lote não foram exercitados. Não foram criados dados reais para teste.
