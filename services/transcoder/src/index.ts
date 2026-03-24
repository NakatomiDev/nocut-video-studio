import { Worker, Queue, type Job } from "bullmq";
import { config } from "./config.js";
import { pollQueuedJobs, claimJob, incrementAttempts, completeJob, failJob, type TranscodeJobRow } from "./supabase.js";
import { processTranscodeJob, jobRowToData, type TranscodeJobData } from "./transcoder.js";
import { extractFrames, type FrameExtractionJob } from "./frame-extractor.js";

const QUEUE_NAME = "video.transcode";
const FRAME_QUEUE_NAME = "video.extract_frames";

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

async function main(): Promise<void> {
  log("info", "Transcoder service starting", {
    concurrency: config.concurrency,
    poll_interval_ms: config.pollIntervalMs,
  });

  const connection = {
    url: config.redis.url,
    maxRetriesPerRequest: null as null,
  };

  // Create BullMQ queues
  const queue = new Queue<TranscodeJobData>(QUEUE_NAME, { connection });
  const frameQueue = new Queue<FrameExtractionJob>(FRAME_QUEUE_NAME, { connection });

  // Create BullMQ worker for transcoding
  const worker = new Worker<TranscodeJobData>(
    QUEUE_NAME,
    async (job: Job<TranscodeJobData>) => {
      log("info", "Processing transcode job", {
        job_id: job.data.jobId,
        project_id: job.data.projectId,
        video_id: job.data.videoId,
      });
      await processTranscodeJob(job.data);
    },
    {
      connection,
      concurrency: config.concurrency,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  );

  // Create BullMQ worker for frame extraction
  const frameWorker = new Worker<FrameExtractionJob>(
    FRAME_QUEUE_NAME,
    async (job: Job<FrameExtractionJob>) => {
      log("info", "Processing frame extraction job", {
        job_id: job.data.jobId,
        project_id: job.data.projectId,
        timestamps: job.data.timestamps,
      });
      try {
        const results = await extractFrames(job.data);
        await completeJob(job.data.jobId);
        return results;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("error", "Frame extraction failed", {
          job_id: job.data.jobId,
          error: message,
        });
        await failJob(job.data.jobId, message);
        throw err;
      }
    },
    {
      connection,
      concurrency: config.concurrency,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  );

  worker.on("completed", (job) => {
    log("info", "Job completed successfully", {
      job_id: job.data.jobId,
      project_id: job.data.projectId,
    });
  });

  worker.on("failed", (job, err) => {
    log("error", "Job processing failed", {
      job_id: job?.data.jobId,
      project_id: job?.data.projectId,
      error: err.message,
    });
  });

  worker.on("error", (err) => {
    log("error", "Transcode worker error", { error: err.message });
  });

  frameWorker.on("completed", (job) => {
    log("info", "Frame extraction completed", {
      job_id: job.data.jobId,
      project_id: job.data.projectId,
    });
  });

  frameWorker.on("failed", (job, err) => {
    log("error", "Frame extraction failed", {
      job_id: job?.data.jobId,
      error: err.message,
    });
  });

  frameWorker.on("error", (err) => {
    log("error", "Frame worker error", { error: err.message });
  });

  // Supabase poller: bridge DB job_queue → BullMQ
  const pollerId = setInterval(async () => {
    try {
      const jobs = await pollQueuedJobs(config.concurrency);
      for (const row of jobs) {
        const claimed = await claimJob(row.id);
        if (!claimed) {
          continue;
        }
        await incrementAttempts(row.id);

        if (row.type === "video.extract_frames") {
          const payload = row.payload as { video_s3_key: string; timestamps: number[] };
          const frameData: FrameExtractionJob = {
            jobId: row.id,
            projectId: row.project_id,
            userId: row.user_id,
            videoS3Key: payload.video_s3_key,
            timestamps: payload.timestamps,
          };
          await frameQueue.add(FRAME_QUEUE_NAME, frameData, {
            jobId: frameData.jobId,
            attempts: 1,
          });
          log("info", "Frame extraction job enqueued to BullMQ", {
            job_id: row.id,
            project_id: row.project_id,
          });
        } else {
          const data = jobRowToData(row);
          await queue.add(QUEUE_NAME, data, {
            jobId: data.jobId,
            attempts: 1,
          });
          log("info", "Job claimed and enqueued to BullMQ", {
            job_id: row.id,
            project_id: row.project_id,
          });
        }
      }
    } catch (err) {
      log("error", "Poller error", { error: err instanceof Error ? err.message : String(err) });
    }
  }, config.pollIntervalMs);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log("info", `Received ${signal}, shutting down gracefully...`);
    clearInterval(pollerId);
    await worker.close();
    await frameWorker.close();
    await queue.close();
    await frameQueue.close();
    log("info", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  log("info", "Transcoder service ready, polling for jobs...");
}

main().catch((err) => {
  log("error", "Fatal error starting transcoder", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
