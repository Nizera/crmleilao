import { Search } from 'lucide-react';

export function StoreSearch({query,children,path="/painel/loja"}:{query:string;children?:React.ReactNode;path?:string}){
 return <div className="flex flex-wrap items-center gap-3"><form action={path} className="relative min-w-0 flex-1"><label htmlFor="store-search" className="sr-only">Buscar na loja</label><Search className="pointer-events-none absolute left-4 top-3.5 size-4 text-muted-foreground"/><input id="store-search" name="q" defaultValue={query} maxLength={100} placeholder="Buscar produtos, cards, álbuns…" className="h-12 w-full rounded-xl border bg-card pl-11 pr-20 text-sm"/><button type="submit" className="absolute right-2 top-2 rounded-lg bg-muted px-3 py-2 text-xs font-medium">Buscar</button></form>{children}</div>;
}
