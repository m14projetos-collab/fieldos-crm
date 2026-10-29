"use client";
// Cache único (TanStack Query) + mutações otimistas: a UI muda na hora usando as
// mesmas regras do banco (transitions.ts); o servidor confirma e o cache é revalidado.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { type EnrichedAccount, enrichAll } from "@/lib/domain/enrich";
import {
  type CompleteFollowUpInput, type CreateLeadInput, type Ctx, DomainError, type LogVisitInput,
  type ScheduleVisitInput, applyCompleteFollowUp, applyCreateLead, applyLogVisitOutcome, applyScheduleVisit,
  applyUpdateAccount,
} from "@/lib/domain/transitions";
import {
  type CancelVisitInput, type CreateOpportunityInput, type MoveOpportunityInput, type RescheduleVisitInput,
  type SaveRouteInput, type SetAccountStatusInput, applyCancelVisit, applyCreateOpportunity, applyMoveOpportunity,
  applyRescheduleVisit, applySaveRoute, applySetAccountStatus, applySetRouteStatus,
} from "@/lib/domain/pipeline";
import {
  type DailyLogInput, type GoalInput, type OppPatch, type PlaybookInput, applyDeleteGoal, applyDeletePlaybook,
  applySaveDailyLog, applySaveGoal, applySavePlaybook, applyUpdateOpportunity,
} from "@/lib/domain/records";
import type { Account, RouteStatus, Snapshot } from "@/lib/domain/types";
import { STAGE_LABEL, ACCOUNT_STATUS_LABEL } from "@/lib/domain/constants";
import type { Repo } from "./repo";

const RepoCtx = createContext<Repo | null>(null);

/** Fornece o Repo e mantém UMA inscrição de tempo real para o app inteiro. */
export function RepoProvider({ value, children }: { value: Repo; children: ReactNode }) {
  const qc = useQueryClient();
  useEffect(
    () => value.subscribe(() => void qc.invalidateQueries({ queryKey: key(value.session.orgId) })),
    [value, qc],
  );
  return <RepoCtx.Provider value={value}>{children}</RepoCtx.Provider>;
}

export function useRepo(): Repo {
  const r = useContext(RepoCtx);
  if (!r) throw new Error("RepoProvider ausente");
  return r;
}

const key = (orgId: string) => ["snapshot", orgId] as const;

export function useSnapshot() {
  const repo = useRepo();
  return useQuery({ queryKey: key(repo.session.orgId), queryFn: () => repo.load(), staleTime: 30_000 });
}

export function useEnriched(snapshot: Snapshot | undefined) {
  return useMemo(() => (snapshot ? enrichAll(snapshot) : new Map<string, EnrichedAccount>()), [snapshot]);
}

export function useActions() {
  const repo = useRepo();
  const qc = useQueryClient();
  const k = key(repo.session.orgId);

  const run = useCallback(
    async <I,>(input: I, apply: (s: Snapshot, i: I, c: Ctx) => Snapshot, server: (i: I) => Promise<unknown>, okMsg?: string) => {
      const prev = qc.getQueryData<Snapshot>(k);
      const ctx: Ctx = {
        orgId: repo.session.orgId, userId: repo.session.userId, tz: repo.session.timezone,
        now: new Date(), newId: () => crypto.randomUUID(),
      };
      // 1) aplica localmente (valida as regras antes de ir ao servidor)
      if (prev) {
        try {
          qc.setQueryData<Snapshot>(k, apply(prev, input, ctx));
        } catch (e) {
          if (e instanceof DomainError) {
            toast.error(e.message);
            return false;
          }
          throw e;
        }
      }
      // 2) confirma no servidor
      try {
        await server(input);
        if (okMsg) toast.success(okMsg);
        return true;
      } catch (e) {
        if (prev) qc.setQueryData(k, prev);
        toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
        return false;
      } finally {
        void qc.invalidateQueries({ queryKey: k });
      }
    },
    [qc, k, repo],
  );

  return {
    logVisitOutcome: (i: LogVisitInput) =>
      run(i, applyLogVisitOutcome, (x) => repo.logVisitOutcome(x), "Visita registrada. CRM, pipeline e próximo follow-up atualizados."),
    completeFollowUp: (i: CompleteFollowUpInput) =>
      run(i, applyCompleteFollowUp, (x) => repo.completeFollowUp(x), i.nextInDays != null ? "Feito. Próximo follow-up agendado." : "Follow-up concluído."),
    createLead: (i: CreateLeadInput) => {
      const id = crypto.randomUUID();
      return run({ ...i, id }, (s, x, c) => applyCreateLead(s, x, c, id), (x) => repo.createLead(x), "Lead criado com follow-up Dia 0.").then(
        (ok) => (ok ? id : null),
      );
    },
    scheduleVisit: (i: ScheduleVisitInput, opts?: { silent?: boolean }) => {
      const id = crypto.randomUUID();
      return run({ ...i, id }, (s, x, c) => applyScheduleVisit(s, x, c, id), (x) => repo.scheduleVisit(x), opts?.silent ? undefined : "Visita agendada.").then(
        (ok) => (ok ? id : null),
      );
    },
    updateAccount: (id: string, patch: Partial<Account>, msg?: string) =>
      run({ id, patch }, (s, x, c) => applyUpdateAccount(s, x.id, x.patch, c), (x) => repo.updateAccount(x.id, x.patch), msg),
    moveOpportunity: (i: MoveOpportunityInput) =>
      run(i, applyMoveOpportunity, (x) => repo.moveOpportunity(x), `Oportunidade em ${STAGE_LABEL[i.stage]}. Conta e próxima ação atualizadas.`),
    createOpportunity: (i: Omit<CreateOpportunityInput, "id">) => {
      const id = crypto.randomUUID();
      return run({ ...i, id }, applyCreateOpportunity, (x) => repo.createOpportunity(x), "Oportunidade criada no pipeline.").then(
        (ok) => (ok ? id : null),
      );
    },
    setAccountStatus: (i: SetAccountStatusInput) =>
      run({ ...i, newOppId: crypto.randomUUID() }, applySetAccountStatus, (x) => repo.setAccountStatus(x),
        `Conta em ${ACCOUNT_STATUS_LABEL[i.status]}.`),
    updateOpportunity: (id: string, patch: OppPatch, msg?: string) =>
      run({ id, patch }, (s, x, c) => applyUpdateOpportunity(s, x.id, x.patch, c), (x) => repo.updateOpportunity(x.id, x.patch), msg),
    cancelVisit: (i: CancelVisitInput) => run(i, applyCancelVisit, (x) => repo.cancelVisit(x), "Visita cancelada. Próxima ação mantida."),
    rescheduleVisit: (i: RescheduleVisitInput) => run(i, applyRescheduleVisit, (x) => repo.rescheduleVisit(x), "Visita reagendada."),
    saveRoute: (i: Omit<SaveRouteInput, "id">, msg = "Rota salva.") =>
      run({ ...i, id: crypto.randomUUID() }, applySaveRoute, (x) => repo.saveRoute(x), msg),
    setRouteStatus: (i: { routeId: string; status: RouteStatus }, msg?: string) =>
      run(i, (s, x) => applySetRouteStatus(s, x), (x) => repo.setRouteStatus(x), msg),
    saveGoal: (g: GoalInput) => run(g, applySaveGoal, (x) => repo.saveGoal(x), "Meta salva."),
    deleteGoal: (id: string) => run(id, (s, x) => applyDeleteGoal(s, x), (x) => repo.deleteGoal(x), "Meta removida."),
    saveDailyLog: (d: DailyLogInput) => run(d, applySaveDailyLog, (x) => repo.saveDailyLog(x), "Daily salvo."),
    savePlaybook: (p: PlaybookInput) => run(p, applySavePlaybook, (x) => repo.savePlaybook(x), "Playbook salvo."),
    savePlaybooks: (ps: PlaybookInput[], msg: string) =>
      run(ps, (s, x, c) => x.reduce((acc, p) => applySavePlaybook(acc, p, c), s), async (x) => {
        for (const p of x) await repo.savePlaybook(p);
      }, msg),
    deletePlaybook: (id: string) => run(id, (s, x) => applyDeletePlaybook(s, x), (x) => repo.deletePlaybook(x), "Playbook removido."),
  };
}

/** Vendedor e empresa usados nos scripts de WhatsApp (sem nomes fixos no código). */
export function useScriptCtx() {
  const { session } = useRepo();
  return useMemo(
    () => ({
      sellerName: session.userName.split(" ")[0] || "time comercial",
      companyName: session.orgName.replace(/\s*\(demo\)\s*$/i, "").trim() || "nossa empresa",
    }),
    [session.userName, session.orgName],
  );
}
