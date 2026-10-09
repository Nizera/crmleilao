/**
 * Formato de retorno de todas as server actions.
 * `ok: false` traz a mensagem amigável para a tela; `ok: true` traz os dados.
 */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };
