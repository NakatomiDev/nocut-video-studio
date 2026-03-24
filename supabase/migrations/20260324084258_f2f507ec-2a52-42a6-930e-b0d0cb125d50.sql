CREATE POLICY job_queue_no_delete ON job_queue
  FOR DELETE TO authenticated, anon
  USING (false);