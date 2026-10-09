"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { saveAppSettings } from "@/app/actions/settings";
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
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "@/lib/lots";
import type { ActionResult } from "@/lib/result";
import {
  MESSAGE_TEMPLATES,
  renderTemplate,
  settingsFormSchema,
  TEMPLATE_SAMPLE_VARS,
  WEEKDAY_LABELS_FULL,
  type AppSettings,
  type SettingsFormValues,
  type TemplateKey,
} from "@/lib/settings";

type Props = {
  settings: AppSettings;
  disabled: boolean;
};

export function SettingsForm({ settings, disabled }: Props) {
  const [pending, startTransition] = useTransition();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      bid_increment: String(settings.bid_increment).replace(".", ","),
      shipping_weekday: String(settings.shipping_weekday),
      wa_notice_template: settings.wa_notice_template,
      wa_payment_template: settings.wa_payment_template,
      wa_shipping_template: settings.wa_shipping_template,
    },
  });

  const increment = useWatch({
    control: form.control,
    name: "bid_increment",
  });
  const weekday = useWatch({
    control: form.control,
    name: "shipping_weekday",
  });
  const notice = useWatch({
    control: form.control,
    name: "wa_notice_template",
  });
  const payment = useWatch({
    control: form.control,
    name: "wa_payment_template",
  });
  const shipping = useWatch({
    control: form.control,
    name: "wa_shipping_template",
  });

  const previews: Record<TemplateKey, string> = {
    wa_notice_template: notice ?? "",
    wa_payment_template: payment ?? "",
    wa_shipping_template: shipping ?? "",
  };

  const submit = form.handleSubmit((values) => {
    const fd = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      fd.append(key, String(value));
    }

    startTransition(async () => {
      const result: ActionResult<null> = await saveAppSettings(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Configuração salva.");
    });
  });

  const {
    formState: { errors },
  } = form;

  const numericIncrement = Number(increment?.replace(",", ".")) || 0;
  const weekdayIndex = Number(weekday);

  const addPlaceholder = (key: TemplateKey, placeholder: string) => {
    const current = form.getValues(key) ?? "";
    form.setValue(key, `${current}{${placeholder}}`, { shouldDirty: true });
  };

  return (
    <form onSubmit={submit} noValidate className="contents">
      <Card>
        <CardHeader>
          <CardTitle>Parâmetros do leilão</CardTitle>
          <CardDescription>
            Usados no formulário de lote e no banco (data de envio padrão).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:grid sm:grid-cols-2">
          <Field data-invalid={!!errors.bid_increment}>
            <FieldLabel htmlFor="bid_increment">Incremento do lance</FieldLabel>
            <Input
              id="bid_increment"
              inputMode="decimal"
              placeholder="5"
              disabled={disabled}
              {...form.register("bid_increment")}
            />
            <FieldDescription>
              Valor atual: {formatBRL(numericIncrement)} por lance.
            </FieldDescription>
            <FieldError>{errors.bid_increment?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.shipping_weekday}>
            <FieldLabel htmlFor="shipping_weekday">Dia do envio</FieldLabel>
            <Select
              value={weekday}
              disabled={disabled}
              onValueChange={(value) =>
                form.setValue("shipping_weekday", value, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="shipping_weekday" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_LABELS_FULL.map((label, index) => (
                  <SelectItem key={label} value={String(index)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Padrão do lote: {WEEKDAY_LABELS_FULL[weekdayIndex] ?? "—"}{" "}
              seguinte à data do leilão.
            </FieldDescription>
            <FieldError>{errors.shipping_weekday?.message}</FieldError>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modelos de mensagem WhatsApp</CardTitle>
          <CardDescription>
            Texto aberto no WhatsApp da família. Use as chaves entre chaves
            {" {"}…{"}"} para puxar dados do lote; a prévia usa um exemplo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {MESSAGE_TEMPLATES.map((template) => (
            <div key={template.key} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <FieldLabel htmlFor={template.key} className="font-medium">
                  {template.title}
                </FieldLabel>
                <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {template.phase}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {template.description}
              </p>
              <Textarea
                id={template.key}
                rows={4}
                disabled={disabled}
                className="font-mono text-xs"
                {...form.register(template.key)}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Chaves:</span>
                {template.placeholders.map((placeholder) => (
                  <button
                    key={placeholder}
                    type="button"
                    disabled={disabled}
                    onClick={() => addPlaceholder(template.key, placeholder)}
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                  >
                    {`{${placeholder}}`}
                  </button>
                ))}
              </div>
              <FieldError>{errors[template.key]?.message}</FieldError>
              <p className="text-xs font-medium text-muted-foreground">
                Prévia:
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono text-xs text-foreground">
                {renderTemplate(previews[template.key], TEMPLATE_SAMPLE_VARS) ||
                  "—"}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {disabled && (
          <p className="mr-auto text-sm text-muted-foreground">
            Só o dono altera a configuração.
          </p>
        )}
        <Button type="submit" disabled={pending || disabled}>
          {pending ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </form>
  );
}
