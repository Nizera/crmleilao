export const LOYALTY_TIERS = [
  { key: "lilas", name: "Lilás", range: "Menos de 1.000 pontos", rate: "0,5 pt por real", min: 0, max: 1000 },
  { key: "bronze", name: "Bronze", range: "1.000 a menos de 5.000 pontos", rate: "1 pt por real", min: 1000, max: 5000 },
  { key: "prata", name: "Prata", range: "5.000 a menos de 15.000 pontos", rate: "1,5 pt por real", min: 5000, max: 15000 },
  { key: "ouro", name: "Ouro", range: "15.000 a menos de 25.000 pontos", rate: "2 pts por real", min: 15000, max: 25000 },
  { key: "crumple", name: "Crumple", range: "25.000 a menos de 50.000 pontos", rate: "2,5 pts por real", min: 25000, max: 50000 },
  { key: "prizm", name: "Prizm", range: "50.000 pontos ou mais", rate: "3 pts por real", min: 50000, max: Infinity },
] as const;

export function getLoyaltyTier(rankPoints: number) {
  return [...LOYALTY_TIERS].reverse().find((tier) => rankPoints >= tier.min) ?? LOYALTY_TIERS[0];
}
