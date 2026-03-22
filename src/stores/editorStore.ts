import { create } from 'zustand';
import type { Tables } from '@/integrations/supabase/types';

export interface Cut {
  id: string;
  start: number;
  end: number;
  duration: number;
  type: string;
  confidence: number;
  auto_accept: boolean;
}

export interface ManualCut {
  id: string;
  start: number;
  end: number;
  duration: number;
}

export const FILL_DURATION_OPTIONS = [1, 2, 3, 5] as const;
export const BUSINESS_FILL_DURATION_OPTIONS = [1, 2, 3, 5, 10] as const;

interface CreditBalance {
  total: number;
  monthly: number;
  topup: number;
}

interface EditorState {
  project: Tables<'projects'> | null;
  video: Tables<'videos'> | null;
  cutMap: Tables<'cut_maps'> | null;
  cuts: Cut[];
  activeCuts: Set<string>;
  manualCuts: ManualCut[];
  activeManualCuts: Set<string>;
  /** Maps cutId → selected AI fill duration in seconds (0 = no fill, just cut) */
  fillDurations: Map<string, number>;
  playheadPosition: number;
  isPlaying: boolean;
  zoomLevel: number;
  creditEstimate: number;
  creditBalance: CreditBalance;
  razorMode: boolean;
  razorStart: number | null;

  setProject: (project: Tables<'projects'>) => void;
  setVideo: (video: Tables<'videos'>) => void;
  setCutMap: (cutMap: Tables<'cut_maps'>) => void;
  setCuts: (cuts: Cut[]) => void;
  toggleCut: (cutId: string) => void;
  addManualCut: (start: number, end: number) => void;
  removeManualCut: (id: string) => void;
  toggleManualCut: (cutId: string) => void;
  setFillDuration: (cutId: string, seconds: number) => void;
  setPlayhead: (time: number) => void;
  play: () => void;
  pause: () => void;
  setZoom: (level: number) => void;
  setCreditBalance: (balance: CreditBalance) => void;
  setRazorMode: (active: boolean) => void;
  setRazorStart: (time: number | null) => void;
  reset: () => void;
}

/** Credits = sum of AI fill durations selected (cuts themselves are free) */
const calcCredits = (fillDurations: Map<string, number>) => {
  let total = 0;
  fillDurations.forEach((sec) => { total += sec; });
  return total;
};

let manualCutCounter = 0;

export const useEditorStore = create<EditorState>((set) => ({
  project: null,
  video: null,
  cutMap: null,
  cuts: [],
  activeCuts: new Set<string>(),
  manualCuts: [],
  activeManualCuts: new Set<string>(),
  playheadPosition: 0,
  isPlaying: false,
  zoomLevel: 1,
  creditEstimate: 0,
  creditBalance: { total: 0, monthly: 0, topup: 0 },
  razorMode: false,
  razorStart: null,

  setProject: (project) => set({ project }),
  setVideo: (video) => set({ video }),
  setCutMap: (cutMap) => {
    const rawCuts = (cutMap.cuts_json as any[]) || [];
    const cuts: Cut[] = rawCuts.map((c, i) => ({
      id: c.id || `cut-${i}`,
      start: c.start ?? c.start_time ?? 0,
      end: c.end ?? c.end_time ?? 0,
      duration: (c.end ?? c.end_time ?? 0) - (c.start ?? c.start_time ?? 0),
      type: c.type || 'silence',
      confidence: c.confidence ?? 0,
      auto_accept: c.auto_accept ?? false,
    }));
    const activeCuts = new Set(cuts.filter((c) => c.auto_accept).map((c) => c.id));
    set((state) => ({
      cutMap,
      cuts,
      activeCuts,
      creditEstimate: calcCredits(cuts, activeCuts, state.manualCuts, state.activeManualCuts),
    }));
  },
  setCuts: (cuts) => set({ cuts }),
  toggleCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeCuts);
      if (next.has(cutId)) next.delete(cutId);
      else next.add(cutId);
      return {
        activeCuts: next,
        creditEstimate: calcCredits(state.cuts, next, state.manualCuts, state.activeManualCuts),
      };
    }),
  addManualCut: (start, end) =>
    set((state) => {
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      if (e - s < 0.1) return state;
      const id = `manual-${++manualCutCounter}`;
      const cut: ManualCut = { id, start: s, end: e, duration: e - s };
      const manualCuts = [...state.manualCuts, cut];
      const activeManualCuts = new Set(state.activeManualCuts);
      activeManualCuts.add(id);
      return {
        manualCuts,
        activeManualCuts,
        creditEstimate: calcCredits(state.cuts, state.activeCuts, manualCuts, activeManualCuts),
      };
    }),
  removeManualCut: (id) =>
    set((state) => {
      const manualCuts = state.manualCuts.filter((c) => c.id !== id);
      const activeManualCuts = new Set(state.activeManualCuts);
      activeManualCuts.delete(id);
      return {
        manualCuts,
        activeManualCuts,
        creditEstimate: calcCredits(state.cuts, state.activeCuts, manualCuts, activeManualCuts),
      };
    }),
  toggleManualCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeManualCuts);
      if (next.has(cutId)) next.delete(cutId);
      else next.add(cutId);
      return {
        activeManualCuts: next,
        creditEstimate: calcCredits(state.cuts, state.activeCuts, state.manualCuts, next),
      };
    }),
  setPlayhead: (time) => set({ playheadPosition: time }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setZoom: (level) => set({ zoomLevel: Math.max(1, Math.min(10, level)) }),
  setCreditBalance: (creditBalance) => set({ creditBalance }),
  setRazorMode: (razorMode) => set({ razorMode, razorStart: null }),
  setRazorStart: (razorStart) => set({ razorStart }),
  reset: () =>
    set({
      project: null,
      video: null,
      cutMap: null,
      cuts: [],
      activeCuts: new Set(),
      manualCuts: [],
      activeManualCuts: new Set(),
      playheadPosition: 0,
      isPlaying: false,
      zoomLevel: 1,
      creditEstimate: 0,
      creditBalance: { total: 0, monthly: 0, topup: 0 },
      razorMode: false,
      razorStart: null,
    }),
}));
