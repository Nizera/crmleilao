/**
 * Formato de retorno de todas as server actions.
 * `ok: false` traz a mensagem amigável para a tela; `ok: true` traz os dados.
 */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Relança o erro de `redirect()` do Next.
 *
 * Quase toda server action embrulha `requireAdmin()`/`requireCustomer()` em
 * try/catch, e essas guards chamam `redirect()` — que lança um erro com
 * `digest = "NEXT_REDIRECT;..."`. Sem este guard o catch engole o redirect e o
 * usuário recebe "NEXT_REDIRECT" como mensagem de erro, parado na mesma tela.
 *
 * Chame como primeira linha de qualquer `catch` que possa envolver uma guard.
 */
export function rethrowIfRedirect(error: unknown): void {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return;
  }
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
    throw error;
  }
}
