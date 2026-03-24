-- Refund 4 orphaned/unrefunded credit deductions (16 credits total)
-- These were caused by double-deduction bug: preview-fill + process-ai-fill both deducting

-- 1. Orphan from successful fill (06:55:30) - preview-fill deducted, process-ai-fill deducted again
SELECT refund_credits('0f8958c3-818d-4b9f-be16-f35fe5feae77');

-- 2. Orphan from failed fill (10:00:25) - preview-fill deducted, no edit_decision linked
SELECT refund_credits('f2c2b241-0d0b-4c11-a80d-92447f2428c8');

-- 3. Failed fill with no refund (10:00:29) - process-ai-fill deducted, failed, pre-refund-fix
SELECT refund_credits('78c8f66e-3310-46b5-a1a8-1e253240906b');

-- 4. Orphan from failed fill (10:15:56) - preview-fill deducted
SELECT refund_credits('ec178b5d-8b6a-4c8a-80c3-5437a3597184');