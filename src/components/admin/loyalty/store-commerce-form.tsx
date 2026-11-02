'use client';
import {useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {saveStoreCommerce} from '@/app/actions/store-settings';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export function StoreCommerceForm({enabled,canEdit}:{enabled:boolean;canEdit:boolean}){
 const [pending,start]=useTransition();const router=useRouter();
 return <form action={form=>start(async()=>{try{const result=await saveStoreCommerce(form);if(!result.ok)toast.error(result.error);else{toast.success('Funcionamento da loja atualizado.');router.refresh();}}catch{toast.error('A conexão falhou. Atualize antes de tentar novamente.');}})} className="grid gap-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Compras da loja · {enabled?'abertas':'fechadas'}</h2><p className="text-sm text-muted-foreground">Fechar bloqueia novos pedidos e resgates. Pagamentos já gerados, cancelamentos, histórico e atendimento continuam funcionando.</p><fieldset disabled={!canEdit||pending} className="grid gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled}/>Permitir compras e resgates de vouchers</label><Input name="note" required minLength={5} maxLength={500} placeholder="Motivo da abertura ou fechamento"/><Button className="w-fit" type="submit">{pending?'Salvando…':'Salvar funcionamento'}</Button></fieldset>{!canEdit&&<p className="text-xs text-muted-foreground">Somente o dono pode alterar esta configuração.</p>}</form>;
}
