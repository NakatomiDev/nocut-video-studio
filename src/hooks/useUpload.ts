import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_CONCURRENT = 4;

export type UploadStage =
  | "idle"
  | "selected"
  | "initiating"
  | "uploading"
  | "completing"
  | "processing"
  | "error";

interface PresignedUrl {
  chunk_index: number;
  url: string;
  expires_at: string;
}

interface UploadState {
  stage: UploadStage;
  file: File | null;
  fileName: string;
  fileSize: number;
  duration: number;
  progress: number;
  speed: number; // MB/s
  eta: number; // seconds
  error: string | null;
  projectId: string | null;
  projectStatus: string | null;
}

const initialState: UploadState = {
  stage: "idle",
  file: null,
  fileName: "",
  fileSize: 0,
  duration: 0,
  progress: 0,
  speed: 0,
  eta: 0,
  error: null,
  projectId: null,
  projectStatus: null,
};

export function useUpload() {
  const [state, setState] = useState<UploadState>(initialState);
  const abortRef = useRef(false);
  const controllersRef = useRef<AbortController[]>([]);
  const completedChunksRef = useRef<Set<number>>(new Set());
  const chunkCompleteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const uploadSessionRef = useRef<{
    uploadSessionId: string;
    presignedUrls: PresignedUrl[];
    totalChunks: number;
  } | null>(null);

  const reset = useCallback(() => {
    abortRef.current = true;
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current = [];
    completedChunksRef.current = new Set();
    chunkCompleteQueueRef.current = Promise.resolve();
    uploadSessionRef.current = null;
    setState(initialState);
    abortRef.current = false;
  }, []);

  const reportChunkComplete = useCallback(
    async (uploadSessionId: string, chunkIndex: number, etag: string) => {
      const previous = chunkCompleteQueueRef.current.catch(() => undefined);

      const current = previous.then(async () => {
        const { data, error } = await supabase.functions.invoke(
          "upload-chunk-complete",
          {
            body: {
              upload_session_id: uploadSessionId,
              chunk_index: chunkIndex,
              etag,
            },
          }
        );

        if (error || data?.error) {
          throw new Error(
            data?.error?.message ||
              error?.message ||
              `Failed to record chunk ${chunkIndex + 1}`
          );
        }
      });

      chunkCompleteQueueRef.current = current.catch(() => undefined);
      return current;
    },
    []
  );

  const selectFile = useCallback(async (file: File) => {
    const allowedTypes = [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
    ];
    if (!allowedTypes.includes(file.type)) {
      setState((s) => ({
        ...s,
        stage: "error",
        error: "Unsupported format. Use MP4, MOV, WebM, or MKV.",
      }));
      return;
    }

    // Detect duration using a hidden video element
    const duration = await new Promise<number>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        resolve(0);
      };
      video.src = URL.createObjectURL(file);
    });

    setState({
      ...initialState,
      stage: "selected",
      file,
      fileName: file.name,
      fileSize: file.size,
      duration,
    });
  }, []);

  const startUpload = useCallback(async () => {
    const { file, fileName, fileSize, duration } = state;
    if (!file) return;

    abortRef.current = false;
    setState((s) => ({ ...s, stage: "initiating", error: null }));

    try {
      // 1. Call upload-initiate
      const { data: initData, error: initError } =
        await supabase.functions.invoke("upload-initiate", {
          body: {
            filename: fileName,
            file_size_bytes: fileSize,
            mime_type: file.type,
            duration_seconds: duration,
          },
        });

      if (initError || !initData?.data) {
        const msg =
          initData?.error?.message || initError?.message || "Upload initiation failed";
        setState((s) => ({ ...s, stage: "error", error: msg }));
        return;
      }

      const {
        project_id,
        upload_session_id,
        total_chunks,
        presigned_urls,
      } = initData.data;

      uploadSessionRef.current = {
        uploadSessionId: upload_session_id,
        presignedUrls: presigned_urls,
        totalChunks: total_chunks,
      };

      setState((s) => ({
        ...s,
        stage: "uploading",
        projectId: project_id,
        progress: 0,
      }));

      // 2. Chunked upload
      await uploadChunks(file, upload_session_id, presigned_urls, total_chunks);

      if (abortRef.current) return;

      // 3. Complete upload
      setState((s) => ({ ...s, stage: "completing" }));

      const { data: completeData, error: completeError } =
        await supabase.functions.invoke("upload-complete", {
          body: { upload_session_id },
        });

      if (completeError || !completeData?.data) {
        const msg =
          completeData?.error?.message ||
          completeError?.message ||
          "Upload completion failed";
        setState((s) => ({ ...s, stage: "error", error: msg }));
        return;
      }

      // 4. Subscribe to project status changes
      setState((s) => ({
        ...s,
        stage: "processing",
        projectStatus: "transcoding",
      }));

      const channel = supabase
        .channel(`project-${project_id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "projects",
            filter: `id=eq.${project_id}`,
          },
          (payload) => {
            const newStatus = payload.new.status as string;
            setState((s) => ({ ...s, projectStatus: newStatus }));
          }
        )
        .subscribe();

      // Cleanup channel on unmount handled by the component
    } catch (err: any) {
      if (!abortRef.current) {
        setState((s) => ({
          ...s,
          stage: "error",
          error: err?.message || "Upload failed",
        }));
      }
    }
  }, [state]);

  const uploadChunks = async (
    file: File,
    uploadSessionId: string,
    presignedUrls: PresignedUrl[],
    totalChunks: number
  ) => {
    const startTime = Date.now();
    let bytesUploaded = 0;

    // Build queue of chunks to upload (skip already completed ones for resume)
    const queue = presignedUrls
      .filter((p) => !completedChunksRef.current.has(p.chunk_index))
      .map((p) => p.chunk_index);

    let queueIndex = 0;

    const uploadOne = async (): Promise<void> => {
      while (queueIndex < queue.length) {
        if (abortRef.current) return;

        const chunkIndex = queue[queueIndex++];
        const urlEntry = presignedUrls.find(
          (p) => p.chunk_index === chunkIndex
        )!;

        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const controller = new AbortController();
        controllersRef.current.push(controller);

        try {
          const response = await fetch(urlEntry.url, {
            method: "PUT",
            body: chunk,
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`Chunk ${chunkIndex} upload failed: ${response.status}`);
          }

          const etag = response.headers.get("ETag") || `"chunk-${chunkIndex}"`;

          // Report chunk completion sequentially to avoid overwriting concurrent updates
          await reportChunkComplete(
            uploadSessionId,
            chunkIndex,
            etag.replace(/"/g, "")
          );

          completedChunksRef.current.add(chunkIndex);
          bytesUploaded += end - start;

          const elapsed = (Date.now() - startTime) / 1000;
          const speedMBs = bytesUploaded / (1024 * 1024) / elapsed;
          const remaining = file.size - bytesUploaded;
          const etaSec = speedMBs > 0 ? remaining / (speedMBs * 1024 * 1024) : 0;

          setState((s) => ({
            ...s,
            progress: Math.round(
              (completedChunksRef.current.size / totalChunks) * 100
            ),
            speed: Math.round(speedMBs * 10) / 10,
            eta: Math.round(etaSec),
          }));
        } catch (err: any) {
          if (err?.name === "AbortError") return;
          throw err;
        }
      }
    };

    // Run up to MAX_CONCURRENT workers
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT, queue.length) },
      () => uploadOne()
    );
    await Promise.all(workers);
  };

  const cancelUpload = useCallback(() => {
    abortRef.current = true;
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current = [];
    setState((s) => ({
      ...s,
      stage: "error",
      error: "Upload cancelled",
    }));
  }, []);

  const resumeUpload = useCallback(async () => {
    const session = uploadSessionRef.current;
    const { file } = state;
    if (!session || !file) return;

    abortRef.current = false;
    setState((s) => ({ ...s, stage: "uploading", error: null }));

    try {
      await uploadChunks(
        file,
        session.uploadSessionId,
        session.presignedUrls,
        session.totalChunks
      );

      if (abortRef.current) return;

      setState((s) => ({ ...s, stage: "completing" }));

      const { data: completeData, error: completeError } =
        await supabase.functions.invoke("upload-complete", {
          body: { upload_session_id: session.uploadSessionId },
        });

      if (completeError || !completeData?.data) {
        const msg =
          completeData?.error?.message ||
          completeError?.message ||
          "Upload completion failed";
        setState((s) => ({ ...s, stage: "error", error: msg }));
        return;
      }

      setState((s) => ({
        ...s,
        stage: "processing",
        projectStatus: "transcoding",
      }));
    } catch (err: any) {
      if (!abortRef.current) {
        setState((s) => ({
          ...s,
          stage: "error",
          error: err?.message || "Upload interrupted",
        }));
      }
    }
  }, [state, reportChunkComplete]);

  return {
    ...state,
    selectFile,
    startUpload,
    cancelUpload,
    resumeUpload,
    reset,
  };
}
