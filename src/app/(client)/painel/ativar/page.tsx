import { safeCommerceNext } from "@/lib/commerce-access";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { EmailActivationForm } from "@/components/client/email-access-form";
export const metadata = {title:"Ativar acesso por e-mail"};
// A ativação depende da sessão e não pode ser pré-renderizada.
export const instant = false;
export default async function ActivateEmailPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const next=safeCommerceNext((await searchParams).next);
 await connection();
 if (process.env.CUSTOMER_EMAIL_ACCESS_ENABLED?.trim().toLowerCase() !== "true") redirect("/painel/login");
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if (!user?.email_confirmed_at) redirect(`/painel/acesso-email?next=${encodeURIComponent(next)}`);
 const {data:customer}=await supabase.from("customers").select("name,phone_e164").eq("auth_user_id",user.id).maybeSingle();
 return <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted px-5 py-10"><Link href="/"><Logo className="w-60" /></Link><section className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm"><EmailActivationForm next={next} name={customer?.name ?? ""} phone={customer?.phone_e164 ?? ""} /></section></main>;
}
