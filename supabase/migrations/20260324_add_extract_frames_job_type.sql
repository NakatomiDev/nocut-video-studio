-- Add 'video.extract_frames' to the allowed job_queue types so that
-- on-demand boundary-frame extraction jobs can be enqueued by process-ai-fill.
ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS job_queue_type_check;
ALTER TABLE job_queue ADD CONSTRAINT job_queue_type_check
  CHECK (type IN ('video.transcode', 'video.detect', 'ai.fill', 'video.export', 'video.extract_frames'));
