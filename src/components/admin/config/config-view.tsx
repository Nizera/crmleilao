"use client";

import { Copy, Download, MessageCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { SettingsForm } from "@/components/admin/config/settings-form";
import { TeamCard } from "@/components/admin/config/team-card";
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
import type { PendingInvite, TeamMember } from "@/lib/dal";
import { formatPhoneBR } from "@/lib/customers";
import { waMessageLink } from "@/lib/lots";
import type { AppSettings } from "@/lib/settings";

export type IntegrationInfo = {
  name: string;
  /** true = chave configurada; false = pendente; null = não verificável aqui. */
  configured: boolean | null;
  detail: string;
};

type Props = {
  selfId: string;
  canEdit: boolean;
  ready: boolean;
  settings: AppSettings;
  team: TeamMember[] | null;
  integrations: IntegrationInfo[];
  invites: PendingInvite[];
};

function invitePath(token: string): string {
  return `/painel/convite?token=${token}`;
}

export function ConfigView({
  selfId,
  canEdit,
  ready,
  settings,
  team,
  integrations,
  invites,
}: Props) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Configuração
          </h2>
          <p className="text-sm text-muted-foreground">
            Parâmetros do leilão, modelos de mensagem, equipe e exportação.
          </p>
        </div>
        {!ready && (
          <Badge variant="destructive">migração 0004 pendente</Badge>
        )}
      </div>

      {!ready && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Aplique <span className="font-mono">0004_settings.sql</span> no SQL
            Editor do Supabase. Até lá os valores mostrados são os padrões e o
            salvamento vai falhar.
          </span>
        </div>
      )}

      <SettingsForm settings={settings} disabled={!canEdit || !ready} />

      <Card>
        <CardHeader>
          <CardTitle>Integrações</CardTitle>
          <CardDescription>Status das chaves configuradas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {integrations.map((item) => (
            <div
              key={item.name}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium">{item.name}</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.detail}
                </p>
              </div>
              <Badge
                variant={
                  item.configured === true
                    ? "default"
                    : item.configured === null
                      ? "secondary"
                      : "outline"
                }
                className="shrink-0"
              >
                {item.configured === true
                  ? "Configurada"
                  : item.configured === null
                    ? "No Supabase"
                    : "Pendente"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acessos de clientes</CardTitle>
          <CardDescription>
            Convites de acesso ainda não utilizados.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum convite pendente. Novos clientes criados pelos lotes
              aparecem aqui automaticamente.
            </p>
          ) : (
            invites.map((invite) => {
              // `expired` vem pronto do servidor: calcular `new Date()` aqui
              // divergiria entre SSR e browser (mismatch de hidratação).
              const expired = invite.expired;
              const path = invitePath(invite.token);
              const absoluteUrl = () =>
                `${window.location.origin}${path}`;

              return (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {invite.name ?? "Sem nome"}
                      </span>
                      <Badge variant="outline">
                        {formatPhoneBR(invite.phone_e164)}
                      </Badge>
                      <Badge
                        variant={expired ? "secondary" : "default"}
                        className="text-[10px]"
                      >
                        {expired
                          ? "Expirado"
                          : (
                            <>
                              Válido até <DateBR value={invite.expires_at} />
                            </>
                          )}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {path}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(absoluteUrl())
                          .then(() => toast.success("Link copiado."))
                          .catch(() => toast.error("Não foi possível copiar."));
                      }}
                    >
                      <Copy />
                      Copiar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.open(
                          waMessageLink(
                            invite.phone_e164,
                             `Oi! Seu acesso ao painel dos Caras das Legends: ${absoluteUrl()}`,
                          ),
                          "_blank",
                          "noopener",
                        )
                      }
                    >
                      <MessageCircle />
                      WhatsApp
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <TeamCard team={team} selfId={selfId} canEdit={canEdit} />

      <Card>
        <CardHeader>
          <CardTitle>Exportar dados (LGPD)</CardTitle>
          <CardDescription>Restrito ao dono.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button variant="outline" asChild>
                <a href="/admin/configuracao/export?tipo=clientes">
                  <Download />
                  Clientes (com endereço)
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/admin/configuracao/export?tipo=lotes">
                  <Download />
                  Lotes e arremates
                </a>
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Apenas o dono exporta os dados.
            </p>
          )}
          <p className="w-full text-xs text-muted-foreground">
            O arquivo de clientes inclui telefone e endereço — trate como dado
            pessoal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
