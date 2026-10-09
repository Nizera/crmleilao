"use client";

import { Download, TriangleAlert } from "lucide-react";

import { SettingsForm } from "@/components/admin/config/settings-form";
import { TeamCard } from "@/components/admin/config/team-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TeamMember } from "@/lib/dal";
import type { AppSettings } from "@/lib/settings";

export type IntegrationInfo = {
  name: string;
  phase: string;
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
};

export function ConfigView({
  selfId,
  canEdit,
  ready,
  settings,
  team,
  integrations,
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
        <Badge variant={ready ? "secondary" : "destructive"}>
          {ready ? "Fase 5 · ativa" : "migração 0004 pendente"}
        </Badge>
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
          <CardDescription>
            Status das chaves do .env.local e do Supabase. Os valores secretos
            nunca aparecem nesta tela.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {integrations.map((item) => (
            <div
              key={item.name}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.phase}
                  </Badge>
                </div>
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

      <TeamCard team={team} selfId={selfId} canEdit={canEdit} />

      <Card>
        <CardHeader>
          <CardTitle>Exportar dados (LGPD)</CardTitle>
          <CardDescription>
            CSV com separador “;” e UTF-8 com BOM (abre direto no Excel).
            Restrito ao dono.
          </CardDescription>
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
