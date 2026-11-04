import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const url = code => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText).toString('base64');
const real = name => JSON.stringify(import.meta.resolve(name));

test('Prazo de pagamento e valor declarado não alteram recursos nem aceitam prêmio sem valor', async () => {
  const { isPaymentExpired } = await import(url(await read('../src/lib/payment-ui.ts')));
  const now = Date.parse('2026-11-01T12:00:00Z');
  for (const value of [null, 'inválido', '2026-11-01T12:01:00Z']) assert.equal(isPaymentExpired(value, now), false);
  for (const value of ['2026-11-01T11:59:59Z', '2026-11-01T12:00:00Z']) assert.equal(isPaymentExpired(value, now), true);
  const { logisticsDeclaredTotal, shipmentContentSnapshot } = await import(url(await read('../src/lib/shipment-content.ts')));
  const prize = { id: 'prize', source_kind: 'raffle', moved_at: '2026-11-01', shipping_declared_value: 50.25 };
  assert.equal(logisticsDeclaredTotal([prize]), 50.25);
  for (const value of [0, NaN, null]) assert.throws(() => logisticsDeclaredTotal([{ ...prize, shipping_declared_value: value }]), /valor declarado/);
  assert.throws(() => logisticsDeclaredTotal([{ ...prize, moved_at: null }]), /Separe/);
  assert.deepEqual(shipmentContentSnapshot([{ id:'lot', arremate_value:80 }],[{id:'store',shipping_declared_value:30}],[prize]),{ lots:[{id:'lot',value:80}],store:[{id:'store',value:30}],logistics:[{id:'prize',value:50.25}] });
});

test('Cartão usa status recebido: revisão remove confirmação/prêmio e prazo vencido remove instrução de pagar', async () => {
  globalThis.__raffleUiAudit = { expired: false };
  let source = await read('../src/components/raffles/raffle-client.tsx');
  const badgeSource='import React from '+real('react')+';\n'+(await read('../src/components/raffles/raffle-ui.tsx'))
    .replace('import Link from "next/link";','const Link=({children})=>children;')
    .replace(/from "lucide-react"/g,'from '+real('lucide-react'))
    .replace('import { raffleStatus } from "@/lib/raffles";','const raffleStatus={paid:"Pago",review:"Em análise",pending:"Aguardando pagamento"};');
  source=source.replace(/from "lucide-react"/g,'from '+real('lucide-react'))
    .replace('import { RaffleBadge, RaffleProgress } from "@/components/raffles/raffle-ui";','import {RaffleBadge,RaffleProgress} from '+JSON.stringify(url(badgeSource))+';')
    .replace('import { ImageLightbox } from "@/components/client/image-lightbox";','const ImageLightbox=()=>null;')
    .replace('import { ReservationCountdown } from "@/components/raffles/reservation-countdown";','const ReservationCountdown=()=>null;')
    .replace('import { rafflePhotos } from "@/lib/raffle-photos";','const rafflePhotos=()=>[];');

  source = 'import React from '+real('react')+';\n'+source
    .replace('import { useEffect, useRef, useState, useTransition } from "react";', 'import {useEffect,useRef,useState,useTransition} from '+real('react')+';')
    .replace('import { useRouter } from "next/navigation";', 'const useRouter=()=>({refresh(){},push(){}});')
    .replace('import Link from "next/link";', 'const Link=({href,children,...props})=>React.createElement("a",{href,...props},children);')
    .replace('import Image from "next/image";', 'const Image=({unoptimized,...props})=>React.createElement("img",props);')
    .replace('import { Gift, Ticket, CheckCircle2, Copy, RefreshCw } from "lucide-react";', 'import {Gift,Ticket,CheckCircle2,Copy,RefreshCw} from '+real('lucide-react')+';')
    .replace('import { toast } from "sonner";', 'const toast={error(){},success(){},info(){}};')
    .replace('import { reserveRaffle, refreshRaffleOrder, refreshRaffleOrders } from "@/app/actions/raffles";', 'const reserveRaffle=()=>{};const refreshRaffleOrder=()=>{};const refreshRaffleOrders=()=>{};')
    .replace('import { quotaLabel, raffleMoney, raffleStatus, type Raffle, type RaffleOrder, type RaffleAward } from "@/lib/raffles";', 'const quotaLabel=n=>String(n).padStart(3,"0");const raffleMoney=n=>String(n);const raffleStatus={paid:"Pago",review:"Em análise",pending:"Aguardando pagamento"};')
    .replace('import { Button } from "@/components/ui/button";', 'const Button=({variant,asChild,children,...props})=>React.createElement("button",props,children);')
    .replace('import { Input } from "@/components/ui/input";', 'const Input=props=>React.createElement("input",props);')
    .replace('import { raffleReservationDeadline } from "@/lib/raffle-reservation";', 'const raffleReservationDeadline=o=>o.reservation_expires_at||o.expires_at;')
    .replace('import { usePaymentExpired } from "@/components/client/use-payment-expired";', 'const usePaymentExpired=()=>globalThis.__raffleUiAudit.expired;');
  try {
    const { RaffleOrderCard } = await import(url(source));
    const order={id:crypto.randomUUID(),code:'RF-TEST',campaign_title:'Campanha de teste',status:'paid',numbers:[0],amount:20,expires_at:null};
    const awards=[{id:crypto.randomUUID(),order_id:order.id,title:'Prêmio teste',number:0,cancelled_at:null}];
    const paid=renderToStaticMarkup(React.createElement(RaffleOrderCard,{order,awards}));
    assert.match(paid,/Pagamento confirmado/);assert.match(paid,/Você ganhou/);assert.match(paid,/000/);
    const review=renderToStaticMarkup(React.createElement(RaffleOrderCard,{order:{...order,status:'review'},awards}));
    assert.doesNotMatch(review,/Pagamento confirmado|Você ganhou/);assert.match(review,/Pagamento em análise/);
    globalThis.__raffleUiAudit.expired=true;
    const expired=renderToStaticMarkup(React.createElement(RaffleOrderCard,{order:{...order,status:'pending',qr_code:'PIX-VENCIDO'},awards:[]}));
    assert.match(expired,/Prazo encerrado/);assert.doesNotMatch(expired,/Pagar com Pix|Copiar Pix|PIX-VENCIDO/);
  } finally { delete globalThis.__raffleUiAudit; }
});

test('Sincronização em lote respeita dono e orçamento, rejeita lista excessiva e não compartilha limite da loja', async () => {
  const customer=crypto.randomUUID(),other=crypto.randomUUID();
  const rows=Array.from({length:10},()=>({id:crypto.randomUUID(),customer_id:customer,status:'pending'}));
  const foreign={id:crypto.randomUUID(),customer_id:other,status:'pending'};
  const called=[];const buckets=[];
  const db={rpc:async(name,args)=>{globalThis.__raffleBatchAudit.resolutions.push({name,args});return {error:null};},from(){let owner,ids;return {
    select(){return this;},eq(k,v){if(k==='customer_id')owner=v;return this;},in(k,v){if(k==='id')ids=v;return this;},order(){return this;},
    single:async()=>({data:globalThis.__raffleBatchAudit.reviewOrder,error:null}),
    then(resolve){return Promise.resolve({data:[...rows,foreign].filter(r=>r.customer_id===owner&&ids.includes(r.id)),error:null}).then(resolve);}
  };}};
  globalThis.__raffleBatchAudit={db,customer,called,buckets,rows,resolutions:[],role:'viewer'};
  let source=await read('../src/app/actions/raffles.ts');
  source=source.replace('"use server";','')
    .replace('import { revalidatePath } from "next/cache";','const revalidatePath=()=>{};')
    .replace('import { z } from "zod";','import {z} from '+real('zod')+';')
    .replace('import { requireAdmin, requireCustomer } from "@/lib/dal";','const requireAdmin=async()=>({profile:{role:globalThis.__raffleBatchAudit.role,id:globalThis.__raffleBatchAudit.customer}});const requireCustomer=async()=>({customer:{id:globalThis.__raffleBatchAudit.customer}});')
    .replace('import { createClient } from "@/lib/supabase/server";','const createClient=async()=>globalThis.__raffleBatchAudit.db;')
    .replace('import { allow } from "@/lib/ratelimit";','const allow=async bucket=>{globalThis.__raffleBatchAudit.buckets.push(bucket);return true;};')
    .replace('import { rethrowIfRedirect, type ActionResult } from "@/lib/result";','const rethrowIfRedirect=()=>{};')
    .replace('import { raffleSchema, type RaffleOrder } from "@/lib/raffles";','const raffleSchema={};')
    .replace('import { ensureRafflePix, ownRaffleOrder, rafflesEnabled, syncRafflePayment, reconcileRafflePayments } from "@/lib/raffles-server";', 'const ensureRafflePix=async o=>{globalThis.__raffleBatchAudit.called.push(o.id)};const ownRaffleOrder=async id=>globalThis.__raffleBatchAudit.rows.find(o=>o.id===id);const syncRafflePayment=async()=>{};const rafflesEnabled=async()=>true;const reconcileRafflePayments=async()=>{};')
    .replace('import { cancelPixOrder, getOrder } from "@/lib/mercadopago";','const cancelPixOrder=async()=>{};const getOrder=async()=>globalThis.__raffleBatchAudit.payment;')
    .replace('import { createAdminClient } from "@/lib/supabase/admin";','const createAdminClient=()=>globalThis.__raffleBatchAudit.db;')
    .replace('import { isProductImageContent } from "@/lib/store-admin";','const isProductImageContent=()=>true;');
  try {
    const {refreshRaffleOrders,resolveRaffleReview}=await import(url(source));
    const ids=rows.slice(0,9).map(o=>o.id).concat(foreign.id);
    const first=await refreshRaffleOrders(ids,0);
    assert.equal(first.ok,true);assert.equal(first.data.length,9);assert.equal(called.length,3);assert.ok(!called.includes(foreign.id));
    await refreshRaffleOrders(ids,3);assert.equal(new Set(called).size,6);assert.deepEqual(buckets,['raffle-sync','raffle-sync']);
    assert.equal((await refreshRaffleOrders([...ids,rows[9].id],0)).ok,false);
    assert.equal((await refreshRaffleOrders(ids,10)).ok,false);
    const state=globalThis.__raffleBatchAudit;
    state.reviewOrder={id:customer,status:'review',mp_order_id:'ORD_test',external_reference:'raffle_test',amount:20};
    state.payment={id:'ORD_test',externalReference:'raffle_test',amount:20,status:'refunded',statusDetail:''};
    assert.equal((await resolveRaffleReview(customer)).ok,false,'viewer não resolve');
    state.role='owner';state.payment.status='processed';assert.equal((await resolveRaffleReview(customer)).ok,false,'pagamento aprovado não prova estorno');
    state.payment.status='refunded';state.payment.statusDetail='partially_refunded';assert.equal((await resolveRaffleReview(customer)).ok,false);
    state.payment.statusDetail='';state.payment.externalReference='raffle_other';assert.equal((await resolveRaffleReview(customer)).ok,false);
    state.payment.externalReference='raffle_test';assert.equal((await resolveRaffleReview(customer)).ok,true);
    assert.equal(state.resolutions.length,1);assert.equal(state.resolutions[0].name,'resolve_refunded_raffle');
  } finally { delete globalThis.__raffleBatchAudit; }
});
