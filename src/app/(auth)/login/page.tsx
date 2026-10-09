import Link from "next/link";
import { Trophy } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Entrar no painel" };

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Trophy className="size-4" />
        </span>
        Caras das Legends
      </Link>
      <div className="w-full max-w-sm md:max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
