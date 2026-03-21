-- NoCut Upload Tracking
-- Migration: 005_upload_tracking
-- Description: Adds multipart upload tracking columns to the videos table.
-- These columns support the S3 multipart upload flow used by
-- upload-initiate, chunk-complete, and upload-complete Edge Functions.

ALTER TABLE videos
  ADD COLUMN multipart_upload_id TEXT,
  ADD COLUMN total_chunks        INTEGER,
  ADD COLUMN upload_chunks       JSONB DEFAULT '[]';
