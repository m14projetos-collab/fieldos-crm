"use client";
// Configuração de integrações da org (organizations.settings) e preferências deste aparelho.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { DEFAULT_TEMPLATES, type NavApp, type OrgSettings, type WaTemplate, isSafeWebhookUrl } from "@/lib/domain/integrations";
import { useRepo } from "./hooks";

const key = (orgId: string) => ["org-settings", orgId] as const;

export function useOrgSettings() {
  const repo = useRepo();
  return useQuery({ queryKey: key(repo.session.orgId), queryFn: () => repo.loadOrgSettings(), staleTime: 60_000 });
}

export function useSaveOrgSettings() {
  const repo = useRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: OrgSettings) => {
      if (next.webhook?.enabled && !isSafeWebhookUrl(next.webhook.url)) throw new Error("A URL do webhook precisa ser https e pública.");
      await repo.saveOrgSettings(next);
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(key(repo.session.orgId), next);
      toast.success("Integrações salvas.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar"),
  });
}

/** Modelos de WhatsApp da org; sem nenhum salvo, usa os padrão. */
export function useWaTemplates(): WaTemplate[] {
  const { data } = useOrgSettings();
  const t = data?.whatsapp?.templates;
  return t?.length ? t : DEFAULT_TEMPLATES;
}

// App de navegação: preferência de cada aparelho (o vendedor escolhe no celular dele).
const NAV_KEY = "fieldos:nav-app";
const readNav = (): NavApp => {
  try {
    return localStorage.getItem(NAV_KEY) === "waze" ? "waze" : "google";
  } catch {
    return "google";
  }
};
export const useNavApp = create<{ app: NavApp; setApp: (a: NavApp) => void; hydrate: () => void }>((set) => ({
  // começa em Google no servidor e no 1º render; o AppShell lê a preferência salva depois de montar
  app: "google",
  hydrate: () => set({ app: readNav() }),
  setApp: (app) => {
    try {
      localStorage.setItem(NAV_KEY, app);
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
    set({ app });
  },
}));
