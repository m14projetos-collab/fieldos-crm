"use client";
import { create } from "zustand";

export type MoveRequest =
  | { kind: "opp"; id: string; target: import("@/lib/domain/types").OppStage }
  | { kind: "account"; id: string; target: import("@/lib/domain/types").AccountStatus };

interface UiState {
  move: MoveRequest | null;
  setMove: (m: MoveRequest | null) => void;
  drawerAccountId: string | null;
  /** última ficha aberta: a aba lateral "Ficha 360º" reabre ela no desktop */
  lastDrawerAccountId: string | null;
  quickLog: { open: boolean; visitId: string | null };
  paletteOpen: boolean;
  newLeadOpen: boolean;
  schedule: { open: boolean; accountId: string | null };
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
  openQuickLog: (visitId?: string | null) => void;
  closeQuickLog: () => void;
  setPalette: (open: boolean) => void;
  setNewLead: (open: boolean) => void;
  openSchedule: (accountId?: string | null) => void;
  closeSchedule: () => void;
}

export const useUi = create<UiState>((set) => ({
  move: null,
  setMove: (move) => set({ move }),
  drawerAccountId: null,
  lastDrawerAccountId: null,
  quickLog: { open: false, visitId: null },
  paletteOpen: false,
  newLeadOpen: false,
  schedule: { open: false, accountId: null },
  openDrawer: (id) => set({ drawerAccountId: id, lastDrawerAccountId: id }),
  closeDrawer: () => set({ drawerAccountId: null }),
  openQuickLog: (visitId = null) => set({ quickLog: { open: true, visitId } }),
  closeQuickLog: () => set({ quickLog: { open: false, visitId: null } }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setNewLead: (newLeadOpen) => set({ newLeadOpen }),
  openSchedule: (accountId = null) => set({ schedule: { open: true, accountId } }),
  closeSchedule: () => set({ schedule: { open: false, accountId: null } }),
}));
