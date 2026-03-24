DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users LIMIT 1;

  INSERT INTO public.credit_ledger (user_id, type, credits_granted, credits_remaining, expires_at)
  VALUES (v_user_id, 'monthly_allowance', 16, 16, now() + interval '2 months');

  INSERT INTO public.credit_transactions (user_id, type, credits, reason)
  VALUES (v_user_id, 'allocation', 16, 'dev_topup');
END $$;