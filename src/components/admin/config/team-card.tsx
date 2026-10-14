"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { removeMember, updateMemberRole } from "@/app/actions/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamMember } from "@/lib/dal";
import { ADMIN_ROLES, ADMIN_ROLE_HINTS, ADMIN_ROLE_LABELS } from "@/lib/roles";

type Props = {
  team: TeamMember[] | null;
  selfId: string;
  canEdit: boolean;
};

export function TeamCard({ team, selfId, canEdit }: Props) {
  const [pending, startTransition] = useTransition();

  const changeRole = (member: TeamMember, role: string) => {
    startTransition(async () => {
      const result = await updateMemberRole(member.id, role);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Papel de ${member.name ?? member.email} atualizado.`);
    });
  };

  const remove = (member: TeamMember) => {
    const who = member.name ?? member.email ?? "este membro";
    if (!window.confirm(`Remover o acesso da equipe de ${who}?`)) return;

    startTransition(async () => {
      const result = await removeMember(member.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Acesso removido. A conta de e-mail continua no Supabase.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipe</CardTitle>
        <CardDescription>
          Quem acessa o painel da equipe e o que cada papel pode fazer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!team ? (
          <p className="text-sm text-muted-foreground">
            Apenas o dono vê a lista da equipe.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Membro</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Criado em
                    </TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((member) => {
                    const isSelf = member.id === selfId;
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="flex items-center gap-2 font-medium">
                              {member.name ?? member.email ?? "Sem nome"}
                              {isSelf && (
                                <Badge variant="outline" className="text-[10px]">
                                  você
                                </Badge>
                              )}
                            </span>
                            {member.name && (
                              <span className="text-xs text-muted-foreground">
                                {member.email ?? "sem e-mail"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                          <DateBR value={member.created_at} />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={member.role}
                            disabled={pending || !canEdit || isSelf}
                            onValueChange={(value) => changeRole(member, value)}
                          >
                            <SelectTrigger
                              className="w-40"
                              aria-label={`Papel de ${
                                member.name ?? member.email
                              }`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ADMIN_ROLES.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {ADMIN_ROLE_LABELS[role]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="mt-1 hidden text-xs text-muted-foreground lg:block">
                            {ADMIN_ROLE_HINTS[member.role]}
                          </p>
                        </TableCell>
                        <TableCell>
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending || !canEdit}
                              aria-label={`Remover ${
                                member.name ?? member.email
                              }`}
                              onClick={() => remove(member)}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                Como adicionar um novo membro
              </p>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                <li>
                  Crie a conta (e-mail e senha) em Authentication → Users no
                  painel do Supabase.
                </li>
                <li>
                  Rode no SQL Editor, trocando e-mail, papel e nome:
                </li>
              </ol>
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] text-foreground">
                select public.add_admin(&apos;email@exemplo.com&apos;, &apos;staff&apos;,
                &apos;Nome&apos;);
              </pre>
              <p className="mt-2">
                Remover um membro tira só o acesso da equipe; a conta de e-mail
                continua existindo.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
