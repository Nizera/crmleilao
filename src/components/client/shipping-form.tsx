"use client";

import { useTransition, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

import { saveShippingData } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BRAZIL_UFS,
  shippingFormSchema,
  type ShippingFormValues,
  type ShippingProfile,
} from "@/lib/customers";
import type { ActionResult } from "@/lib/result";

type CepStatus = "idle" | "loading" | "done" | "notfound" | "error";

const CEP_STATUS_TEXT: Record<CepStatus, string | null> = {
  idle: "Preencha o CEP e clique fora para preencher a rua e a cidade.",
  loading: "Consultando o CEP…",
  done: "Endereço preenchido pelo CEP — confira e complete o número.",
  notfound: "CEP não encontrado — preencha o endereço manualmente.",
  error: "Não foi possível consultar o CEP — preencha manualmente.",
};

function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
}

function formatDocument(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    const parts = [
      digits.slice(0, 3),
      digits.slice(3, 6),
      digits.slice(6, 9),
      digits.slice(9, 11),
    ].filter(Boolean);
    return [parts[0], parts[1] && `.${parts[1]}`, parts[2] && `.${parts[2]}`, parts[3] && `-${parts[3]}`]
      .filter(Boolean)
      .join("");
  }
  const parts = [
    digits.slice(0, 2),
    digits.slice(2, 5),
    digits.slice(5, 8),
    digits.slice(8, 12),
    digits.slice(12, 14),
  ].filter(Boolean);
  return [parts[0], parts[1] && `.${parts[1]}`, parts[2] && `.${parts[2]}`, parts[3] && `/${parts[3]}`, parts[4] && `-${parts[4]}`]
    .filter(Boolean)
    .join("");
}

export function ShippingForm({ initial }: { initial: ShippingProfile }) {
  const [pending, startTransition] = useTransition();
  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");
  const router = useRouter();

  const form = useForm<ShippingFormValues>({
    resolver: zodResolver(shippingFormSchema),
    defaultValues: {
      name: initial.name ?? "",
      email: initial.email ?? "",
      cpf_cnpj: formatDocument(initial.cpf_cnpj ?? ""),
      address_cep: formatCep(initial.address_cep ?? ""),
      address_street: initial.address_street ?? "",
      address_number: initial.address_number ?? "",
      address_complement: initial.address_complement ?? "",
      address_district: initial.address_district ?? "",
      address_city: initial.address_city ?? "",
      address_state: initial.address_state ?? "",
    },
  });

  const cep = useWatch({ control: form.control, name: "address_cep" });
  const uf = useWatch({ control: form.control, name: "address_state" });
  const cpf = useWatch({ control: form.control, name: "cpf_cnpj" });

  const lookupCep = async () => {
    const digits = (cep ?? "").replace(/\D/g, "");
    if (digits.length !== 8) return;

    setCepStatus("loading");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!response.ok) throw new Error("falha na consulta");
      const json = (await response.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (json.erro) {
        setCepStatus("notfound");
        return;
      }

      const fill = (
        name: "address_street" | "address_district" | "address_city" | "address_state",
        value: string | undefined,
      ) => {
        if (!value) return;
        const current = form.getValues(name);
        if (current && current.trim().length > 0) return;
        form.setValue(name, value, { shouldValidate: true, shouldDirty: true });
      };
      fill("address_street", json.logradouro);
      fill("address_district", json.bairro);
      fill("address_city", json.localidade);
      fill("address_state", json.uf);
      setCepStatus("done");
    } catch {
      setCepStatus("error");
    }
  };

  const submit = form.handleSubmit((values) => {
    const fd = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      fd.append(key, String(value));
    }

    startTransition(async () => {
      const result: ActionResult<{ id: string }> = await saveShippingData(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Dados de envio salvos.");
      router.push("/painel");
      router.refresh();
    });
  });

  const {
    formState: { errors },
  } = form;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" />
          Endereço de envio
        </CardTitle>
        <CardDescription>
          O pacote sai da terça seguinte com etiqueta e rastreio — precisamos
          do endereço completo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="name">Nome completo</FieldLabel>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Como devemos te chamar"
              {...form.register("name")}
            />
            <FieldError>{errors.name?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">E-mail</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="voce@email.com"
              {...form.register("email")}
            />
            <FieldDescription>
              Usado para gerar o Pix das suas compras.
            </FieldDescription>
            <FieldError>{errors.email?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.cpf_cnpj}>
            <FieldLabel htmlFor="cpf_cnpj">CPF ou CNPJ</FieldLabel>
            <Input
              id="cpf_cnpj"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={cpf ?? ""}
              onChange={(event) =>
                form.setValue("cpf_cnpj", formatDocument(event.target.value), {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
            />
            <FieldDescription>
              Usado no Pix e na etiqueta dos seus envios.
            </FieldDescription>
            <FieldError>{errors.cpf_cnpj?.message}</FieldError>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field data-invalid={!!errors.address_cep}>
              <FieldLabel htmlFor="address_cep">CEP</FieldLabel>
              <Input
                id="address_cep"
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="01310-100"
                value={cep ?? ""}
                onChange={(event) =>
                  form.setValue("address_cep", formatCep(event.target.value), {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                onBlur={() => void lookupCep()}
              />
              <FieldDescription>{CEP_STATUS_TEXT[cepStatus]}</FieldDescription>
              <FieldError>{errors.address_cep?.message}</FieldError>
            </Field>

            <Field data-invalid={!!errors.address_city}>
              <FieldLabel htmlFor="address_city">Cidade</FieldLabel>
              <Input
                id="address_city"
                autoComplete="address-level2"
                placeholder="São Paulo"
                {...form.register("address_city")}
              />
              <FieldError>{errors.address_city?.message}</FieldError>
            </Field>

            <Field data-invalid={!!errors.address_state}>
              <FieldLabel htmlFor="address_state">UF</FieldLabel>
              <Select
                value={uf}
                onValueChange={(value) =>
                  form.setValue("address_state", value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="address_state" className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {BRAZIL_UFS.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{errors.address_state?.message}</FieldError>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[3fr_1fr]">
            <Field data-invalid={!!errors.address_street}>
              <FieldLabel htmlFor="address_street">Rua</FieldLabel>
              <Input
                id="address_street"
                autoComplete="address-line1"
                placeholder="Rua das Palmeiras"
                {...form.register("address_street")}
              />
              <FieldError>{errors.address_street?.message}</FieldError>
            </Field>

            <Field data-invalid={!!errors.address_number}>
              <FieldLabel htmlFor="address_number">Número</FieldLabel>
              <Input
                id="address_number"
                inputMode="numeric"
                autoComplete="address-line2"
                placeholder="123"
                {...form.register("address_number")}
              />
              <FieldError>{errors.address_number?.message}</FieldError>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.address_district}>
              <FieldLabel htmlFor="address_district">Bairro</FieldLabel>
              <Input
                id="address_district"
                autoComplete="address-level3"
                placeholder="Bela Vista"
                {...form.register("address_district")}
              />
              <FieldError>{errors.address_district?.message}</FieldError>
            </Field>

            <Field data-invalid={!!errors.address_complement}>
              <FieldLabel htmlFor="address_complement">
                Complemento
              </FieldLabel>
              <Input
                id="address_complement"
                autoComplete="address-line3"
                placeholder="Apto 42 (opcional)"
                {...form.register("address_complement")}
              />
              <FieldError>{errors.address_complement?.message}</FieldError>
            </Field>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/painel")}
              disabled={pending}
            >
              Agora não
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar e continuar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
