CREATE POLICY "Users can insert their own jobs"
ON public.job_queue
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);