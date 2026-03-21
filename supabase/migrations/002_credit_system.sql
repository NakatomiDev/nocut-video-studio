-- NoCut Credit System
-- Migration: 002_credit_system
-- Description: Creates credit ledger, transactions, and atomic deduction/refund functions.

-- =============================================================================
-- 1. credit_ledger
-- =============================================================================
CREATE TABLE credit_ledger (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    type               TEXT NOT NULL CHECK (type IN ('monthly_allowance', 'top_up')),
    credits_granted    INTEGER NOT NULL,
    credits_remaining  INTEGER NOT NULL,
    granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ NOT NULL,
    stripe_payment_id  TEXT,
    revenuecat_event_id TEXT,
    created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_credit_ledger_user_id ON credit_ledger (user_id);
CREATE INDEX idx_credit_ledger_user_expires ON credit_ledger (user_id, expires_at);
CREATE INDEX idx_credit_ledger_user_type_remaining ON credit_ledger (user_id, type, credits_remaining);

-- =============================================================================
-- 2. credit_transactions
-- =============================================================================
CREATE TABLE credit_transactions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    project_id     UUID REFERENCES projects(id) ON DELETE SET NULL,
    type           TEXT NOT NULL CHECK (type IN ('deduction', 'refund', 'allocation')),
    credits        INTEGER NOT NULL,
    ledger_entries JSONB NOT NULL DEFAULT '[]',
    reason         TEXT,
    created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions (user_id);
CREATE INDEX idx_credit_transactions_user_created ON credit_transactions (user_id, created_at);

-- =============================================================================
-- 3. Add FK from edit_decisions.credit_transaction_id -> credit_transactions
-- =============================================================================
ALTER TABLE edit_decisions
    ADD CONSTRAINT fk_edit_decisions_credit_transaction
    FOREIGN KEY (credit_transaction_id) REFERENCES credit_transactions(id);

-- =============================================================================
-- 4. Atomic credit deduction function
-- =============================================================================
CREATE OR REPLACE FUNCTION deduct_credits(
    p_user_id          UUID,
    p_required_credits INTEGER,
    p_project_id       UUID DEFAULT NULL,
    p_reason           TEXT DEFAULT 'ai_fill'
)
RETURNS TABLE(out_success BOOLEAN, out_transaction_id UUID, out_credits_remaining INTEGER, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_available      INTEGER;
    v_to_deduct      INTEGER := p_required_credits;
    v_transaction_id UUID;
    v_ledger_entries JSONB := '[]'::jsonb;
    v_remaining_total INTEGER;
    rec              RECORD;
    v_take           INTEGER;
BEGIN
    -- Validate input
    IF p_required_credits <= 0 THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::INTEGER,
            'credits must be positive'::TEXT;
        RETURN;
    END IF;

    -- Lock the user's non-expired ledger rows with remaining credits (FIFO order)
    -- Monthly allowances first, then top-ups, oldest first within each type.
    v_available := 0;

    FOR rec IN
        SELECT cl.id, cl.credits_remaining, cl.type
        FROM credit_ledger cl
        WHERE cl.user_id = p_user_id
          AND cl.expires_at > now()
          AND cl.credits_remaining > 0
        ORDER BY
            CASE cl.type WHEN 'monthly_allowance' THEN 0 ELSE 1 END,
            cl.granted_at ASC
        FOR UPDATE
    LOOP
        v_available := v_available + rec.credits_remaining;
    END LOOP;

    -- Check sufficiency
    IF v_available < p_required_credits THEN
        RETURN QUERY SELECT false, NULL::UUID, v_available,
            format('insufficient credits: need %s, have %s', p_required_credits, v_available)::TEXT;
        RETURN;
    END IF;

    -- Deduct credits FIFO: monthly_allowance first (oldest), then top_up (oldest)
    FOR rec IN
        SELECT cl.id, cl.credits_remaining, cl.type
        FROM credit_ledger cl
        WHERE cl.user_id = p_user_id
          AND cl.expires_at > now()
          AND cl.credits_remaining > 0
        ORDER BY
            CASE cl.type WHEN 'monthly_allowance' THEN 0 ELSE 1 END,
            cl.granted_at ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_to_deduct <= 0;

        v_take := LEAST(rec.credits_remaining, v_to_deduct);

        UPDATE credit_ledger cl2
        SET credits_remaining = cl2.credits_remaining - v_take
        WHERE cl2.id = rec.id;

        v_to_deduct := v_to_deduct - v_take;

        v_ledger_entries := v_ledger_entries || jsonb_build_object(
            'ledger_id', rec.id,
            'credits_taken', v_take,
            'type', rec.type
        );
    END LOOP;

    -- Calculate remaining balance
    SELECT COALESCE(SUM(cl.credits_remaining), 0)::INTEGER
    INTO v_remaining_total
    FROM credit_ledger cl
    WHERE cl.user_id = p_user_id
      AND cl.expires_at > now()
      AND cl.credits_remaining > 0;

    -- Create transaction record
    INSERT INTO credit_transactions (user_id, project_id, type, credits, ledger_entries, reason)
    VALUES (p_user_id, p_project_id, 'deduction', p_required_credits, v_ledger_entries, p_reason)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT true, v_transaction_id, v_remaining_total,
        'credits deducted successfully'::TEXT;
END;
$$;

-- =============================================================================
-- 5. Credit refund function
-- =============================================================================
CREATE OR REPLACE FUNCTION refund_credits(
    p_transaction_id    UUID,
    p_credits_to_refund INTEGER DEFAULT NULL  -- NULL = refund full amount
)
RETURNS TABLE(out_success BOOLEAN, out_credits_refunded INTEGER, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    -- Fetch the original transaction
    SELECT ct.id, ct.user_id, ct.type, ct.credits, ct.ledger_entries, ct.project_id
    INTO v_txn
    FROM credit_transactions ct
    WHERE ct.id = p_transaction_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0, 'transaction not found'::TEXT;
        RETURN;
    END IF;

    IF v_txn.type != 'deduction' THEN
        RETURN QUERY SELECT false, 0, 'can only refund deduction transactions'::TEXT;
        RETURN;
    END IF;

    -- Determine refund amount
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

    -- Restore credits to original ledger entries (reverse order to undo FIFO)
    FOR v_entry IN
        SELECT value FROM jsonb_array_elements(v_txn.ledger_entries) WITH ORDINALITY
        ORDER BY ordinality DESC
    LOOP
        EXIT WHEN v_refunded_so_far >= v_refund_amount;

        v_ledger_id := (v_entry->>'ledger_id')::UUID;
        v_credits_taken := (v_entry->>'credits_taken')::INTEGER;
        v_give_back := LEAST(v_credits_taken, v_refund_amount - v_refunded_so_far);

        UPDATE credit_ledger cl2
        SET credits_remaining = cl2.credits_remaining + v_give_back
        WHERE cl2.id = v_ledger_id;

        v_refunded_so_far := v_refunded_so_far + v_give_back;

        v_ledger_entries := v_ledger_entries || jsonb_build_object(
            'ledger_id', v_ledger_id,
            'credits_restored', v_give_back
        );
    END LOOP;

    -- Record the refund transaction
    INSERT INTO credit_transactions (user_id, project_id, type, credits, ledger_entries, reason)
    VALUES (v_txn.user_id, v_txn.project_id, 'refund', v_refunded_so_far, v_ledger_entries,
            format('refund of transaction %s', p_transaction_id));

    RETURN QUERY SELECT true, v_refunded_so_far,
        format('refunded %s credits', v_refunded_so_far)::TEXT;
END;
$$;
