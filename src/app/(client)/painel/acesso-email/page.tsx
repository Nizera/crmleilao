import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/brand/logo";
import { EmailAccessForm } from "@/components/client/email-access-form";
export const metadata = {title:"Criar conta e recuperar acesso"};
export const instant = false;
export default async function EmailAccessPage() {
 await connection();
 return <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted px-5 py-10"><Link href="/"><Logo className="w-60" /></Link><section className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm"><EmailAccessForm enabled={process.env.CUSTOMER_EMAIL_ACCESS_ENABLED?.trim().toLowerCase() === "true"} /></section></main>;
}
