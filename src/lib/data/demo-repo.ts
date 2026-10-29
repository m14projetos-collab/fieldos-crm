// Modo demo: tudo no navegador (localStorage), mesmas regras do banco via transitions.ts.
import { DEFAULT_TZ } from "@/lib/domain/dates";
import {
  type Ctx, applyCompleteFollowUp, applyCreateLead, applyLogVisitOutcome, applyScheduleVisit, applyUpdateAccount,
} from "@/lib/domain/transitions";
import type { Session, Snapshot } from "@/lib/domain/types";
import { DEMO_ORG, DEMO_USER, buildDemoSnapshot } from "./demo-seed";
import { type Repo, pickUpdatable } from "./repo";

const KEY = "fieldos-demo-v1";

export class DemoRepo implements Repo {
  session: Session = {
    orgId: DEMO_ORG, orgName: "Takeat (demo)", userId: DEMO_USER, userName: "Michel Alessandro",
    timezone: DEFAULT_TZ, mode: "demo",
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
        if (parsed.savedOn === new Date().toDateString()) return (this.state = parsed.data);
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
  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }
}
