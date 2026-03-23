import { useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CloudUpload,
  FileVideo,
  X,
  Loader2,
  AlertCircle,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { useUpload } from "@/hooks/useUpload";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

const Upload = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUpload();

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) upload.selectFile(file);
    },
    [upload.selectFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) upload.selectFile(file);
    },
    [upload.selectFile]
  );

  // Redirect when project becomes ready
  useEffect(() => {
    if (
      upload.projectStatus === "ready" ||
      upload.projectStatus === "detecting"
    ) {
      // Give a moment for the UI to show the status change
      if (upload.projectStatus === "ready" && upload.projectId) {
        const timer = setTimeout(() => {
          navigate(`/project/${upload.projectId}`);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [upload.projectStatus, upload.projectId, navigate]);

  const isUploading =
    upload.stage === "uploading" ||
    upload.stage === "initiating" ||
    upload.stage === "completing";

  const canResume =
    upload.stage === "error" &&
    upload.error !== "Upload cancelled" &&
    upload.progress > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      {/* Close button */}
      <button
        onClick={() => {
          upload.reset();
          navigate("/dashboard");
        }}
        className="absolute right-6 top-6 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="w-full max-w-xl px-6">
        {/* Idle / Drop zone */}
        {upload.stage === "idle" && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-primary/40 bg-secondary/50 p-16 text-center transition-colors hover:border-primary hover:bg-secondary"
          >
            <CloudUpload className="mx-auto h-16 w-16 text-primary" />
            <h2 className="mt-4 text-xl font-semibold text-foreground">
              Drag and drop your video, or click to browse
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              MP4, MOV, WebM, MKV — up to 4GB (Free tier)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* File selected */}
        {upload.stage === "selected" && (
          <div className="rounded-2xl border border-border bg-secondary/50 p-8">
            <div className="flex items-center gap-4">
              <FileVideo className="h-10 w-10 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {upload.fileName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatBytes(upload.fileSize)}
                  {upload.duration > 0 &&
                    ` · ${formatDuration(upload.duration)}`}
                </p>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                onClick={() => upload.reset()}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button onClick={() => upload.startUpload()} className="flex-1 gap-2">
                <CloudUpload className="h-4 w-4" />
                Upload
              </Button>
            </div>
          </div>
        )}

        {/* Uploading / Initiating / Completing */}
        {isUploading && (
          <div className="rounded-2xl border border-border bg-secondary/50 p-8">
            <div className="flex items-center gap-4">
              <FileVideo className="h-10 w-10 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {upload.fileName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {upload.stage === "initiating" && "Preparing upload..."}
                  {upload.stage === "uploading" &&
                    `${upload.speed} MB/s · ${formatEta(upload.eta)} remaining`}
                  {upload.stage === "completing" && "Finalizing upload..."}
                </p>
              </div>
              <span className="text-sm font-medium text-primary">
                {upload.progress}%
              </span>
            </div>
            <Progress value={upload.progress} className="mt-4" />
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => upload.cancelUpload()}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Processing */}
        {upload.stage === "processing" && (
          <div className="rounded-2xl border border-border bg-secondary/50 p-8 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
            <h2 className="mt-4 text-xl font-semibold text-foreground">
              {upload.projectStatus === "transcoding" &&
                "Processing your video..."}
              {upload.projectStatus === "detecting" && "Analyzing audio..."}
              {upload.projectStatus === "ready" && "Ready!"}
              {!["transcoding", "detecting", "ready"].includes(
                upload.projectStatus || ""
              ) && "Processing..."}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {upload.projectStatus === "ready"
                ? "Redirecting to editor..."
                : "This may take a few minutes. You can close this page — we'll notify you when it's ready."}
            </p>
          </div>
        )}

        {/* Error */}
        {upload.stage === "error" && (
          <div className="rounded-2xl border border-destructive/40 bg-secondary/50 p-8">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
              <div>
                <h3 className="font-semibold text-foreground">Upload failed</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {upload.error}
                </p>
                {upload.error?.includes("limit") ||
                upload.error?.includes("exceeds") ? (
                  <Button
                    variant="link"
                    className="mt-2 h-auto p-0 text-primary"
                    onClick={() => navigate("/credits")}
                  >
                    Upgrade your plan <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                onClick={() => upload.reset()}
                className="flex-1"
              >
                Start Over
              </Button>
              {canResume && (
                <Button
                  onClick={() => upload.resumeUpload()}
                  className="flex-1 gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Resume
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Upload;
