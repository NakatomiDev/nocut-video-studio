CREATE OR REPLACE FUNCTION public.block_tier_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier AND current_setting('role') <> 'service_role' THEN
    RAISE EXCEPTION 'Tier cannot be changed directly';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'ID cannot be changed';
  END IF;
  IF NEW.supabase_uid IS DISTINCT FROM OLD.supabase_uid THEN
    RAISE EXCEPTION 'supabase_uid cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER enforce_user_immutable_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.block_tier_update();