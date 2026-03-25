import { useState, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload, Play, Download, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface ModelConfig {
  id: string;
  label: string;
  durations: number[];
  defaultDuration: number;
  audio: boolean;
}

const MODELS: ModelConfig[] = [
  {
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1 Standard",
    durations: [4, 6, 8],
    defaultDuration: 8,
    audio: true,
  },
  {
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
    durations: [4, 6, 8],
    defaultDuration: 8,
    audio: true,
  },
  {
    id: "veo-2.0-generate-001",
    label: "Veo 2.0 (Silent)",
    durations: [5, 6, 7, 8],
    defaultDuration: 5,
    audio: false,
  },
];

const VeoTester = () => {
  const [firstImage, setFirstImage] = useState<File | null>(null);
  const [lastImage, setLastImage] = useState<File | null>(null);
  const [firstPreview, setFirstPreview] = useState<string | null>(null);
  const [lastPreview, setLastPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Smooth transition, seamless continuity, natural head movement, same person speaking");
  const [modelIndex, setModelIndex] = useState(0);
  const [duration, setDuration] = useState(MODELS[0].defaultDuration);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const firstRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);

  const selectedModel = MODELS[modelIndex];

  const handleModelChange = useCallback((idx: number) => {
    setModelIndex(idx);
    const model = MODELS[idx];
    // Reset duration to default if current duration isn't valid for new model
    if (!model.durations.includes(duration)) {
      setDuration(model.defaultDuration);
    }
  }, [duration]);

  const handleImageSelect = useCallback(
    (which: "first" | "last") => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      if (which === "first") { setFirstImage(file); setFirstPreview(url); }
      else { setLastImage(file); setLastPreview(url); }
    }, []
  );

  const handleGenerate = async () => {
    if (!firstImage) return;
    setLoading(true);
    setStatus("Converting images to base64...");
    setError(null);
    setVideoUrl(null);
    setElapsed(null);

    try {
      const first_image_base64 = await fileToBase64(firstImage);
      const last_image_base64 = lastImage ? await fileToBase64(lastImage) : null;
      setStatus(`Sending to ${selectedModel.label}... This may take up to 5 minutes.`);

      // Use raw fetch to get binary response
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      const resp = await fetch(`${supabaseUrl}/functions/v1/test-veo-transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${session?.access_token ?? supabaseKey}`,
        },
        body: JSON.stringify({
          first_image_base64,
          last_image_base64,
          prompt,
          duration,
          model: selectedModel.id,
        }),
      });

      const contentType = resp.headers.get("content-type") || "";

      if (contentType.includes("video/mp4")) {
        // Binary video response
        const blob = await resp.blob();
        setVideoUrl(URL.createObjectURL(blob));
        const elapsedSec = Number(resp.headers.get("x-video-elapsed") || "0");
        const sizeBytes = Number(resp.headers.get("x-video-size") || blob.size);
        setElapsed(elapsedSec);
        setStatus(`✅ Done! Generated in ${elapsedSec}s (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        // JSON error response
        const data = await resp.json();
        throw new Error(data?.error?.message || data?.message || `API returned ${resp.status}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `transition_${Date.now()}.mp4`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader className="pb-3"><CardTitle className="text-base">First Frame (Start)</CardTitle></CardHeader>
          <CardContent>
            <div onClick={() => firstRef.current?.click()} className="flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/30 bg-secondary/50 transition-colors hover:border-primary">
              {firstPreview ? <img src={firstPreview} alt="First frame" className="h-full w-full object-cover" /> : (
                <div className="text-center"><Upload className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">Click to upload</p></div>
              )}
            </div>
            <input ref={firstRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect("first")} />
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3"><CardTitle className="text-base">Last Frame (End)</CardTitle></CardHeader>
          <CardContent>
            <div onClick={() => lastRef.current?.click()} className="flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/30 bg-secondary/50 transition-colors hover:border-primary">
              {lastPreview ? <img src={lastPreview} alt="Last frame" className="h-full w-full object-cover" /> : (
                <div className="text-center"><Upload className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">Click to upload (optional)</p></div>
              )}
            </div>
            <input ref={lastRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect("last")} />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-center"><ArrowRight className="h-5 w-5 text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Generates transition between frames</span></div>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label htmlFor="veo-prompt">Prompt</Label><Input id="veo-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="veo-model">Model</Label>
              <select
                id="veo-model"
                value={modelIndex}
                onChange={(e) => handleModelChange(Number(e.target.value))}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {MODELS.map((m, i) => <option key={m.id} value={i}>{m.label}</option>)}
              </select>
              {!selectedModel.audio && (
                <p className="mt-1 text-xs text-muted-foreground">Silent — no audio generated</p>
              )}
            </div>
            <div>
              <Label htmlFor="veo-duration">Duration</Label>
              <select
                id="veo-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {selectedModel.durations.map((d) => (
                  <option key={d} value={d}>{d} seconds</option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleGenerate} disabled={!firstImage || loading} className="w-full gap-2" size="lg">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><Play className="h-4 w-4" />Generate Transition Video</>}
      </Button>

      {status && <p className="text-center text-sm text-muted-foreground">{status}</p>}
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4"><p className="text-sm text-destructive">{error}</p></div>}
      {videoUrl && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3"><CardTitle className="text-base">Generated Transition</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <video src={videoUrl} controls autoPlay loop className="w-full rounded-lg" />
            <Button onClick={handleDownload} variant="outline" className="w-full gap-2"><Download className="h-4 w-4" />Download MP4</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default VeoTester;
