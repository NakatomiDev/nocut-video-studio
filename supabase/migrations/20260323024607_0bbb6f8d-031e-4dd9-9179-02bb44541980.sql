-- Fix search_path on handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.users (id, email, supabase_uid, tier)
  VALUES (NEW.id, NEW.email, NEW.id, 'free');

  INSERT INTO public.credit_ledger (user_id, type, credits_granted, credits_remaining, expires_at)
  VALUES (NEW.id, 'monthly_allowance', 5, 5, now() + interval '2 months');

  INSERT INTO public.credit_transactions (user_id, type, credits, reason)
  VALUES (NEW.id, 'allocation', 5, 'free_tier_signup');

  RETURN NEW;
END;
$function$;

-- Fix search_path on deduct_credits
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid, p_required_credits integer, p_project_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'ai_fill'::text)
 RETURNS TABLE(out_success boolean, out_transaction_id uuid, out_credits_remaining integer, out_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_available      INTEGER;
    v_to_deduct      INTEGER := p_required_credits;
    v_transaction_id UUID;
    v_ledger_entries JSONB := '[]'::jsonb;
    v_remaining_total INTEGER;
    rec              RECORD;
    v_take           INTEGER;
BEGIN
    IF p_required_credits <= 0 THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::INTEGER, 'credits must be positive'::TEXT;
        RETURN;
    END IF;

    v_available := 0;
    FOR rec IN
        SELECT cl.id, cl.credits_remaining, cl.type
        FROM credit_ledger cl
        WHERE cl.user_id = p_user_id AND cl.expires_at > now() AND cl.credits_remaining > 0
        ORDER BY CASE cl.type WHEN 'monthly_allowance' THEN 0 ELSE 1 END, cl.granted_at ASC
        FOR UPDATE
    LOOP
        v_available := v_available + rec.credits_remaining;
    END LOOP;

    IF v_available < p_required_credits THEN
        RETURN QUERY SELECT false, NULL::UUID, v_available,
            format('insufficient credits: need %s, have %s', p_required_credits, v_available)::TEXT;
        RETURN;
    END IF;

    FOR rec IN
        SELECT cl.id, cl.credits_remaining, cl.type
        FROM credit_ledger cl
        WHERE cl.user_id = p_user_id AND cl.expires_at > now() AND cl.credits_remaining > 0
        ORDER BY CASE cl.type WHEN 'monthly_allowance' THEN 0 ELSE 1 END, cl.granted_at ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_to_deduct <= 0;
        v_take := LEAST(rec.credits_remaining, v_to_deduct);

        UPDATE credit_ledger cl2 SET credits_remaining = cl2.credits_remaining - v_take WHERE cl2.id = rec.id;

        v_to_deduct := v_to_deduct - v_take;
        v_ledger_entries := v_ledger_entries || jsonb_build_object('ledger_id', rec.id, 'credits_taken', v_take, 'type', rec.type);
    END LOOP;

    SELECT COALESCE(SUM(cl.credits_remaining), 0)::INTEGER INTO v_remaining_total
    FROM credit_ledger cl WHERE cl.user_id = p_user_id AND cl.expires_at > now() AND cl.credits_remaining > 0;

    INSERT INTO credit_transactions (user_id, project_id, type, credits, ledger_entries, reason)
    VALUES (p_user_id, p_project_id, 'deduction', p_required_credits, v_ledger_entries, p_reason)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT true, v_transaction_id, v_remaining_total, 'credits deducted successfully'::TEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.deduct_credits FROM authenticated, anon, public;

-- Fix search_path on refund_credits
CREATE OR REPLACE FUNCTION public.refund_credits(p_transaction_id uuid, p_credits_to_refund integer DEFAULT NULL::integer)
 RETURNS TABLE(out_success boolean, out_credits_refunded integer, out_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_txn              RECORD;
    v_refund_amount    INTEGER;
    v_refunded_so_far  INTEGER := 0;
    v_entry            JSONB;
    v_ledger_id        UUID;
    v_credits_taken    INTEGER;
    v_give_back        INTEGER;
    v_ledger_entries   JSONB := '[]'::jsonb;
BEGIN
    SELECT ct.id, ct.user_id, ct.type, ct.credits, ct.ledger_entries, ct.project_id
    INTO v_txn FROM credit_transactions ct WHERE ct.id = p_transaction_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0, 'transaction not found'::TEXT;
        RETURN;
    END IF;

    IF v_txn.type != 'deduction' THEN
        RETURN QUERY SELECT false, 0, 'can only refund deduction transactions'::TEXT;
        RETURN;
    END IF;

    v_refund_amount := COALESCE(p_credits_to_refund, v_txn.credits);

    IF v_refund_amount <= 0 THEN
        RETURN QUERY SELECT false, 0, 'refund amount must be positive'::TEXT;
        RETURN;
    END IF;

    IF v_refund_amount > v_txn.credits THEN
        RETURN QUERY SELECT false, 0,
            format('refund amount %s exceeds original deduction %s', v_refund_amount, v_txn.credits)::TEXT;
        RETURN;
    END IF;

    FOR v_entry IN
        SELECT value FROM jsonb_array_elements(v_txn.ledger_entries) WITH ORDINALITY ORDER BY ordinality DESC
    LOOP
        EXIT WHEN v_refunded_so_far >= v_refund_amount;
        v_ledger_id := (v_entry->>'ledger_id')::UUID;
        v_credits_taken := (v_entry->>'credits_taken')::INTEGER;
        v_give_back := LEAST(v_credits_taken, v_refund_amount - v_refunded_so_far);

        UPDATE credit_ledger cl2 SET credits_remaining = cl2.credits_remaining + v_give_back WHERE cl2.id = v_ledger_id;

        v_refunded_so_far := v_refunded_so_far + v_give_back;
        v_ledger_entries := v_ledger_entries || jsonb_build_object('ledger_id', v_ledger_id, 'credits_restored', v_give_back);
    END LOOP;

    INSERT INTO credit_transactions (user_id, project_id, type, credits, ledger_entries, reason)
    VALUES (v_txn.user_id, v_txn.project_id, 'refund', v_refunded_so_far, v_ledger_entries,
            format('refund of transaction %s', p_transaction_id));

    RETURN QUERY SELECT true, v_refunded_so_far, format('refunded %s credits', v_refunded_so_far)::TEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refund_credits FROM authenticated, anon, public;