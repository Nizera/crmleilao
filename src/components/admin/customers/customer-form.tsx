"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { saveCustomer } from "@/app/actions/customers";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerDetail } from "@/lib/dal";
import {
  customerFormSchema,
  formatPhoneBR,
  type CustomerFormValues,
} from "@/lib/customers";
import type { ActionResult } from "@/lib/result";

type Props = {
  customer: CustomerDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CustomerFormSheet({ customer, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {customer ? "Editar cliente" : "Novo cliente"}
          </SheetTitle>
          <SheetDescription>
            O WhatsApp é a chave do cliente — é ele que dá acesso ao painel.
          </SheetDescription>
        </SheetHeader>

        <CustomerForm
          key={customer?.id ?? "new"}
          customer={customer}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function CustomerForm({
  customer,
  onDone,
}: {
  customer: CustomerDetail | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      id: customer?.id ?? "",
      name: customer?.name ?? "",
      phone: customer ? formatPhoneBR(customer.phone_e164) : "",
      email: customer?.email ?? "",
      cpf_cnpj: customer?.cpf_cnpj ?? "",
      notes: customer?.notes ?? "",
    },
  });

  const submit = form.handleSubmit((values) => {
    setServerError(null);

    const fd = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      fd.append(key, String(value));
    }

    startTransition(async () => {
      const result: ActionResult<{ id: string }> = await saveCustomer(fd);

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      toast.success(customer ? "Cliente atualizado." : "Cliente cadastrado.");
      onDone();
    });
  });

  const {
    formState: { errors },
  } = form;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
    >
      <div className="flex flex-col gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="customer-name">Nome</FieldLabel>
          <Input
            id="customer-name"
            autoComplete="off"
            placeholder="Como aparece no grupo"
            {...form.register("name")}
          />
          <FieldError>{errors.name?.message}</FieldError>
        </Field>

        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="customer-phone">WhatsApp</FieldLabel>
          <Input
            id="customer-phone"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+55 11 99999-8888"
            {...form.register("phone")}
          />
          <FieldDescription>
            Mudar o número move o cliente para o novo cadastro do painel.
          </FieldDescription>
          <FieldError>{errors.phone?.message}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="customer-email">E-mail</FieldLabel>
            <Input
              id="customer-email"
              type="email"
              autoComplete="off"
              placeholder="Opcional"
              {...form.register("email")}
            />
            <FieldError>{errors.email?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.cpf_cnpj}>
            <FieldLabel htmlFor="customer-doc">CPF/CNPJ</FieldLabel>
            <Input
              id="customer-doc"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Para a nota do Pix"
              {...form.register("cpf_cnpj")}
            />
            <FieldError>{errors.cpf_cnpj?.message}</FieldError>
          </Field>
        </div>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="customer-notes">Observações</FieldLabel>
          <Textarea
            id="customer-notes"
            rows={3}
            placeholder="Endereço, preferências, combinados… Só a equipe vê."
            {...form.register("notes")}
          />
          <FieldError>{errors.notes?.message}</FieldError>
        </Field>
      </div>

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {serverError}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : customer ? "Salvar alterações" : "Cadastrar"}
        </Button>
      </div>
    </form>
  );
}
