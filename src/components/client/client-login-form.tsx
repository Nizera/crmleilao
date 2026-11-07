"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import { Loader2, LogIn } from "lucide-react";

import { customerSignIn } from "@/app/actions/auth";
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

export function ClientLoginForm({
  next = "/painel",
  className,
  ...props
}: React.ComponentProps<"div"> & { next?: string }) {
  const [phone, setPhone] = useState("");

  const [pwState, pwAction, pwPending] = useActionState(
    customerSignIn,
    undefined,
  );

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-6 md:p-8">
          <form action={pwAction} className="grid gap-6"><input type="hidden" name="next" value={next} />
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <LogIn className="size-5" />
                </span>
                <h1 className="text-2xl font-bold">Seu painel</h1>
                <p className="text-balance text-muted-foreground">
                  Entre com seu e-mail ou WhatsApp e a senha do seu painel.
                </p>
              </div>

              <Field>
                <FieldLabel htmlFor="phone">E-mail ou WhatsApp</FieldLabel>
                <Input
                  id="phone"
                  name="phone"
                  type="text"
                  autoComplete="username"
                  maxLength={254}
                  placeholder="Seu e-mail ou WhatsApp com DDD"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Senha</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  required
                />
              </Field>

              {pwState?.error ? (
                <FieldError>{pwState.error}</FieldError>
              ) : null}

              <Field>
                <Button type="submit" disabled={pwPending}>
                  {pwPending ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Entrando…
                    </>
                  ) : (
                    <>
                      <LogIn />
                      Entrar no painel
                    </>
                  )}
                </Button>
              </Field>

              <FieldDescription className="text-center">
                <Link href={`/painel/acesso-email?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-4">Criar conta</Link>
                <br />
                <Link href={`/painel/acesso-email?next=${encodeURIComponent(next)}`} className="underline underline-offset-4">Esqueci minha senha</Link>
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
