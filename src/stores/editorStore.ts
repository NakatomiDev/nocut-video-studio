import { create } from 'zustand';
import type { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

/** Return all AI fills that match a given cut (fill.startTime within 0.5s of cut.end). */
export function getFillsForCut(
  cut: { end: number },
  aiFills: AiFill[],
): AiFill[] {
  return aiFills.filter((f) => Math.abs(f.startTime - cut.end) < 0.5);
}

export interface ActiveCutSegment {
  start: number;
  end: number;
  fill: AiFill | null;
}

/** Return sorted list of active cut segments with their associated AI fills (if any). */
export function getActiveCutSegments(state: EditorState): ActiveCutSegment[] {
  const { cuts, activeCuts, manualCuts, activeManualCuts, aiFills } = state;
  const allActive = [
    ...cuts.filter((c) => activeCuts.has(c.id)),
    ...manualCuts.filter((c) => activeManualCuts.has(c.id)).map((c) => ({ ...c, type: 'manual' })),
  ].sort((a, b) => a.start - b.start);

  return allActive.map((cut) => {
    const fills = getFillsForCut(cut, aiFills);
    return {
      start: cut.start,
      end: cut.end,
      fill: fills.length > 0 ? fills[0] : null,
    };
  });
}

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
  /** Currently selected fill(s) for preview (null = none, array = chained playback) */
  selectedFill: AiFill | AiFill[] | null;
  /** Maps cutId → selected AI fill duration in seconds (0 = no fill, just cut) */
  fillDurations: Map<string, number>;
  /** Maps cutId → selected AI fill model */
  fillModels: Map<string, AiFillModel>;
  /** Maps cutId → selected prompt (preset ID or "custom:text") */
  fillPrompts: Map<string, string>;
  /** Maps cutId → ordered list of fill IDs (user-defined sequence) */
  fillOrder: Map<string, string[]>;
  /** Maps fillId → user-defined custom name */
  fillNames: Map<string, string>;
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
  setFillPrompt: (cutId: string, prompt: string) => void;
  setPlayhead: (time: number) => void;
  play: () => void;
  pause: () => void;
  setZoom: (level: number) => void;
  setCreditBalance: (balance: CreditBalance) => void;
  setRazorMode: (active: boolean) => void;
  setRazorStart: (time: number | null) => void;
  setAiFills: (fills: AiFill[]) => void;
  toggleShowFills: () => void;
  selectFill: (fill: AiFill | AiFill[] | null) => void;
  insertFill: (fillId: string) => void;
  removeFill: (fillId: string) => void;
  setFillVideoUrl: (fillId: string, url: string) => void;
  setFillOrder: (cutId: string, orderedFillIds: string[]) => void;
  setFillName: (fillId: string, name: string) => void;
  startPreviewGeneration: (cutId: string, jobId: string) => void;
  clearPreviewGeneration: () => void;
  reset: () => void;
}

/** Credits = sum of (fill duration × model credits/sec) for each cut, skipping cuts with existing inserted fills */
const calcCredits = (
  fillDurations: Map<string, number>,
  fillModels: Map<string, AiFillModel>,
  cuts?: Cut[],
  manualCuts?: ManualCut[],
  aiFills?: AiFill[],
  insertedFills?: Set<string>,
) => {
  let total = 0;
  fillDurations.forEach((sec, cutId) => {
    // If this cut already has an inserted (previously generated) fill, it's free to reuse
    if (cuts && aiFills && insertedFills && insertedFills.size > 0) {
      const allCuts = [...cuts, ...(manualCuts ?? [])];
      const cutObj = allCuts.find((c) => c.id === cutId);
      if (cutObj) {
        const matchingFills = getFillsForCut(cutObj, aiFills);
        if (matchingFills.some((f) => insertedFills.has(f.id))) {
          return; // skip — reusing existing fill, no new credits needed
        }
      }
    }
    const model = fillModels.get(cutId) ?? DEFAULT_AI_FILL_MODEL;
    total += sec * MODEL_CREDITS_PER_SEC[model];
  });
  return total;
};

let manualCutCounter = 0;

/** localStorage key for persisting editor UI state per cut map */
const storageKey = (cutMapId: string) => `nocut-editor-state-${cutMapId}`;

interface PersistedEditorState {
  activeCuts: string[];
  activeManualCuts: string[];
  insertedFills: string[];
  fillDurations: [string, number][];
  fillModels: [string, string][];
  fillPrompts: [string, string][];
  fillOrder: [string, string[]][];
  fillNames: [string, string][];
  showFills: boolean;
}

function saveEditorState(state: EditorState) {
  const cm = state.cutMap;
  if (!cm) return;
  try {
    const data: PersistedEditorState = {
      activeCuts: Array.from(state.activeCuts),
      activeManualCuts: Array.from(state.activeManualCuts),
      insertedFills: Array.from(state.insertedFills),
      fillDurations: Array.from(state.fillDurations.entries()),
      fillModels: Array.from(state.fillModels.entries()),
      fillPrompts: Array.from(state.fillPrompts.entries()),
      fillOrder: Array.from(state.fillOrder.entries()),
      fillNames: Array.from(state.fillNames.entries()),
      showFills: state.showFills,
    };
    localStorage.setItem(storageKey(cm.id), JSON.stringify(data));
  } catch { /* quota exceeded or private browsing */ }
}

function loadEditorState(cutMapId: string): PersistedEditorState | null {
  try {
    const raw = localStorage.getItem(storageKey(cutMapId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedEditorState;
  } catch { return null; }
}

/** Persist manual cuts alongside auto-detected cuts in the cut_maps row.
 *  Returns true if the DB write succeeded, false otherwise. */
async function persistManualCuts(
  cutMap: Tables<'cut_maps'> | null,
  autoCuts: Cut[],
  manualCuts: ManualCut[],
): Promise<boolean> {
  if (!cutMap) return false;
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
  const { data, error } = await supabase
    .from('cut_maps')
    .update({ cuts_json: combined as any })
    .eq('id', cutMap.id)
    .select('id')
    .single();

  if (error || !data) {
    console.error('[editorStore] Failed to persist manual cuts:', error);
    toast.error('Failed to save cut — please try again', {
      action: {
        label: 'Retry',
        onClick: () => { persistManualCuts(cutMap, autoCuts, manualCuts); },
      },
    });
    return false;
  }
  return true;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  video: null,
  cutMap: null,
  cuts: [],
  activeCuts: new Set<string>(),
  manualCuts: [],
  activeManualCuts: new Set<string>(),
  aiFills: [],
  showFills: false,
  insertedFills: new Set<string>(),
  fillVideoUrls: new Map<string, string>(),
  selectedFill: null,
  fillDurations: new Map<string, number>(),
  fillModels: new Map<string, AiFillModel>(),
  fillPrompts: new Map<string, string>(),
  fillOrder: new Map<string, string[]>(),
  fillNames: new Map<string, string>(),
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
    
    const defaultActiveCuts = new Set(cuts.filter((c) => c.auto_accept).map((c) => c.id));
    const defaultActiveManualCuts = new Set(manualCuts.map((c) => c.id));

    // Restore persisted UI state if available
    const saved = loadEditorState(cutMap.id);
    const activeCuts = saved
      ? new Set(saved.activeCuts.filter((id) => cuts.some((c) => c.id === id)))
      : defaultActiveCuts;
    const activeManualCuts = saved
      ? new Set(saved.activeManualCuts.filter((id) => manualCuts.some((c) => c.id === id)))
      : defaultActiveManualCuts;
    const fillDurations = saved
      ? new Map(saved.fillDurations.filter(([id]) => cuts.some((c) => c.id === id) || manualCuts.some((c) => c.id === id)))
      : new Map<string, number>();
    const fillModels = saved
      ? new Map(saved.fillModels.filter(([id]) => cuts.some((c) => c.id === id) || manualCuts.some((c) => c.id === id))) as Map<string, AiFillModel>
      : new Map<string, AiFillModel>();
    const fillPrompts = saved?.fillPrompts
      ? new Map(saved.fillPrompts.filter(([id]) => cuts.some((c) => c.id === id) || manualCuts.some((c) => c.id === id)))
      : new Map<string, string>();
    const insertedFills = saved ? new Set(saved.insertedFills) : new Set<string>();
    const fillOrder = saved?.fillOrder
      ? new Map(saved.fillOrder)
      : new Map<string, string[]>();
    const fillNames = saved?.fillNames
      ? new Map(saved.fillNames)
      : new Map<string, string>();
    const showFills = saved?.showFills ?? false;

    set({
      cutMap,
      cuts,
      activeCuts,
      manualCuts,
      activeManualCuts,
      fillDurations,
      fillModels,
      fillPrompts,
      fillOrder,
      fillNames,
      insertedFills,
      showFills,
      creditEstimate: calcCredits(fillDurations, fillModels, cuts, manualCuts, get().aiFills, insertedFills),
    });
  },
  setCuts: (cuts) => set({ cuts }),
  toggleCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeCuts);
      const nextFills = new Map(state.fillDurations);
      const nextModels = new Map(state.fillModels);
      const nextPrompts = new Map(state.fillPrompts);
      if (next.has(cutId)) {
        next.delete(cutId);
        nextFills.delete(cutId);
        nextModels.delete(cutId);
        nextPrompts.delete(cutId);
      } else {
        next.add(cutId);
      }
      return {
        activeCuts: next,
        fillDurations: nextFills,
        fillModels: nextModels,
        fillPrompts: nextPrompts,
        creditEstimate: calcCredits(nextFills, nextModels, state.cuts, state.manualCuts, state.aiFills, state.insertedFills),
      };
    }),
  addManualCut: (start, end) => {
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
        creditEstimate: calcCredits(state.fillDurations, state.fillModels, state.cuts, manualCuts, state.aiFills, state.insertedFills),
      };
    });
    // Persist to DB after state update
    const { cutMap, cuts, manualCuts } = get();
    persistManualCuts(cutMap, cuts, manualCuts);
  },
  removeManualCut: (id) => {
    set((state) => {
      const manualCuts = state.manualCuts.filter((c) => c.id !== id);
      const activeManualCuts = new Set(state.activeManualCuts);
      activeManualCuts.delete(id);
      const nextFills = new Map(state.fillDurations);
      nextFills.delete(id);
      const nextModels = new Map(state.fillModels);
      nextModels.delete(id);
      const nextPrompts = new Map(state.fillPrompts);
      nextPrompts.delete(id);
      return {
        manualCuts,
        activeManualCuts,
        fillDurations: nextFills,
        fillModels: nextModels,
        fillPrompts: nextPrompts,
        creditEstimate: calcCredits(nextFills, nextModels, state.cuts, manualCuts, state.aiFills, state.insertedFills),
      };
    });
    // Persist to DB after state update
    const { cutMap, cuts, manualCuts } = get();
    persistManualCuts(cutMap, cuts, manualCuts);
  },
  toggleManualCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeManualCuts);
      const nextFills = new Map(state.fillDurations);
      const nextModels = new Map(state.fillModels);
      const nextPrompts = new Map(state.fillPrompts);
      if (next.has(cutId)) {
        next.delete(cutId);
        nextFills.delete(cutId);
        nextModels.delete(cutId);
        nextPrompts.delete(cutId);
      } else {
        next.add(cutId);
      }
      return {
        activeManualCuts: next,
        fillDurations: nextFills,
        fillModels: nextModels,
        fillPrompts: nextPrompts,
        creditEstimate: calcCredits(nextFills, nextModels, state.cuts, state.manualCuts, state.aiFills, state.insertedFills),
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
        creditEstimate: calcCredits(nextFills, state.fillModels, state.cuts, state.manualCuts, state.aiFills, state.insertedFills),
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
  setFillPrompt: (cutId, prompt) =>
    set((state) => {
      const next = new Map(state.fillPrompts);
      if (!prompt) {
        next.delete(cutId);
      } else {
        next.set(cutId, prompt);
      }
      return { fillPrompts: next };
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
  setFillOrder: (cutId, orderedFillIds) =>
    set((state) => {
      const next = new Map(state.fillOrder);
      next.set(cutId, orderedFillIds);
      return { fillOrder: next };
    }),
  setFillName: (fillId, name) =>
    set((state) => {
      const next = new Map(state.fillNames);
      if (name.trim()) {
        next.set(fillId, name.trim());
      } else {
        next.delete(fillId);
      }
      return { fillNames: next };
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
      showFills: false,
      insertedFills: new Set(),
      fillVideoUrls: new Map(),
      selectedFill: null,
      fillDurations: new Map(),
      fillModels: new Map(),
      fillPrompts: new Map(),
      fillOrder: new Map(),
      fillNames: new Map(),
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

// Auto-persist UI state whenever relevant fields change
let persistTimer: ReturnType<typeof setTimeout> | null = null;
useEditorStore.subscribe((state, prev) => {
  if (!state.cutMap) return;
  // Only save when persisted fields actually changed
  if (
    state.activeCuts === prev.activeCuts &&
    state.activeManualCuts === prev.activeManualCuts &&
    state.insertedFills === prev.insertedFills &&
    state.fillDurations === prev.fillDurations &&
    state.fillModels === prev.fillModels &&
    state.fillPrompts === prev.fillPrompts &&
    state.fillOrder === prev.fillOrder &&
    state.fillNames === prev.fillNames &&
    state.showFills === prev.showFills
  ) return;
  // Debounce to avoid excessive writes
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => saveEditorState(state), 300);
});
