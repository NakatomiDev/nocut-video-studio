-- Revoke public execute on credit functions so only service_role can call them
REVOKE EXECUTE ON FUNCTION public.deduct_credits FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.refund_credits FROM authenticated, anon, public;