import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Entrar no painel" };

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <Link href="/">
        <Logo className="w-64" />
      </Link>
      <div className="w-full max-w-sm md:max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
