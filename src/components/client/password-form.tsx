"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { changeOwnPasswordAction } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/result";

type Values = { current: string; next: string; confirm: string };

const EMPTY: Values = { current: "", next: "", confirm: "" };

export function PasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(EMPTY);

  const setField =
    (key: keyof Values) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setValues((current) => ({ ...current, [key]: value }));
      if (error) setError(null);
    };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (values.next.length < 8) {
      setError("A nova senha precisa de pelo menos 8 caracteres.");
      return;
    }
    if (values.next !== values.confirm) {
      setError("As senhas não conferem.");
      return;
    }
    if (values.next === values.current) {
      setError("A nova senha precisa ser diferente da atual.");
      return;
    }

    const formData = new FormData();
    formData.append("current", values.current);
    formData.append("next", values.next);
    formData.append("confirm", values.confirm);
    setError(null);

    startTransition(async () => {
      const result: ActionResult<null> = await changeOwnPasswordAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValues(EMPTY);
      toast.success("Senha alterada. Use a nova senha na próxima entrada.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          Senha de acesso
        </CardTitle>
        <CardDescription>
          A mesma senha usada para entrar no painel. Peça um novo link de
          convite ao leilão se esquecer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="current-password">Senha atual</FieldLabel>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={values.current}
              onChange={setField("current")}
              disabled={pending}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="new-password">Nova senha</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="mínimo de 8 caracteres"
                value={values.next}
                onChange={setField("next")}
                disabled={pending}
                required
              />
            </Field>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="confirm-password">Confirmar senha</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="digite de novo"
                value={values.confirm}
                onChange={setField("confirm")}
                disabled={pending}
                required
              />
            </Field>
          </div>

          <FieldDescription>
            Nunca compartilhe sua senha — o leilão não vai pedir por ela.
          </FieldDescription>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Alterar senha"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
