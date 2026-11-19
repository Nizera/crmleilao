import { formatBRL } from "@/lib/lots";

export function LotPrice({ value, discount = 0, voucher = 0 }: { value: number; discount?: number | null; voucher?:number|null }) {
  const off = Number(discount ?? 0);
  return <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">{off > 0 && <del className="text-xs font-normal text-muted-foreground"><span className="sr-only">Valor original: </span>{formatBRL((Math.round(Number(value)*100)+Math.round(off*100))/100)}</del>}<span>{off > 0 && <span className="sr-only">Valor com desconto: </span>}{formatBRL(value)}</span>{Number(voucher)>0&&<span className="rounded border border-yellow-500/60 bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-950">Voucher −{formatBRL(voucher)}</span>}</span>;
}
