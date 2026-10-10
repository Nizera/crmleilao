"use client";

import { useActionState } from "react";
import { KeyRound, Loader2, Lock } from "lucide-react";

import { acceptCustomerInvite } from "@/app/actions/auth";
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

export function InviteAcceptForm({
  token,
  name,
  phone,
}: {
  token: string;
  name: string;
  phone: string;
}) {
  const [state, action, pending] = useActionState(
    acceptCustomerInvite,
    undefined,
  );

  return (
    <form action={action} className="w-full">
      <Card className="overflow-hidden p-0">
        <CardContent className="grid gap-6 p-6 md:p-8">
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <KeyRound className="size-5" />
              </span>
              <h1 className="text-2xl font-bold">
                {name ? `Bem-vindo, ${name}!` : "Ative seu painel"}
              </h1>
              <p className="text-balance text-muted-foreground">
                Convite para o número <strong>{phone}</strong>. Crie sua senha
                para entrar no painel.
              </p>
            </div>

            <input type="hidden" name="token" value={token} />

            <Field>
              <FieldLabel htmlFor="password">Nova senha</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                placeholder="Mínimo de 8 caracteres"
                required
                autoFocus
              />
              <FieldDescription>
                Você entra depois com seu WhatsApp e esta senha.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="confirm">Confirmar senha</FieldLabel>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                placeholder="Digite a senha de novo"
                required
              />
            </Field>

            {state?.error ? <FieldError>{state.error}</FieldError> : null}

            <Field>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Criando acesso…
                  </>
                ) : (
                  <>
                    <Lock />
                    Criar senha e entrar
                  </>
                )}
              </Button>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </form>
  );
}
