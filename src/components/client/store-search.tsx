'use client';
import {trackStoreEvent} from '@/lib/meta-browser';
import { Search } from 'lucide-react';
import Link from 'next/link';
import type { CatalogFilters } from '@/lib/store-presentation';

export function StoreSearch({filters,children,path="/painel/loja"}:{filters:CatalogFilters;children?:React.ReactNode;path?:string}){
 return <div className="flex flex-wrap items-center gap-3"><form key={filters.q} action={path} onSubmit={()=>trackStoreEvent('Search')} className="relative min-w-0 flex-1">{Object.entries(filters).filter(([key,value])=>key!=='q'&&value).map(([key,value])=><input key={key} type="hidden" name={key} value={value===true?'1':String(value)}/>)}<label htmlFor="store-search" className="sr-only">Buscar na loja</label><Search className="pointer-events-none absolute left-4 top-3.5 size-4 text-muted-foreground"/><input id="store-search" name="q" defaultValue={filters.q} maxLength={100} placeholder="Buscar jogador, card ou produto" className="h-12 w-full rounded-xl border bg-card pl-11 pr-20 text-sm"/><button type="submit" className="absolute right-2 top-2 rounded-lg bg-muted px-3 py-2 text-xs font-medium">Buscar</button></form>{children}</div>;
}

export function StoreQuickFilters({ filters, categories, path = '/painel/loja' }: {
  filters: CatalogFilters;
  categories: string[];
  path?: string;
}) {
  const priority = ['CARD', 'LEGENDS', 'COPA 2026'];
  const collections = ['', ...priority.filter(category => categories.includes(category)), ...categories.filter(category => !priority.includes(category))];
  function href(changes: Partial<CatalogFilters>) {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries({ ...filters, ...changes })) {
      if (value) params.set(key,value === true ? '1' : value);
    }
    return params.size ? `${path}?${params}` : path;
  }
  const chip = (selected: boolean) => `shrink-0 rounded-full border px-4 py-2.5 text-xs font-medium ${selected ? 'border-ouro/30 bg-amarelo/15 text-ouro-ink' : 'bg-card text-muted-foreground hover:text-foreground'}`;
  return <nav aria-label="Atalhos do catálogo" className="flex gap-2 overflow-x-auto pb-1">
    {collections.map(category => <Link key={category} href={href({ category })}
      aria-current={filters.category === category ? 'page' : undefined} className={chip(filters.category === category)}>
      {category === 'CARD' ? 'Cards' : category === 'LEGENDS' ? 'Legends' : category || 'Todos os produtos'}
    </Link>)}
    <Link href={href({ available: !filters.available })} className={chip(filters.available)}>
      {filters.available ? 'Mostrar também esgotados' : 'Somente em estoque'}
    </Link>
  </nav>;
}
