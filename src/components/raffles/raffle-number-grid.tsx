"use client";
import {useEffect,useRef,useState} from "react";
import {quotaLabel} from "@/lib/raffles";
import type {RaffleNumberState} from "@/lib/raffle-number-states";

function NumberBlock({rows,campaign,total,selected,disabled,filter,target,onSelect,index}:{rows:RaffleNumberState[];campaign:string;total:number;selected:number[];disabled:boolean;filter:string;target:number|null;onSelect:(number:number)=>void;index:number}){
 const node=useRef<HTMLDivElement>(null);
 const [seen,setSeen]=useState(index===0);
 const focused=target!==null && rows.some(row=>row.number===target);
 useEffect(()=>{
  if(seen||!node.current)return;
  if(!("IntersectionObserver" in window)){queueMicrotask(()=>setSeen(true));return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setSeen(true);observer.disconnect();}},{rootMargin:"600px"});
  observer.observe(node.current);return()=>observer.disconnect();
 },[seen]);
 const visible=rows.filter(row=>filter==="all"||row.state==="available");
 if(!visible.length)return null;
 return <div ref={node} className={seen||focused?"grid grid-cols-5 gap-2 sm:grid-cols-10 lg:grid-cols-5 xl:grid-cols-8":"min-h-[952px] rounded-xl bg-muted/20 sm:min-h-[472px] lg:min-h-[952px] xl:min-h-[616px]"} aria-busy={!seen&&!focused}>
  {seen||focused?visible.map(row=><button type="button" key={row.number} id={`raffle-number-${campaign}-${row.number}`} aria-label={`Cota ${quotaLabel(row.number,total)}: ${row.state==="paid"?"paga":row.state==="reserved"?"reservada":selected.includes(row.number)?"selecionada":"disponível"}`} aria-pressed={selected.includes(row.number)} data-state={row.state} disabled={disabled||row.state!=="available"} onClick={()=>onSelect(row.number)} className={`rf-quota ${target===row.number?"ring-2 ring-ouro ring-offset-2":""}`}>{quotaLabel(row.number,total)}</button>):<p className="p-3 text-center text-xs text-muted-foreground">Cotas {quotaLabel(visible[0].number,total)}–{quotaLabel(visible.at(-1)!.number,total)}</p>}
 </div>;
}

export function RaffleNumberGrid(props:{numbers:RaffleNumberState[];campaign:string;total:number;selected:number[];disabled:boolean;filter:string;target:number|null;onSelect:(number:number)=>void}){
 const {numbers,...rest}=props;
 useEffect(()=>{if(props.target!==null)document.getElementById(`raffle-number-${props.campaign}-${props.target}`)?.scrollIntoView({behavior:"smooth",block:"center"});},[props.target,props.campaign]);
 return <div className="grid gap-2">{Array.from({length:Math.ceil(numbers.length/100)},(_,index)=><NumberBlock key={index} {...rest} index={index} rows={numbers.slice(index*100,index*100+100)}/>)}</div>;
}
