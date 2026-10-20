"use client";

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
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [phone, setPhone] = useState("");

  const [pwState, pwAction, pwPending] = useActionState(
    customerSignIn,
    undefined,
  );

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-6 md:p-8">
          <form action={pwAction} className="grid gap-6">
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <LogIn className="size-5" />
                </span>
                <h1 className="text-2xl font-bold">Seu painel</h1>
                <p className="text-balance text-muted-foreground">
                  Entre com o WhatsApp do leilão e a senha que você criou no
                  convite.
                </p>
              </div>

              <Field>
                <FieldLabel htmlFor="phone">WhatsApp</FieldLabel>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="(11) 99999-8888"
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
                Primeiro acesso ou esqueceu a senha? Peça um novo{" "}
                <span className="font-medium text-foreground">
                  link de convite
                </span>{" "}
                ao admin.
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
