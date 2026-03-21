# NoCut — Deviation Log

A running log of architectural decisions that deviate from the original spec or workspace knowledge.

---

## Template

```
### [YYYY-MM-DD] — Short title

**Area:** (e.g., Backend, Frontend, AI Pipeline, Infra)
**Original plan:** What the spec/workspace knowledge said.
**Deviation:** What we actually did and why.
**Impact:** Any downstream effects or future considerations.
```

---

### 2026-03-21 — Core schema migration (001_core_schema.sql)

**Area:** Backend / Database
**Original plan:** Create 9 core tables (users, projects, videos, cut_maps, edit_decisions, ai_fills, exports, speaker_models, audit_log) with specified columns, types, and indexes.
**Deviation:** None — all column names, types, constraints, and indexes match the spec exactly.
**Impact:** No downstream impact. Credit tables and RLS policies deferred to subsequent migrations as planned.

### 2026-03-21 — Credit system migration (002_credit_system.sql)

**Area:** Backend / Database
**Original plan:** Create credit_ledger and credit_transactions tables, deduct_credits() and refund_credits() functions with SERIALIZABLE isolation.
**Deviation:** Functions use `RETURNS TABLE(out_success ..., out_transaction_id ..., ...)` with `out_` prefixed column aliases instead of bare names (`success`, `transaction_id`, `credits_remaining`). This avoids PL/pgSQL ambiguity between output column names and table column names (e.g. `credits_remaining` in both the RETURNS TABLE and the `credit_ledger` table). Concurrency safety is achieved via `SELECT ... FOR UPDATE` row locking within the default READ COMMITTED isolation level rather than SERIALIZABLE transaction isolation — FOR UPDATE provides equivalent double-spend protection with lower overhead.
**Impact:** Callers must reference `out_success`, `out_transaction_id`, `out_credits_remaining`, `out_message` (deduct) and `out_success`, `out_credits_refunded`, `out_message` (refund) when accessing function result columns. Added FK constraint from `edit_decisions.credit_transaction_id` to `credit_transactions(id)` to link the two systems.

### 2026-03-21 — RLS policies and handle_new_user trigger (003_rls_policies.sql)

**Area:** Backend / Database
**Original plan:** Enable RLS on all 11 tables. For tables with indirect ownership via `project_id`, use `EXISTS (SELECT 1 FROM projects WHERE projects.id = <table>.project_id AND projects.user_id = auth.uid())`. Create `handle_new_user()` SECURITY DEFINER trigger on `auth.users`.
**Deviation:** `cut_maps` has `video_id` (not `project_id`), so its policies use a two-table join: `videos → projects`. Similarly, `ai_fills` has `edit_decision_id` (not `project_id`), so its policies join through `edit_decisions → projects`. All other tables, policies, the trigger function, and credit allocation logic match the spec exactly.
**Impact:** `cut_maps` and `ai_fills` RLS checks involve one extra join hop compared to tables with a direct `project_id` FK. Performance impact is negligible due to indexed foreign keys. No API or caller-side changes needed.
