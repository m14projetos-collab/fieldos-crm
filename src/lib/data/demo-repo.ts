// Modo demo: tudo no navegador (localStorage), mesmas regras do banco via transitions.ts.
import { DEFAULT_TZ } from "@/lib/domain/dates";
import {
  type Ctx, applyCompleteFollowUp, applyCreateLead, applyLogVisitOutcome, applyScheduleVisit, applyUpdateAccount,
} from "@/lib/domain/transitions";
import {
  applyCancelVisit, applyCreateOpportunity, applyMoveOpportunity, applyRescheduleVisit, applySaveRoute, applySetAccountStatus,
  applySetRouteStatus, routeFor,
} from "@/lib/domain/pipeline";
import {
  applyDeleteGoal, applyDeletePlaybook, applySaveDailyLog, applySaveGoal, applySavePlaybook, applyUpdateOpportunity, pickOpp,
} from "@/lib/domain/records";
import type { OrgSettings } from "@/lib/domain/integrations";
import type { Session, Snapshot } from "@/lib/domain/types";
import { DEMO_ORG, DEMO_USER, buildDemoSnapshot } from "./demo-seed";
import { type Repo, pickUpdatable } from "./repo";

const KEY = "fieldos-demo-v1";

export class DemoRepo implements Repo {
  session: Session = {
    orgId: DEMO_ORG, orgName: "Takeat (demo)", userId: DEMO_USER, userName: "Michel Alessandro",
    timezone: DEFAULT_TZ, mode: "demo", role: "admin",
  };
  private state: Snapshot | null = null;
  private listeners = new Set<() => void>();

  private ctx(): Ctx {
    return { orgId: DEMO_ORG, userId: DEMO_USER, tz: this.session.timezone, now: new Date(), newId: () => crypto.randomUUID() };
  }

  private read(): Snapshot {
    if (this.state) return this.state;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { savedOn: string; data: Snapshot };
        // recria a demo a cada dia para as datas relativas fazerem sentido
        if (parsed.savedOn === new Date().toDateString())
          return (this.state = {
            ...parsed.data, routes: parsed.data.routes ?? [], dailyLogs: parsed.data.dailyLogs ?? [],
            playbooks: parsed.data.playbooks ?? [],
          });
      }
    } catch {
      /* storage indisponível: segue em memória */
    }
    return (this.state = buildDemoSnapshot(this.session.timezone));
  }

  private write(next: Snapshot) {
    this.state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify({ savedOn: new Date().toDateString(), data: next }));
    } catch {
      /* ignore */
    }
  }

  reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.state = null;
    this.listeners.forEach((l) => l());
  }

  async load() {
    return structuredClone(this.read());
  }
  async logVisitOutcome(input: Parameters<Repo["logVisitOutcome"]>[0]) {
    this.write(applyLogVisitOutcome(this.read(), input, this.ctx()));
  }
  async completeFollowUp(input: Parameters<Repo["completeFollowUp"]>[0]) {
    this.write(applyCompleteFollowUp(this.read(), input, this.ctx()));
  }
  async createLead(input: Parameters<Repo["createLead"]>[0]) {
    this.write(applyCreateLead(this.read(), input, this.ctx(), input.id));
    return input.id;
  }
  async scheduleVisit(input: Parameters<Repo["scheduleVisit"]>[0]) {
    this.write(applyScheduleVisit(this.read(), input, this.ctx(), input.id));
    return input.id;
  }
  async updateAccount(id: string, patch: Parameters<Repo["updateAccount"]>[1]) {
    this.write(applyUpdateAccount(this.read(), id, pickUpdatable(patch), this.ctx()));
  }
  private do(fn: (s: Snapshot) => Snapshot) {
    this.write(fn(this.read()));
  }
  async moveOpportunity(i: Parameters<Repo["moveOpportunity"]>[0]) {
    this.do((s) => applyMoveOpportunity(s, i, this.ctx()));
  }
  async createOpportunity(i: Parameters<Repo["createOpportunity"]>[0]) {
    this.do((s) => applyCreateOpportunity(s, i, this.ctx()));
    return i.id;
  }
  async setAccountStatus(i: Parameters<Repo["setAccountStatus"]>[0]) {
    this.do((s) => applySetAccountStatus(s, i, this.ctx()));
  }
  async updateOpportunity(id: string, patch: Parameters<Repo["updateOpportunity"]>[1]) {
    this.do((s) => applyUpdateOpportunity(s, id, pickOpp(patch), this.ctx()));
  }
  async cancelVisit(i: Parameters<Repo["cancelVisit"]>[0]) {
    this.do((s) => applyCancelVisit(s, i, this.ctx()));
  }
  async rescheduleVisit(i: Parameters<Repo["rescheduleVisit"]>[0]) {
    this.do((s) => applyRescheduleVisit(s, i, this.ctx()));
  }
  async saveRoute(i: Parameters<Repo["saveRoute"]>[0]) {
    this.do((s) => applySaveRoute(s, i, this.ctx()));
    return routeFor(this.read(), DEMO_USER, i.routeDate)?.id ?? i.id;
  }
  async setRouteStatus(i: Parameters<Repo["setRouteStatus"]>[0]) {
    this.do((s) => applySetRouteStatus(s, i));
  }
  async saveGoal(g: Parameters<Repo["saveGoal"]>[0]) {
    this.do((s) => applySaveGoal(s, g, this.ctx()));
  }
  async deleteGoal(id: string) {
    this.do((s) => applyDeleteGoal(s, id));
  }
  async saveDailyLog(d: Parameters<Repo["saveDailyLog"]>[0]) {
    this.do((s) => applySaveDailyLog(s, d, this.ctx()));
  }
  async savePlaybook(p: Parameters<Repo["savePlaybook"]>[0]) {
    this.do((s) => applySavePlaybook(s, p, this.ctx()));
  }
  async deletePlaybook(id: string) {
    this.do((s) => applyDeletePlaybook(s, id));
  }
  async updateOrgName(name: string) {
    this.session = { ...this.session, orgName: `${name.trim()} (demo)` };
  }
  async loadOrgSettings(): Promise<OrgSettings> {
    try {
      return JSON.parse(localStorage.getItem(`${KEY}:settings`) ?? "{}") as OrgSettings;
    } catch {
      return {};
    }
  }
  async saveOrgSettings(settings: OrgSettings) {
    try {
      localStorage.setItem(`${KEY}:settings`, JSON.stringify(settings));
    } catch {
      /* navegador sem armazenamento: fica só na memória da tela */
    }
  }
  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }
}
