"use client";

export default function AdminError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <section role="alert" className="mx-auto my-12 max-w-lg space-y-4 rounded-xl border bg-background p-6 text-foreground">
      <h1 className="text-xl font-semibold">Não foi possível atualizar esta tela</h1>
      <p>Se a conexão foi interrompida ou o aplicativo foi atualizado, tente abrir a tela novamente.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded-lg border px-4 py-2" onClick={() => retry()}>Tentar novamente</button>
        <button type="button" className="rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>Recarregar página</button>
      </div>
    </section>
  );
}
