"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search } from "lucide-react";

import { CustomerFormSheet } from "@/components/admin/customers/customer-form";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerDetail } from "@/lib/dal";
import { formatPhoneBR } from "@/lib/customers";
import { formatDateBR } from "@/lib/lots";
import { adminListHref, CUSTOMER_ISSUES, type CustomerIssue } from "@/lib/admin-list-filters";

type Props = {
  rows: CustomerDetail[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  issue?: CustomerIssue;
  dateFrom?: string;
  dateTo?: string;
  filterError?: string;
};

export function CustomersView({ rows, total, page, pageSize, q, issue = "all", dateFrom = "", dateTo = "", filterError = "" }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDetail | null>(null);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const buildHref = (nextQuery: string, nextPage: number, nextIssue = issue, range = { from: dateFrom, to: dateTo }) => adminListHref("/admin/clientes", {
    q: nextQuery.trim(), p: nextPage > 1 ? nextPage : undefined, issue: nextIssue === "all" ? undefined : nextIssue, ...range,
  });

  const search = (event: FormEvent) => {
    event.preventDefault();
    router.replace(buildHref(query, 1));
  };

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (customer: CustomerDetail) => {
    setEditing(customer);
    setSheetOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Nenhum cliente encontrado."
              : `${total} ${total === 1 ? "cliente encontrado" : "clientes encontrados"}.`}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus />
          Novo cliente
        </Button>
      </div>

      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full flex-1 sm:basis-0">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {q && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQuery("");
              router.replace(buildHref("", 1));
            }}
          >
            Limpar
          </Button>
        )}
        <select aria-label="Pendência cadastral" className="h-9 max-w-full rounded-md border bg-background px-3 text-sm" value={issue} onChange={event => router.replace(buildHref(query, 1, event.target.value as CustomerIssue))}>
          {Object.entries(CUSTOMER_ISSUES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </form>

      {(dateFrom || issue !== "all") && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
        <p>{issue !== "all" ? `Filtro: ${CUSTOMER_ISSUES[issue]}. ` : ""}{dateFrom ? `Clientes com lotes cadastrados de ${formatDateBR(dateFrom.slice(0, 10))} às ${dateFrom.slice(11)} até ${formatDateBR(dateTo.slice(0, 10))} às ${dateTo.slice(11)} (São Paulo).` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {dateFrom && <Button asChild size="sm" variant="outline"><Link href={buildHref(q, 1, issue, { from: "", to: "" })}>Todos os períodos</Link></Button>}
          <Button asChild size="sm" variant="ghost"><Link href="/admin/clientes">Limpar todos os filtros</Link></Button>
        </div>
      </div>}
      {filterError && <p role="alert" className="text-sm text-destructive">{filterError}</p>}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead className="hidden md:table-cell">E-mail</TableHead>
              <TableHead className="hidden lg:table-cell">CPF/CNPJ</TableHead>
              <TableHead className="hidden lg:table-cell">Cadastrado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <Link
                    href={`/admin/clientes/${customer.id}`}
                    className="font-medium hover:underline"
                  >
                    {customer.name || "Sem nome"}
                  </Link>
                  {issue !== "all" && <span className="block text-xs text-amber-700 dark:text-amber-300">{CUSTOMER_ISSUES[issue]}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatPhoneBR(customer.phone_e164)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {customer.email ?? "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {customer.cpf_cnpj ?? "—"}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  <DateBR value={customer.created_at} />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${customer.name ?? "cliente"}`}
                    onClick={() => openEdit(customer)}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}

            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <span className="text-muted-foreground">
                    {q || issue !== "all" || dateFrom
                      ? "Nenhum cliente corresponde à busca."
                      : "Nenhum cliente ainda. Use “Novo cliente”."}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {pages} · {total} clientes
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(q, page - 1)}>
                  <ChevronLeft />
                  Anterior
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft />
                Anterior
              </Button>
            )}
            {page < pages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(q, page + 1)}>
                  Próxima
                  <ChevronRight />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Próxima
                <ChevronRight />
              </Button>
            )}
          </div>
        </div>
      )}

      <CustomerFormSheet
        customer={editing}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
