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

interface EditorState {
  project: Tables<'projects'> | null;
  video: Tables<'videos'> | null;
  cutMap: Tables<'cut_maps'> | null;
  cuts: Cut[];
  activeCuts: Set<string>;
  playheadPosition: number;
  isPlaying: boolean;
  zoomLevel: number;

  setProject: (project: Tables<'projects'>) => void;
  setVideo: (video: Tables<'videos'>) => void;
  setCutMap: (cutMap: Tables<'cut_maps'>) => void;
  setCuts: (cuts: Cut[]) => void;
  toggleCut: (cutId: string) => void;
  setPlayhead: (time: number) => void;
  play: () => void;
  pause: () => void;
  setZoom: (level: number) => void;
  reset: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  project: null,
  video: null,
  cutMap: null,
  cuts: [],
  activeCuts: new Set<string>(),
  playheadPosition: 0,
  isPlaying: false,
  zoomLevel: 1,

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
    const activeCuts = new Set(cuts.filter(c => c.auto_accept).map(c => c.id));
    set({ cutMap, cuts, activeCuts });
  },
  setCuts: (cuts) => set({ cuts }),
  toggleCut: (cutId) =>
    set((state) => {
      const next = new Set(state.activeCuts);
      if (next.has(cutId)) next.delete(cutId);
      else next.add(cutId);
      return { activeCuts: next };
    }),
  setPlayhead: (time) => set({ playheadPosition: time }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setZoom: (level) => set({ zoomLevel: Math.max(1, Math.min(10, level)) }),
  reset: () =>
    set({
      project: null,
      video: null,
      cutMap: null,
      cuts: [],
      activeCuts: new Set(),
      playheadPosition: 0,
      isPlaying: false,
      zoomLevel: 1,
    }),
}));
