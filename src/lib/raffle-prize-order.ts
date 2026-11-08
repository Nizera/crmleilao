/** Só reconhece uma colocação explícita, não quantidades como "4 quadros". */
export function rafflePrizePosition(title: string): number | null {
  const match = title.trim().match(/^(\d{1,3})\s*[º°ª]?\s*pr[eê]mio\b/i);
  const position = match ? Number(match[1]) : 0;
  return position > 0 ? position : null;
}

export function compareRafflePrizes(a: { title: string }, b: { title: string }) {
  return (rafflePrizePosition(a.title) ?? 1000) - (rafflePrizePosition(b.title) ?? 1000);
}

export function raffleDrawPrizeLabel(title: string) {
  const position = rafflePrizePosition(title);
  return position ? `${position}º prêmio` : "Prêmio do sorteio";
}
