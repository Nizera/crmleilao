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

type Props = {
  rows: CustomerDetail[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
};

export function CustomersView({ rows, total, page, pageSize, q }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDetail | null>(null);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const buildHref = (nextQuery: string, nextPage: number) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextPage > 1) params.set("p", String(nextPage));
    const search = params.toString();
    return `/admin/clientes${search ? `?${search}` : ""}`;
  };

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
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Base vazia — cadastre quem já arrematou algo."
              : `${total} ${total === 1 ? "cliente na base" : "clientes na base"}.`}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus />
          Novo cliente
        </Button>
      </div>

      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
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
              router.replace("/admin/clientes");
            }}
          >
            Limpar
          </Button>
        )}
      </form>

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
                    {q
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
