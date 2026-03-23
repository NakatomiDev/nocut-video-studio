import { create } from 'zustand';
import type { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

export interface AiFill {
  id: string;
  editDecisionId: string;
  gapIndex: number;
  /** Time in the original video where the fill starts (= cut end) */
  startTime: number;
  duration: number;
  s3Key: string | null;
  provider: string | null;
  qualityScore: number | null;
  method: string;
}

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

export type AiFillModel =
  | "veo3.1-fast"
  | "veo3.1-fast-audio"
  | "veo2"
  | "veo3.1-standard"
  | "veo3.1-standard-audio"
  | "veo3-standard-audio";

export interface AiFillModelConfig {
  id: AiFillModel;
  label: string;
  creditsPerSec: number;
  audio: boolean;
  durations: number[];
  badge?: string;
}

export const AI_FILL_MODELS: AiFillModelConfig[] = [
  { id: "veo3.1-fast",           label: "Veo 3.1 Fast",             creditsPerSec: 1, audio: false, durations: [4, 6, 8] },
  { id: "veo3.1-fast-audio",     label: "Veo 3.1 Fast + Audio",     creditsPerSec: 2, audio: true,  durations: [4, 6, 8] },
  { id: "veo2",                  label: "Veo 2",                    creditsPerSec: 2, audio: false, durations: [5, 6, 8] },
  { id: "veo3.1-standard",       label: "Veo 3.1 Standard",         creditsPerSec: 3, audio: false, durations: [4, 6, 8] },
  { id: "veo3.1-standard-audio", label: "Veo 3.1 Standard + Audio", creditsPerSec: 4, audio: true,  durations: [4, 6, 8], badge: "Best" },
  { id: "veo3-standard-audio",   label: "Veo 3 Premium Audio",      creditsPerSec: 6, audio: true,  durations: [4, 6, 8] },
];

/** Max fill duration per tier (seconds). */
const TIER_MAX_DURATION: Record<string, number> = { free: 4, pro: 8, business: 8 };

/** Get models available for a tier (only those with at least one valid duration). */
export function getAvailableModels(tier: string): AiFillModelConfig[] {
  const max = TIER_MAX_DURATION[tier] ?? 4;
  return AI_FILL_MODELS.filter((m) => m.durations.some((d) => d <= max));
}

/** Get valid durations for a model + tier combination. */
export function getModelDurations(modelId: AiFillModel, tier: string): number[] {
  const max = TIER_MAX_DURATION[tier] ?? 4;
  const model = AI_FILL_MODELS.find((m) => m.id === modelId);
  if (!model) return [];
  return model.durations.filter((d) => d <= max);
}

export const MODEL_CREDITS_PER_SEC: Record<AiFillModel, number> = Object.fromEntries(
  AI_FILL_MODELS.map((m) => [m.id, m.creditsPerSec]),
) as Record<AiFillModel, number>;

export const DEFAULT_AI_FILL_MODEL: AiFillModel = "veo3.1-fast";

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
  /** AI fills from completed edit decisions */
  aiFills: AiFill[];
  /** Whether to show AI fill overlays on timeline */
  showFills: boolean;
  /** Fill IDs that the user has "inserted" into the timeline for playback */
  insertedFills: Set<string>;
  /** Signed URLs for fill video clips, keyed by fill ID */
  fillVideoUrls: Map<string, string>;
  /** Currently selected fill for preview (null = none) */
  selectedFill: AiFill | null;
  /** Maps cutId → selected AI fill duration in seconds (0 = no fill, just cut) */
  fillDurations: Map<string, number>;
  /** Maps cutId → selected AI fill model */
  fillModels: Map<string, AiFillModel>;
  playheadPosition: number;
  isPlaying: boolean;
  zoomLevel: number;
  creditEstimate: number;
  creditBalance: CreditBalance;
  razorMode: boolean;
  razorStart: number | null;
  /** Cut ID currently being preview-generated (null = idle). Enforces one-at-a-time. */
  previewGeneratingCutId: string | null;
  /** job_queue.id for the in-flight preview job */
  previewJobId: string | null;

  setProject: (project: Tables<'projects'>) => void;
  setVideo: (video: Tables<'videos'>) => void;
  setCutMap: (cutMap: Tables<'cut_maps'>) => void;
  setCuts: (cuts: Cut[]) => void;
  toggleCut: (cutId: string) => void;
  addManualCut: (start: number, end: number) => void;
  removeManualCut: (id: string) => void;
  toggleManualCut: (cutId: string) => void;
  setFillDuration: (cutId: string, seconds: number) => void;
  setFillModel: (cutId: string, model: AiFillModel) => void;
  setPlayhead: (time: number) => void;
  play: () => void;
  pause: () => void;
  setZoom: (level: number) => void;
  setCreditBalance: (balance: CreditBalance) => void;
  setRazorMode: (active: boolean) => void;
  setRazorStart: (time: number | null) => void;
  setAiFills: (fills: AiFill[]) => void;
  toggleShowFills: () => void;
  selectFill: (fill: AiFill | null) => void;
  insertFill: (fillId: string) => void;
  removeFill: (fillId: string) => void;
  setFillVideoUrl: (fillId: string, url: string) => void;
  startPreviewGeneration: (cutId: string, jobId: string) => void;
  clearPreviewGeneration: () => void;
  reset: () => void;
}

/** Credits = sum of (fill duration × model credits/sec) for each cut */
const calcCredits = (fillDurations: Map<string, number>, fillModels: Map<string, AiFillModel>) => {
  let total = 0;
  fillDurations.forEach((sec, cutId) => {
    const model = fillModels.get(cutId) ?? DEFAULT_AI_FILL_MODEL;
    total += sec * MODEL_CREDITS_PER_SEC[model];
  });
  return total;
};

let manualCutCounter = 0;

/** Persist manual cuts alongside auto-detected cuts in the cut_maps row */
function persistManualCuts(
  cutMap: Tables<'cut_maps'> | null,
  autoCuts: Cut[],
  manualCuts: ManualCut[],
) {
  if (!cutMap) return;
  const autoRaw = autoCuts.map((c) => ({
    id: c.id,
    start: c.start,
    end: c.end,
    type: c.type,
    duration: c.duration,
    confidence: c.confidence,
    auto_accept: c.auto_accept,
  }));
  const manualRaw = manualCuts.map((c) => ({
    id: c.id,
    start: c.start,
    end: c.end,
    type: 'manual',
    duration: c.duration,
  }));
  const combined = [...autoRaw, ...manualRaw];
  supabase
    .from('cut_maps')
    .update({ cuts_json: combined as any })
    .eq('id', cutMap.id)
    .then(({ error }) => {
      if (error) console.error('[editorStore] Failed to persist manual cuts:', error);
    });
}

export const useEditorStore = create<EditorState>((set) => ({
  project: null,
  video: null,
  cutMap: null,
  cuts: [],
  activeCuts: new Set<string>(),
  manualCuts: [],
  activeManualCuts: new Set<string>(),
  aiFills: [],
  showFills: true,
  insertedFills: new Set<string>(),
  fillVideoUrls: new Map<string, string>(),
  selectedFill: null,
  fillDurations: new Map<string, number>(),
  fillModels: new Map<string, AiFillModel>(),
  playheadPosition: 0,
  isPlaying: false,
  zoomLevel: 1,
  creditEstimate: 0,
  creditBalance: { total: 0, monthly: 0, topup: 0 },
  razorMode: false,
  razorStart: null,
  previewGeneratingCutId: null,
  previewJobId: null,

  setProject: (project) => set({ project }),
  setVideo: (video) => set({ video }),
  setCutMap: (cutMap) => {
    const rawCuts = (cutMap.cuts_json as any[]) || [];
    // Separate auto-detected cuts from manual cuts
    const autoCuts = rawCuts.filter((c) => c.type !== 'manual');
    const manualRaw = rawCuts.filter((c) => c.type === 'manual');
    
    const cuts: Cut[] = autoCuts.map((c, i) => ({
      id: c.id || `cut-${i}`,
      start: c.start ?? c.start_time ?? 0,
      end: c.end ?? c.end_time ?? 0,
      duration: (c.end ?? c.end_time ?? 0) - (c.start ?? c.start_time ?? 0),
      type: c.type || 'silence',
      confidence: c.confidence ?? 0,
      auto_accept: c.auto_accept ?? false,
    }));
    
    const manualCuts: ManualCut[] = manualRaw.map((c, i) => {
      const id = c.id || `manual-${++manualCutCounter}`;
      return {
        id,
        start: c.start ?? 0,
        end: c.end ?? 0,
        duration: (c.end ?? 0) - (c.start ?? 0),
      };
    });
    // Update counter to avoid ID collisions
    if (manualCuts.length > 0) {
      const maxIdx = Math.max(...manualCuts.map(c => {
        const match = c.id.match(/manual-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      }));
      if (maxIdx > manualCutCounter) manualCutCounter = maxIdx;
    }
    
    const activeCuts = new Set(cuts.filter((c) => c.auto_accept).map((c) => c.id));
    const activeManualCuts = new Set(manualCuts.map((c) => c.id));
    set({
      cutMap,
      cuts,
      activeCuts,
      manualCuts,
      activeManualCuts,
      fillDurations: new Map(),
      fillModels: new Map(),
      creditEstimate: 0,
    });
  },
  setCuts: (cuts) => set({ cuts }),
  toggleCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeCuts);
      const nextFills = new Map(state.fillDurations);
      const nextModels = new Map(state.fillModels);
      if (next.has(cutId)) {
        next.delete(cutId);
        nextFills.delete(cutId);
        nextModels.delete(cutId);
      } else {
        next.add(cutId);
      }
      return {
        activeCuts: next,
        fillDurations: nextFills,
        fillModels: nextModels,
        creditEstimate: calcCredits(nextFills, nextModels),
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
      // Persist to DB
      persistManualCuts(state.cutMap, state.cuts, manualCuts);
      return {
        manualCuts,
        activeManualCuts,
        creditEstimate: calcCredits(state.fillDurations, state.fillModels),
      };
    }),
  removeManualCut: (id) =>
    set((state) => {
      const manualCuts = state.manualCuts.filter((c) => c.id !== id);
      const activeManualCuts = new Set(state.activeManualCuts);
      activeManualCuts.delete(id);
      const nextFills = new Map(state.fillDurations);
      nextFills.delete(id);
      const nextModels = new Map(state.fillModels);
      nextModels.delete(id);
      // Persist to DB
      persistManualCuts(state.cutMap, state.cuts, manualCuts);
      return {
        manualCuts,
        activeManualCuts,
        fillDurations: nextFills,
        fillModels: nextModels,
        creditEstimate: calcCredits(nextFills, nextModels),
      };
    }),
  toggleManualCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeManualCuts);
      const nextFills = new Map(state.fillDurations);
      const nextModels = new Map(state.fillModels);
      if (next.has(cutId)) {
        next.delete(cutId);
        nextFills.delete(cutId);
        nextModels.delete(cutId);
      } else {
        next.add(cutId);
      }
      return {
        activeManualCuts: next,
        fillDurations: nextFills,
        fillModels: nextModels,
        creditEstimate: calcCredits(nextFills, nextModels),
      };
    }),
  setFillDuration: (cutId, seconds) =>
    set((state) => {
      const nextFills = new Map(state.fillDurations);
      if (seconds <= 0) {
        nextFills.delete(cutId);
      } else {
        nextFills.set(cutId, seconds);
      }
      return {
        fillDurations: nextFills,
        creditEstimate: calcCredits(nextFills, state.fillModels),
      };
    }),
  setFillModel: (cutId, model) =>
    set((state) => {
      const nextModels = new Map(state.fillModels);
      nextModels.set(cutId, model);
      return {
        fillModels: nextModels,
        creditEstimate: calcCredits(state.fillDurations, nextModels),
      };
    }),
  setPlayhead: (time) => set({ playheadPosition: time }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setZoom: (level) => set({ zoomLevel: Math.max(1, Math.min(10, level)) }),
  setCreditBalance: (creditBalance) => set({ creditBalance }),
  setRazorMode: (razorMode) => set({ razorMode, razorStart: null }),
  setRazorStart: (razorStart) => set({ razorStart }),
  setAiFills: (aiFills) => set({ aiFills }),
  toggleShowFills: () => set((state) => ({ showFills: !state.showFills })),
  selectFill: (selectedFill) => set({ selectedFill }),
  insertFill: (fillId) =>
    set((state) => {
      const next = new Set(state.insertedFills);
      next.add(fillId);
      return { insertedFills: next };
    }),
  removeFill: (fillId) =>
    set((state) => {
      const next = new Set(state.insertedFills);
      next.delete(fillId);
      return { insertedFills: next };
    }),
  setFillVideoUrl: (fillId, url) =>
    set((state) => {
      const next = new Map(state.fillVideoUrls);
      next.set(fillId, url);
      return { fillVideoUrls: next };
    }),
  startPreviewGeneration: (cutId, jobId) =>
    set({ previewGeneratingCutId: cutId, previewJobId: jobId }),
  clearPreviewGeneration: () =>
    set({ previewGeneratingCutId: null, previewJobId: null }),
  reset: () =>
    set({
      project: null,
      video: null,
      cutMap: null,
      cuts: [],
      activeCuts: new Set(),
      manualCuts: [],
      activeManualCuts: new Set(),
      aiFills: [],
      showFills: true,
      insertedFills: new Set(),
      fillVideoUrls: new Map(),
      selectedFill: null,
      fillDurations: new Map(),
      fillModels: new Map(),
      playheadPosition: 0,
      isPlaying: false,
      zoomLevel: 1,
      creditEstimate: 0,
      creditBalance: { total: 0, monthly: 0, topup: 0 },
      razorMode: false,
      razorStart: null,
      previewGeneratingCutId: null,
      previewJobId: null,
    }),
}));
