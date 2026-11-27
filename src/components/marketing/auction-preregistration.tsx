"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveAuctionPreregistration } from "@/app/actions/auction-preregistration";
import { LANDING_GROUP_URL } from "@/lib/landing-content";
import { trackAuctionInviteClick, trackStoreEvent } from "@/lib/meta-browser";

export function AuctionPreregistration({ emailEnabled }: { emailEnabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");

  useEffect(() => {
    const group = new URL(LANDING_GROUP_URL);
    const open = (event: MouseEvent) => {
      if (new URLSearchParams(location.search).get("entrada") !== "pre-cadastro"
        || event.button !== 0 || event.defaultPrevented || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || dialog.current?.contains(link)) return;
      const url = new URL(link.href);
      if (url.origin !== group.origin || url.pathname !== group.pathname || !dialog.current) return;
      event.preventDefault();
      dialog.current.showModal();
    };
    document.addEventListener("click", open, true);
    return () => document.removeEventListener("click", open, true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams(location.search);
    const attribution = Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .flatMap(key => {
          const value = params.get(key);
          return value ? [[key, value.slice(0, 160)]] : [];
        }),
    );
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveAuctionPreregistration({
        name: form.get("name"), phone: form.get("phone"),
        email: String(form.get("email") ?? "").trim(), attribution,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setInvite(result.invite);
      if (result.leadId) {
        trackStoreEvent("Lead", { lead_source: "auction_preregistration" }, result.leadId, true);
      }
    } catch {
      setError("Não foi possível salvar agora. Tente novamente.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const input = "min-h-12 w-full rounded-lg border border-[#575046] bg-[#25221d] px-3 text-base text-white";
  const button = "flex min-h-12 items-center justify-center rounded-lg bg-[#ffd323] px-4 font-bold text-[#15120a] disabled:opacity-60";
  return <dialog ref={dialog} aria-labelledby="auction-preregistration-title"
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-[#575046] bg-[#191713] p-5 text-white backdrop:bg-black/70 sm:p-6">
    <div className="mb-4 flex items-start justify-between gap-3">
      <h2 id="auction-preregistration-title" className="text-xl font-bold">
        {invite ? "Seu convite está pronto" : "Entre no grupo do leilão"}
      </h2>
      <button type="button" className="min-h-10 px-2 text-sm underline" onClick={() => dialog.current?.close()}>
        Fechar
      </button>
    </div>
    {invite ? <div className="grid gap-4">
      <p className="text-sm text-[#eee4d0]">No WhatsApp, toque em <strong>Solicitar entrada</strong> e aguarde a aprovação da equipe.</p>
      <a href={invite} target="_blank" rel="noopener noreferrer" className={button} onClick={trackAuctionInviteClick}>Abrir convite no WhatsApp</a>
    </div> : <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-[#eee4d0]">Preencha seus dados para liberar o convite do grupo.</p>
      <label className="grid gap-1 text-sm">Seu nome
        <input className={input} name="name" autoComplete="name" required minLength={2} maxLength={100} />
      </label>
      <label className="grid gap-1 text-sm">WhatsApp com DDD
        <input className={input} name="phone" type="tel" autoComplete="tel" required maxLength={32} aria-describedby="auction-phone-help" />
        <span id="auction-phone-help" className="text-xs text-[#eee4d0]">Use o número com que vai pedir entrada. Ele ajuda a equipe a localizar seu cadastro se você arrematar.</span>
      </label>
      <label className="grid gap-1 text-sm">E-mail
        <input className={input} name="email" type="email" autoComplete="email" required maxLength={254} />
        {emailEnabled && <span className="text-xs text-[#eee4d0]">Você poderá receber uma cópia do convite por e-mail.</span>}
      </label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="submit" className={button} disabled={saving}>{saving ? "Salvando…" : "Continuar para o WhatsApp"}</button>
    </form>}
  </dialog>;
}
