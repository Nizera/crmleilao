import Link from 'next/link';
import { pageHref } from '@/lib/loyalty-history';
export function HistoryPagination({path,params,data}:{path:string;params:Record<string,string|string[]|undefined>;data:{page:number;pages:number;total:number;size:number}}){
 return <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground"><span>{data.total?`${(data.page-1)*data.size+1}–${Math.min(data.page*data.size,data.total)}`:'0'} de {data.total}</span><div className="flex items-center gap-3">{data.page>1?<Link className="rounded-lg border px-3 py-2" href={pageHref(path,params,data.page-1)}>Anterior</Link>:<span className="opacity-40">Anterior</span>}<span>Página {data.page} de {data.pages}</span>{data.page<data.pages?<Link className="rounded-lg border px-3 py-2" href={pageHref(path,params,data.page+1)}>Próxima</Link>:<span className="opacity-40">Próxima</span>}</div></footer>;
}
