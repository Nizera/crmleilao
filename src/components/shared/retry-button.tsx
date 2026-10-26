"use client";
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export function RetryButton(){const router=useRouter();const [pending,startTransition]=useTransition();return <Button type="button" variant="outline" disabled={pending} className="w-fit" onClick={()=>startTransition(()=>router.refresh())}>{pending?'Carregando…':'Tentar novamente'}</Button>;}
