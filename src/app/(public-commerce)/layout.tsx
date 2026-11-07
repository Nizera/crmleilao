import { connection } from "next/server";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import "@/components/raffles/raffle.css";
export const instant=false;
export default async function PublicCommerceLayout({children}:{children:React.ReactNode}){
 await connection();
 return <div className="flex min-h-svh flex-col bg-background"><header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3"><Link href="/"><Logo className="w-36 sm:w-44"/></Link><nav aria-label="Navegação pública" className="flex flex-wrap items-center gap-4 text-sm font-semibold"><Link href="/loja">Loja</Link><Link href="/rifas">Rifas</Link><Link className="rounded-lg bg-primary px-3 py-2 text-primary-foreground" href="/painel/login">Entrar</Link></nav></div></header><main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">{children}</main><footer className="border-t p-5 text-center text-xs text-muted-foreground">Os Caras das Legends · Leilão diário de colecionáveis</footer></div>;
}
