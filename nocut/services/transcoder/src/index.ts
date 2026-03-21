import { Worker, Queue, type Job } from "bullmq";
import { config } from "./config.js";
import { pollQueuedJobs, claimJob, incrementAttempts } from "./supabase.js";
import { processTranscodeJob, jobRowToData, type TranscodeJobData } from "./transcoder.js";

const QUEUE_NAME = "video.transcode";

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

async function main(): Promise<void> {
  log("info", "Transcoder service starting", {
    concurrency: config.concurrency,
    poll_interval_ms: config.pollIntervalMs,
  });

  // BullMQ connection config — pass URL string, BullMQ uses its bundled ioredis
  const connection = {
    url: config.redis.url,
    maxRetriesPerRequest: null as null, // Required by BullMQ workers
  };

  // Create BullMQ queue for adding jobs
  const queue = new Queue<TranscodeJobData>(QUEUE_NAME, { connection });

  // Create BullMQ worker to process jobs
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
    log("error", "Worker error", { error: err.message });
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
    } catch (err) {
      log("error", "Poller error", { error: err instanceof Error ? err.message : String(err) });
    }
  }, config.pollIntervalMs);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log("info", `Received ${signal}, shutting down gracefully...`);
    clearInterval(pollerId);
    await worker.close();
    await queue.close();
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
