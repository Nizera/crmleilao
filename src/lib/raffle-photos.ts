/** A capa continua disponível para campanhas criadas antes da galeria. */
export function rafflePhotos(campaign?: { image_url?: string | null; image_urls?: string[] | null } | null): string[] {
  return [...new Set([campaign?.image_url, ...(campaign?.image_urls ?? [])].filter((url): url is string => typeof url === "string" && url.startsWith("https://")))].slice(0, 6);
}
