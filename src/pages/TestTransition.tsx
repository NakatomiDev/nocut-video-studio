import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload, Play, Download, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MODELS = [
  { id: "veo-2.0-generate-preview", label: "Veo 2.0" },
  { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast" },
  { id: "veo-3.1-generate-preview", label: "Veo 3.1 Standard" },
];

const TestTransition = () => {
  useDocumentTitle("Test Transition — NoCut");

  const [firstImage, setFirstImage] = useState<File | null>(null);
  const [lastImage, setLastImage] = useState<File | null>(null);
  const [firstPreview, setFirstPreview] = useState<string | null>(null);
  const [lastPreview, setLastPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Smooth transition, seamless continuity, natural head movement, same person speaking");
  const [duration, setDuration] = useState(5);
  const [model, setModel] = useState(MODELS[0].id);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const firstRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = useCallback(
    (which: "first" | "last") => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      if (which === "first") {
        setFirstImage(file);
        setFirstPreview(url);
      } else {
        setLastImage(file);
        setLastPreview(url);
      }
    },
    [],
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

      setStatus("Sending to Veo API... This may take up to 5 minutes.");

      const { data, error: fnError } = await supabase.functions.invoke(
        "test-veo-transition",
        {
          body: {
            first_image_base64,
            last_image_base64,
            prompt,
            duration,
            model,
          },
        },
      );

      if (fnError) {
        throw new Error(fnError.message || "Edge function error");
      }

      if (data?.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      // Convert base64 video to blob URL
      const videoBase64 = data.video_base64;
      const byteChars = atob(videoBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setElapsed(data.elapsed_seconds);
      setStatus(`✅ Done! Generated in ${data.elapsed_seconds}s (${(data.size_bytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
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
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Veo Transition Test</h1>
          <p className="text-sm text-muted-foreground">
            Upload two boundary frames and generate a transition video between them.
          </p>
        </div>

        {/* Image Upload Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* First Frame */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">First Frame (Start)</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                onClick={() => firstRef.current?.click()}
                className="flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/30 bg-secondary/50 transition-colors hover:border-primary"
              >
                {firstPreview ? (
                  <img src={firstPreview} alt="First frame" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">Click to upload</p>
                  </div>
                )}
              </div>
              <input ref={firstRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect("first")} />
            </CardContent>
          </Card>

          {/* Arrow */}
          <div className="hidden items-center justify-center md:flex md:col-span-2 md:col-start-1 md:row-start-1 pointer-events-none absolute inset-0">
          </div>

          {/* Last Frame */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Last Frame (End)</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                onClick={() => lastRef.current?.click()}
                className="flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/30 bg-secondary/50 transition-colors hover:border-primary"
              >
                {lastPreview ? (
                  <img src={lastPreview} alt="Last frame" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">Click to upload (optional)</p>
                  </div>
                )}
              </div>
              <input ref={lastRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect("last")} />
            </CardContent>
          </Card>
        </div>

        {/* Arrow between cards */}
        <div className="flex items-center justify-center -mt-4 -mb-2">
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Generates transition between frames</span>
        </div>

        {/* Settings */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="prompt">Prompt</Label>
              <Input
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the transition..."
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="duration">Duration (seconds)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={1}
                  max={8}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={!firstImage || loading}
          className="w-full gap-2"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Generate Transition Video
            </>
          )}
        </Button>

        {/* Status */}
        {status && (
          <p className="text-center text-sm text-muted-foreground">{status}</p>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Video Result */}
        {videoUrl && (
          <Card className="border-primary/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Generated Transition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <video
                src={videoUrl}
                controls
                autoPlay
                loop
                className="w-full rounded-lg"
              />
              <Button onClick={handleDownload} variant="outline" className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download MP4
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default TestTransition;
