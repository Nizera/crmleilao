"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { adminSignIn, type AuthFormState } from "@/app/actions/auth";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    adminSignIn,
    undefined
  );

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-6 md:p-8">
          <form action={action} className="grid gap-6">
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <LogoMark className="size-5" />
                </span>
                <h1 className="text-2xl font-bold">Painel interno</h1>
                <p className="text-balance text-muted-foreground">
                  Entre com as credenciais da equipe dos Caras das Legends
                </p>
              </div>

              <Field>
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                  required
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Senha</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>

              {state?.error ? <FieldError>{state.error}</FieldError> : null}

              <Field>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Entrando…
                    </>
                  ) : (
                    "Entrar"
                  )}
                </Button>
              </Field>

              <FieldDescription className="text-center">
                É cliente do leilão?{" "}
                <Link
                  href="/painel/login"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Acesse seu painel
                </Link>
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
