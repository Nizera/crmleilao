"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, LogIn, MessageCircle, ShieldCheck } from "lucide-react";

import {
  customerSignIn,
  requestCustomerOtp,
  verifyCustomerOtp,
  type AuthFormState,
} from "@/app/actions/auth";
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

function maskPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length < 8) return raw;
  return `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}`;
}

export function ClientLoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");

  // A troca de etapa acontece dentro da action (contexto de transição),
  // não em useEffect — evita render em cascata.
  const sendOtp = async (_prev: AuthFormState, formData: FormData) => {
    const result = await requestCustomerOtp(_prev, formData);
    if (result?.notice) {
      setPhone(String(formData.get("phone") ?? ""));
      setStep("code");
    }
    return result;
  };

  const [pwState, pwAction, pwPending] = useActionState(
    customerSignIn,
    undefined,
  );
  const [otpState, otpAction, otpPending] = useActionState(sendOtp, undefined);
  const [codeState, codeAction, codePending] = useActionState(
    verifyCustomerOtp,
    undefined,
  );

  const switchMode = (next: "password" | "otp") => {
    setMode(next);
    setStep("phone");
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-6 md:p-8">
          {mode === "password" ? (
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
                  Primeiro acesso?{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => switchMode("otp")}
                  >
                    Receber código no WhatsApp
                  </button>
                </FieldDescription>
                <FieldDescription className="text-center">
                  Esqueceu a senha? Peça um novo link de convite ao admin.
                </FieldDescription>
              </FieldGroup>
            </form>
          ) : step === "phone" ? (
            <form action={otpAction} className="grid gap-6">
              <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <MessageCircle className="size-5" />
                  </span>
                  <h1 className="text-2xl font-bold">Seu painel</h1>
                  <p className="text-balance text-muted-foreground">
                    Informe o WhatsApp cadastrado no leilão. Enviamos um código
                    de 6 dígitos.
                  </p>
                </div>

                <Field>
                  <FieldLabel htmlFor="otp-phone">WhatsApp</FieldLabel>
                  <Input
                    id="otp-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="(11) 99999-8888"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <FieldDescription>
                    Use o mesmo número do grupo Caras das Legends.
                  </FieldDescription>
                </Field>

                {otpState?.error ? (
                  <FieldError>{otpState.error}</FieldError>
                ) : null}

                <Field>
                  <Button type="submit" disabled={otpPending}>
                    {otpPending ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Enviando…
                      </>
                    ) : (
                      <>
                        <MessageCircle />
                        Receber código
                      </>
                    )}
                  </Button>
                </Field>

                <FieldDescription className="text-center">
                  Já tem senha?{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => switchMode("password")}
                  >
                    Entrar com senha
                  </button>
                </FieldDescription>
              </FieldGroup>
            </form>
          ) : (
            <form action={codeAction} className="grid gap-6">
              <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <ShieldCheck className="size-5" />
                  </span>
                  <h1 className="text-2xl font-bold">Confirme o código</h1>
                  <p className="text-balance text-muted-foreground">
                    {otpState?.notice} Número {maskPhone(phone)}.
                  </p>
                </div>

                <input type="hidden" name="phone" value={phone} />

                <Field>
                  <FieldLabel htmlFor="token">Código de 6 dígitos</FieldLabel>
                  <Input
                    id="token"
                    name="token"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    className="text-center text-lg tracking-[0.5em]"
                    required
                    autoFocus
                  />
                </Field>

                {codeState?.error ? (
                  <FieldError>{codeState.error}</FieldError>
                ) : null}

                <Field className="gap-2">
                  <Button type="submit" disabled={codePending}>
                    {codePending ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Verificando…
                      </>
                    ) : (
                      "Entrar no painel"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep("phone")}
                    disabled={codePending}
                  >
                    <ArrowLeft />
                    Trocar número
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>

      <FieldDescription className="px-6 text-center">
        É da equipe?{" "}
        <Link
          href="/login"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Painel interno
        </Link>
      </FieldDescription>
    </div>
  );
}
