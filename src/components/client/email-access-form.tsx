"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { requestCustomerEmail, verifyCustomerEmail, finishCustomerEmail } from "@/app/actions/customer-email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmailAccessForm({enabled,next="/painel"}:{enabled:boolean;next?:string}) {
 const [attempt,setAttempt] = useState(0);
 return <EmailAccessSteps key={attempt} enabled={enabled} next={next} onChangeEmail={()=>setAttempt(value=>value+1)} />;
}

function EmailAccessSteps({enabled,next,onChangeEmail}:{enabled:boolean;next:string;onChangeEmail:()=>void}) {
 const [sent,send, sending] = useActionState(requestCustomerEmail,undefined);
 const [verified,verify, verifying] = useActionState(verifyCustomerEmail,undefined);
 if (!enabled) return <div className="space-y-4"><p>O cadastro por e-mail está sendo preparado. Por enquanto, entre com sua senha ou use o convite da equipe.</p><Link href={`/painel/login?next=${encodeURIComponent(next)}`} className="underline">Voltar ao login</Link></div>;
 return <div className="space-y-6">
  <div><h1 className="text-2xl font-bold">{sent?.sent ? "Confira seu e-mail" : "Acesso por e-mail"}</h1><p className="mt-2 text-sm text-muted-foreground">{sent?.sent ? "Digite abaixo o código recebido para continuar." : "Receba um código para criar sua conta ou recuperar o acesso."}</p></div>
  {!sent?.sent && <form action={send} className="space-y-3">
   <Label htmlFor="email">Seu e-mail</Label><Input id="email" name="email" type="email" autoComplete="email" maxLength={200} placeholder="voce@exemplo.com" required />
   <p className="text-xs text-muted-foreground">Já participa do leilão? Use o mesmo e-mail que informou à equipe.</p>
   <Button className="w-full" disabled={sending || verifying}>{sending ? "Enviando…" : "Enviar código por e-mail"}</Button>
   {sent?.error && <p role="alert" className="text-sm text-destructive">{sent.error}</p>}
  </form>}
  {sent?.sent && <form action={verify} className="space-y-3"><input type="hidden" name="next" value={next} />
   <p role="status" className="text-sm text-muted-foreground">{sent.notice}</p>
   <p className="break-all text-sm">E-mail: <strong>{sent.email}</strong></p>
   <input type="hidden" name="email" value={sent.email} />
   <Label htmlFor="code">Código recebido</Label><Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={10} pattern="[0-9]{6,10}" autoFocus required placeholder="Digite o código do e-mail" />
   {verified?.error && <p role="alert" className="text-sm text-destructive">{verified.error}</p>}
   <Button className="w-full" disabled={verifying || sending}>{verifying ? "Confirmando…" : "Confirmar e-mail"}</Button>
  </form>}
  <Link href={`/painel/login?next=${encodeURIComponent(next)}`} className="block text-center text-sm underline">Já tenho senha. Entrar no painel</Link>
  {sent?.sent && <button type="button" onClick={onChangeEmail} disabled={verifying} className="block w-full text-center text-sm text-muted-foreground underline underline-offset-4 disabled:opacity-50">Usar outro e-mail</button>}
 </div>;
}

export function EmailActivationForm({name,phone,next="/painel"}:{name:string;phone:string;next?:string}) {
 const [state,action,pending] = useActionState(finishCustomerEmail,undefined);
 return <form action={action} className="space-y-4"><input type="hidden" name="next" value={next} />
  <div><h1 className="text-2xl font-bold">Defina sua senha</h1><p className="mt-2 text-sm text-muted-foreground">E-mail confirmado. Se você já tem cadastro, preservaremos os dados e o histórico. Para uma conta nova, informe nome e WhatsApp.</p></div>
  <div className="space-y-2"><Label htmlFor="name">Nome completo</Label><Input id="name" name="name" autoComplete="name" defaultValue={name} minLength={2} maxLength={120} /></div>
  <div className="space-y-2"><Label htmlFor="phone">WhatsApp com DDD</Label><Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={phone} maxLength={25} placeholder="(11) 99999-8888" /><p className="text-xs text-muted-foreground">Informar um número não dá acesso aos lotes de outro cadastro. Se seu telefone já foi cadastrado com outro e-mail, fale com a equipe.</p></div>
  <div className="space-y-2"><Label htmlFor="password">Nova senha</Label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required /></div>
  <div className="space-y-2"><Label htmlFor="confirm">Repita a senha</Label><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={256} required /></div>
  {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
  <Button className="w-full" disabled={pending}>{pending ? "Salvando…" : "Salvar senha e acessar"}</Button>
  <Link href={`/painel/acesso-email?next=${encodeURIComponent(next)}`} className="block text-sm underline">Confirmar outro código por e-mail</Link>
 </form>;
}
