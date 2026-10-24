export const LOYALTY_TIERS = [
  { key: "lilas", name: "Lilás", range: "Menos de R$ 1.000", rate: "0,5 pt por real", min: 0, max: 1000 },
  { key: "bronze", name: "Bronze", range: "R$ 1.000 a menos de R$ 5.000", rate: "1 pt por real", min: 1000, max: 5000 },
  { key: "prata", name: "Prata", range: "R$ 5.000 a menos de R$ 15.000", rate: "1,5 pt por real", min: 5000, max: 15000 },
  { key: "ouro", name: "Ouro", range: "R$ 15.000 a menos de R$ 25.000", rate: "2 pts por real", min: 15000, max: 25000 },
  { key: "crumple", name: "Crumple", range: "R$ 25.000 a menos de R$ 50.000", rate: "2,5 pts por real", min: 25000, max: 50000 },
  { key: "prizm", name: "Prizm", range: "R$ 50.000 ou mais", rate: "3 pts por real", min: 50000, max: Infinity },
] as const;

export function getLoyaltyTier(totalSpent: number) {
  return [...LOYALTY_TIERS].reverse().find((tier) => totalSpent >= tier.min) ?? LOYALTY_TIERS[0];
}
