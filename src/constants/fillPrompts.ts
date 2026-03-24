export interface FillPromptPreset {
  id: string;
  label: string;
  prompt: string;
}

export const FILL_PROMPT_PRESETS: FillPromptPreset[] = [
  { id: "smooth", label: "Smooth Transition", prompt: "Smooth transition video clip, seamless continuity, natural head movement" },
  { id: "dynamic-zoom", label: "Dynamic Zoom", prompt: "Dynamic zoom transition, smooth camera push-in with natural motion" },
  { id: "ken-burns", label: "Ken Burns Effect", prompt: "Ken Burns pan and zoom effect, slow cinematic camera movement" },
  { id: "whip-pan", label: "Whip Pan", prompt: "Fast whip pan transition, motion blur, energetic camera movement" },
  { id: "dissolve", label: "Cross Dissolve", prompt: "Gradual cross dissolve transition, smooth blending between scenes" },
  { id: "hold", label: "Natural Hold", prompt: "Natural hold shot, subtle breathing motion, minimal movement, maintain continuity" },
];

export const DEFAULT_FILL_PROMPT_ID = "smooth";

export const MAX_CUSTOM_PROMPT_LENGTH = 200;

/**
 * Resolve a stored prompt value (preset ID or "custom:text") to its actual prompt string.
 * Returns undefined when no custom prompt should override the backend default.
 */
export function resolvePrompt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("custom:")) {
    const text = value.slice(7).trim();
    return text || undefined;
  }
  const preset = FILL_PROMPT_PRESETS.find((p) => p.id === value);
  return preset?.prompt;
}
