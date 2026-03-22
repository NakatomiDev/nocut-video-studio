INSERT INTO credit_ledger (user_id, type, credits_granted, credits_remaining, expires_at)
VALUES ('0f30bae0-ccc3-499a-902a-e78a83815f5d', 'monthly_allowance', 10, 10, now() + interval '2 months');

INSERT INTO credit_transactions (user_id, type, credits, reason)
VALUES ('0f30bae0-ccc3-499a-902a-e78a83815f5d', 'allocation', 10, 'dev_topup');