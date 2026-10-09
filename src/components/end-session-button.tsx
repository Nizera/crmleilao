"use client";

import { LogOut } from "lucide-react";

import { endSession } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

/** Sai da sessão atual (qualquer tipo de conta) e volta para a home. */
export function EndSessionButton() {
  return (
    <Button variant="outline" onClick={() => void endSession()}>
      <LogOut />
      Sair
    </Button>
  );
}
