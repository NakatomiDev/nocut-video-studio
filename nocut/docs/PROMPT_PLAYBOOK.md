# NoCut — P0 Prompt Playbook

**Purpose:** Copy-paste prompts for building NoCut MVP, organized by sprint.
**Tools:** Lovable (frontend) and Claude Code (backend).
**Rule:** After every prompt, document what was built, any deviations, and pass that context into the next prompt.

---

## How to Use This Playbook

### Workflow per prompt:

1. **Copy** the prompt into the appropriate tool (Lovable or Claude Code)
2. **Run** and review the output
3. **Document** in the "Deviation Log" section after each prompt:
   - What was built (file names, endpoints, components)
   - Any deviations from the plan (different package, alternative approach, naming changes)
   - Any errors encountered and how they were resolved
4. **Feed forward** — the next prompt references the deviation log, so update it before moving on

### Deviation Log Template

After each prompt, append to a running log:

```
## Sprint X — Task X.X — [Task Name]
- Tool: Lovable | Claude Code
- Status: Complete | Partial | Blocked
- Files created/modified: [list]
- Deviations from plan: [any changes]
- Errors encountered: [any issues + resolution]
- Notes for next step: [anything the next prompt needs to know]
```

Keep this log in a file called `DEVIATION_LOG.md` in your repo root.

---

# SPRINT 0: Project Setup

---

## 0.1 — Initialize Repository

**Tool: Claude Code**

### Prompt 0.1.1 — Create monorepo structure

```
Create a GitHub monorepo for a project called "NoCut" — a web-based video editing app. Initialize the following directory structure:

nocut/
├── supabase/
│   ├── functions/          # Supabase Edge Functions
│   ├── migrations/         # Database migrations (SQL)
│   └── config.toml         # Supabase config
├── services/
│   ├── transcoder/         # FFmpeg transcoding worker (Docker)
│   ├── detector/           # Silence detection worker (Python, Docker)
│   ├── ai-engine/          # AI fill generation worker (Python, Docker)
│   └── exporter/           # Video export/assembly worker (Docker)
├── infra/
│   └── terraform/          # Terraform modules for AWS + GCP
├── docs/                   # Project documentation
├── .github/
│   └── workflows/          # GitHub Actions CI/CD
├── .env.example            # Template for environment variables
├── .gitignore              # Ignore node_modules, .env, __pycache__, etc.
├── README.md               # Project README
├── DEVIATION_LOG.md         # Running log of build deviations
└── package.json            # Root package.json (workspace config if needed)

For .env.example, include placeholders for:
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- REVENUECAT_API_KEY, REVENUECAT_WEB_BILLING_KEY, REVENUECAT_WEBHOOK_SECRET
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, AWS_REGION, AWS_CLOUDFRONT_KEYPAIR_ID
- REDIS_URL
- GCP_VERTEX_AI_KEY (commented out, Phase 2)

For .gitignore, include standard patterns for Node.js, Python, Terraform, .env files, and IDE configs.

Initialize DEVIATION_LOG.md with a header and the template format from above.

Do NOT initialize Supabase yet — just create the directory structure.
```

**After completion:** Update DEVIATION_LOG.md with the actual structure created.

---

## 0.2 — Supabase Database Schema

**Tool: Claude Code**

### Prompt 0.2.1 — Initialize Supabase and create core tables

```
I'm building NoCut, a video editing app. I need to set up the Supabase database schema.

First, initialize Supabase in the project:
- Run `supabase init` in the project root (if not already done)
- Link to my Supabase project (I'll provide the project ref when prompted)

Then create a migration file at `supabase/migrations/001_core_schema.sql` with the following tables:

1. **users** table:
   - id UUID PRIMARY KEY (references auth.users)
   - email TEXT NOT NULL
   - supabase_uid UUID NOT NULL UNIQUE
   - revenuecat_id TEXT
   - tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'business'))
   - created_at TIMESTAMPTZ DEFAULT now()
   - updated_at TIMESTAMPTZ DEFAULT now()

2. **projects** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL
   - title TEXT NOT NULL DEFAULT 'Untitled Project'
   - status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'transcoding', 'detecting', 'ready', 'generating', 'exporting', 'complete', 'failed'))
   - error_message TEXT
   - created_at TIMESTAMPTZ DEFAULT now()
   - updated_at TIMESTAMPTZ DEFAULT now()

3. **videos** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL
   - s3_key TEXT NOT NULL
   - duration FLOAT
   - resolution TEXT
   - format TEXT
   - file_size_bytes BIGINT
   - proxy_s3_key TEXT
   - waveform_s3_key TEXT
   - thumbnail_sprite_s3_key TEXT
   - created_at TIMESTAMPTZ DEFAULT now()

4. **cut_maps** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - video_id UUID REFERENCES videos(id) ON DELETE CASCADE NOT NULL
   - version INTEGER NOT NULL DEFAULT 1
   - cuts_json JSONB NOT NULL DEFAULT '[]'
   - transcript_json JSONB
   - created_at TIMESTAMPTZ DEFAULT now()

5. **edit_decisions** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL
   - edl_json JSONB NOT NULL
   - total_fill_seconds FLOAT NOT NULL DEFAULT 0
   - credits_charged INTEGER NOT NULL DEFAULT 0
   - status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'exporting', 'complete', 'failed'))
   - credit_transaction_id UUID
   - created_at TIMESTAMPTZ DEFAULT now()

6. **ai_fills** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - edit_decision_id UUID REFERENCES edit_decisions(id) ON DELETE CASCADE NOT NULL
   - gap_index INTEGER NOT NULL
   - s3_key TEXT
   - method TEXT NOT NULL CHECK (method IN ('ai_fill', 'crossfade', 'hard_cut'))
   - provider TEXT CHECK (provider IN ('did', 'heygen', 'veo', 'custom'))
   - quality_score FLOAT
   - duration FLOAT
   - generation_time_ms INTEGER
   - created_at TIMESTAMPTZ DEFAULT now()

7. **exports** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL
   - edit_decision_id UUID REFERENCES edit_decisions(id)
   - s3_key TEXT NOT NULL
   - format TEXT NOT NULL DEFAULT 'mp4'
   - resolution TEXT
   - duration FLOAT
   - file_size_bytes BIGINT
   - watermarked BOOLEAN NOT NULL DEFAULT true
   - c2pa_signed BOOLEAN NOT NULL DEFAULT false
   - fill_summary_json JSONB
   - download_url TEXT
   - created_at TIMESTAMPTZ DEFAULT now()

8. **speaker_models** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL
   - video_id UUID REFERENCES videos(id) ON DELETE CASCADE
   - embedding_s3_key TEXT NOT NULL
   - created_at TIMESTAMPTZ DEFAULT now()
   - expires_at TIMESTAMPTZ NOT NULL

9. **audit_log** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - user_id UUID REFERENCES users(id) NOT NULL
   - action TEXT NOT NULL
   - input_hash TEXT
   - output_hash TEXT
   - provider TEXT
   - quality_score FLOAT
   - metadata JSONB
   - created_at TIMESTAMPTZ DEFAULT now()

Add appropriate indexes:
- projects: user_id, status
- videos: project_id
- cut_maps: video_id
- edit_decisions: project_id, status
- ai_fills: edit_decision_id
- exports: project_id
- speaker_models: user_id, expires_at
- audit_log: user_id, created_at

Do NOT create credit tables yet — those come in the next migration.
Do NOT create RLS policies yet — those come in a separate migration.
```

**After completion:** Update DEVIATION_LOG.md. Note any column type changes or naming differences.

---

### Prompt 0.2.2 — Create credit system tables

```
Create a new Supabase migration file at `supabase/migrations/002_credit_system.sql` for the NoCut credit system.

Create these tables:

1. **credit_ledger** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL
   - type TEXT NOT NULL CHECK (type IN ('monthly_allowance', 'top_up'))
   - credits_granted INTEGER NOT NULL
   - credits_remaining INTEGER NOT NULL
   - granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
   - expires_at TIMESTAMPTZ NOT NULL
   - stripe_payment_id TEXT
   - revenuecat_event_id TEXT
   - created_at TIMESTAMPTZ DEFAULT now()

2. **credit_transactions** table:
   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL
   - project_id UUID REFERENCES projects(id) ON DELETE SET NULL
   - type TEXT NOT NULL CHECK (type IN ('deduction', 'refund', 'allocation'))
   - credits INTEGER NOT NULL
   - ledger_entries JSONB NOT NULL DEFAULT '[]'
   - reason TEXT
   - created_at TIMESTAMPTZ DEFAULT now()

Add indexes:
- credit_ledger: user_id, (user_id, expires_at) composite, (user_id, type, credits_remaining) composite
- credit_transactions: user_id, (user_id, created_at) composite

Also create a Postgres function for atomic credit deduction:

CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id UUID,
  p_required_credits INTEGER,
  p_project_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'ai_fill'
)
RETURNS TABLE(success BOOLEAN, transaction_id UUID, credits_remaining INTEGER, message TEXT)

The function should:
1. Calculate total available credits from non-expired ledger entries
2. If insufficient, return success=false with available balance
3. If sufficient, deduct credits in order: monthly_allowance first (oldest first), then top_up (oldest first)
4. Create a credit_transactions record with the ledger_entries breakdown
5. Return success=true with the transaction_id and remaining balance
6. Use SERIALIZABLE transaction isolation to prevent double-spend

Also create a function for credit refund:

CREATE OR REPLACE FUNCTION refund_credits(
  p_transaction_id UUID,
  p_credits_to_refund INTEGER DEFAULT NULL  -- NULL = refund full amount
)
RETURNS TABLE(success BOOLEAN, credits_refunded INTEGER, message TEXT)

This should reverse the deduction, adding credits back to the original ledger entries.
```

**After completion:** Update DEVIATION_LOG.md. Test the deduction function with sample data.

---

### Prompt 0.2.3 — Create RLS policies

```
Create a new Supabase migration file at `supabase/migrations/003_rls_policies.sql` for NoCut.

Enable Row Level Security on ALL tables created in migrations 001 and 002.

Create these policies:

For each table that has a user_id column (users, projects, credit_ledger, credit_transactions, speaker_models, audit_log):
- SELECT: Users can only read their own rows (auth.uid() = user_id)
- INSERT: Users can only insert rows for themselves (auth.uid() = user_id) 
- UPDATE: Users can only update their own rows (auth.uid() = user_id)
- DELETE: Users can only delete their own rows (auth.uid() = user_id)

For tables with indirect user ownership via project_id (videos, cut_maps, edit_decisions, ai_fills, exports):
- SELECT: Users can only read rows where the parent project belongs to them
  (EXISTS (SELECT 1 FROM projects WHERE projects.id = <table>.project_id AND projects.user_id = auth.uid()))
- INSERT: Same ownership check
- UPDATE: Same ownership check  
- DELETE: Same ownership check

Special cases:
- users table: Users can only read/update their own row. INSERT is handled by the trigger (use SECURITY DEFINER).
- audit_log: Users can SELECT their own rows only. No INSERT/UPDATE/DELETE from client (service role only).
- credit_ledger: Users can SELECT their own rows. No INSERT/UPDATE/DELETE from client (service role via Edge Functions only).
- credit_transactions: Users can SELECT their own rows. No INSERT from client.

Also create the handle_new_user trigger function:

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, supabase_uid, tier)
  VALUES (NEW.id, NEW.email, NEW.id, 'free');
  
  -- Allocate free tier monthly credits (5 credits, expire in 2 months)
  INSERT INTO public.credit_ledger (user_id, type, credits_granted, credits_remaining, expires_at)
  VALUES (NEW.id, 'monthly_allowance', 5, 5, now() + interval '2 months');
  
  -- Log the allocation
  INSERT INTO public.credit_transactions (user_id, type, credits, reason)
  VALUES (NEW.id, 'allocation', 5, 'free_tier_signup');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

Test by verifying:
1. The trigger fires on auth.users insert
2. RLS prevents cross-user data access
3. The credit deduction function works with service role
```

**After completion:** Update DEVIATION_LOG.md. Note if any policy needed adjustment.

---

### Prompt 0.2.4 — Create job queue table

```
Create a new Supabase migration file at `supabase/migrations/004_job_queue.sql` for NoCut.

Create a job_queue table for tracking async processing jobs:

CREATE TABLE job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video.transcode', 'video.detect', 'ai.fill', 'video.export')),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'complete', 'failed', 'dead_letter')),
  priority INTEGER NOT NULL DEFAULT 10,
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

Add indexes on (status, priority, created_at) for queue polling, and (project_id) for project-level queries.

Enable RLS: Users can SELECT their own jobs (via user_id). No client INSERT/UPDATE/DELETE.

Enable Supabase Realtime on this table so the client can subscribe to job progress:
ALTER PUBLICATION supabase_realtime ADD TABLE job_queue;

Also enable Realtime on the projects table and credit_transactions table:
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE credit_transactions;
```

**After completion:** Update DEVIATION_LOG.md. Verify Realtime is enabled.

---

## 0.3 — AWS Infrastructure

**Tool: Claude Code**

### Prompt 0.3.1 — Create Terraform foundation

```
Create the Terraform configuration for NoCut's AWS infrastructure in `infra/terraform/`.

Structure:
infra/terraform/
├── main.tf           # Provider config, backend
├── variables.tf      # Input variables
├── outputs.tf        # Outputs (bucket name, CloudFront URL, etc.)
├── s3.tf             # S3 bucket + lifecycle rules
├── cloudfront.tf     # CloudFront distribution
├── ecr.tf            # ECR repositories
├── ecs.tf            # ECS cluster (Fargate)
├── elasticache.tf    # Redis cluster for BullMQ
├── iam.tf            # IAM roles and policies
├── security_groups.tf # VPC security groups
└── terraform.tfvars.example

Requirements:

**S3 bucket** (`nocut-media-{var.environment}`):
- Versioning disabled (we manage versions in DB)
- Server-side encryption (AES-256)
- CORS configuration allowing PUT from any origin (for presigned uploads)
- Lifecycle rules:
  - `ai-fills/` prefix: transition to IA after 30 days, delete after 90 days
  - `exports/` prefix: delete after 365 days
  - `speaker-models/` prefix: delete after 30 days
- Block all public access

**CloudFront distribution**:
- Origin: the S3 bucket
- Signed URLs enabled (key pair ID as variable)
- Cache behavior: cache for 24 hours on `proxy/` and `thumbnails/` prefixes
- No cache on `exports/` (signed URLs handle access)

**ECR repositories**: 
- nocut-transcoder
- nocut-detector  
- nocut-ai-engine
- nocut-exporter

**ECS cluster**: 
- Fargate-only cluster named `nocut-{var.environment}`
- Don't create task definitions yet — those come later per service

**ElastiCache Redis**:
- Single-node Redis 7.x (t3.micro for dev, t3.small for prod)
- In default VPC for now
- Auth token as variable

**IAM roles**:
- ECS task execution role (pull from ECR, write CloudWatch logs)
- ECS task role (read/write S3 bucket, access Redis, access Secrets Manager)
- Lambda/Edge Function role (generate presigned S3 URLs, read Secrets Manager)

Variables should include: environment (dev/staging/prod), aws_region, s3_bucket_name, cloudfront_key_pair_id, redis_auth_token.

Use `terraform.tfvars.example` with placeholder values.

Backend config: S3 backend with DynamoDB locking (comment out for initial setup, user can enable after first apply).
```

**After completion:** Update DEVIATION_LOG.md. Note the actual resource names created. Do NOT apply yet — review first.

---

# SPRINT 1: Auth & Core UI

---

## 1.1 — Authentication

### Prompt 1.1.1 — Build sign-up and sign-in pages

**Tool: Lovable**

```
I'm building NoCut, a web-based video editing app that removes pauses from videos and uses AI to generate seamless transitions. The app uses Supabase for auth and database.

Build the authentication pages:

1. **Sign Up page** (`/sign-up`):
   - Clean, centered card layout on a dark background (#0A0F2E)
   - NoCut logo/wordmark at the top (use text "NoCut" in bold, white, with a scissors emoji ✂️)
   - Tagline: "One Take. Every Time." in muted purple (#A29BFE)
   - Email input field
   - Password input field (min 8 characters, show/hide toggle)
   - "Sign Up" primary button (purple #6C5CE7 background)
   - Divider with "or"
   - "Continue with Google" button (outline style)
   - Link at bottom: "Already have an account? Sign in"
   - Form validation with inline error messages

2. **Sign In page** (`/sign-in`):
   - Same layout and styling as sign up
   - Email + password fields
   - "Sign In" primary button
   - "Continue with Google" button
   - "Forgot password?" link
   - Link at bottom: "Don't have an account? Sign up"

3. **Auth integration**:
   - Use Supabase JS client for all auth operations
   - signUp with email/password
   - signInWithPassword
   - signInWithOAuth({ provider: 'google' })
   - On successful auth, redirect to /dashboard
   - Store session automatically (Supabase handles this)

4. **Auth guard**:
   - Create a ProtectedRoute component that wraps all authenticated routes
   - If no session, redirect to /sign-in
   - Show a loading spinner while checking session status

5. **Routing**:
   - /sign-up → Sign Up page
   - /sign-in → Sign In page
   - /dashboard → Protected (redirect if not authed)
   - / → Redirect to /dashboard if authed, /sign-in if not

Use Tailwind CSS for all styling. Dark theme throughout.
```

**After completion:** Update DEVIATION_LOG.md. Note the actual component names, any Supabase config needed (URL, anon key).

---

### Prompt 1.1.2 — Build app shell and navigation

**Tool: Lovable**

```
Building on the NoCut auth pages we just created, build the main app shell that wraps all authenticated pages.

1. **App Layout** (wraps all protected routes):
   - Left sidebar (240px wide, dark background #0A0F2E)
     - NoCut logo at top (✂️ NoCut)
     - Navigation links with icons:
       - Dashboard (grid icon)
       - Credits (coins/credit-card icon)
       - Settings (gear icon)
     - Active link highlighted with purple (#6C5CE7) background
     - User email at bottom of sidebar with sign-out button
   - Main content area (right side, dark gray background #111827)
     - Top bar with page title

2. **Dashboard page** (`/dashboard`):
   - Page title: "My Projects"
   - "New Project" button (purple, top right) — no functionality yet, just the button
   - Empty state when no projects:
     - Illustration or icon (video camera with a ✂️)
     - "No projects yet"
     - "Upload your first video to get started"
     - "Upload Video" button
   - When projects exist (build the card component for later):
     - Grid of project cards (3 columns)
     - Each card: thumbnail placeholder, title, status badge, date, "..." menu
     - Status badges color-coded: uploading=yellow, ready=green, complete=blue, failed=red

3. **Credits page** (`/credits`):
   - Placeholder content: "Credits page coming soon"
   - We'll build this out in Sprint 4

4. **Settings page** (`/settings`):
   - Display user email (from Supabase session)
   - Current tier badge ("Free", "Pro", or "Business")
   - "Manage Subscription" button (disabled for now)
   - "Sign Out" button

Make sure the sidebar navigation works with the existing routing. All pages should be wrapped in the ProtectedRoute from the previous step.
```

**After completion:** Update DEVIATION_LOG.md. Note component names, routing structure.

---

# SPRINT 2: Upload Pipeline

---

## 2.1 — Upload Backend

### Prompt 2.1.1 — Create upload initiation Edge Function

**Tool: Claude Code**

```
Create a Supabase Edge Function for NoCut's upload flow.

Context: NoCut is a video editing app. Users upload video files which are chunked and sent directly to S3. The Edge Function validates the upload and generates presigned S3 URLs.

Create the file at `supabase/functions/upload-initiate/index.ts`.

The function should:

1. **Authenticate**: Verify the Supabase JWT from the Authorization header. Extract user ID.

2. **Parse request body**: 
   - filename (string, required)
   - file_size_bytes (number, required)
   - mime_type (string, required — must be video/mp4, video/quicktime, video/webm, video/x-matroska)
   - duration_seconds (number, required)
   - resolution (string, optional — e.g., "1920x1080")
   - title (string, optional — defaults to filename without extension)

3. **Check tier limits**: Query the users table for the user's tier, then enforce:
   - Free: max 4GB file, max 5 min duration, max 1080p
   - Pro: max 10GB file, max 30 min duration, max 1080p
   - Business: max 25GB file, max 120 min duration, max 4K

   Return appropriate error codes if limits exceeded (413 with `file_too_large`, `duration_exceeded`, or `resolution_exceeded`).

4. **Create DB records**: 
   - Insert a `projects` row (status: 'uploading', title from request)
   - Insert a `videos` row (s3_key constructed as `uploads/{user_id}/{project_id}/source.{extension}`)

5. **Generate presigned URLs**: 
   - Calculate chunk count: ceil(file_size_bytes / 5MB)
   - Use AWS SDK v3 (@aws-sdk/client-s3 and @aws-sdk/s3-request-presigner) to generate presigned PUT URLs for S3 multipart upload
   - Each URL should expire in 1 hour

6. **Return response**:
   ```json
   {
     "data": {
       "project_id": "uuid",
       "video_id": "uuid",
       "upload_session_id": "uuid",
       "chunk_size_bytes": 5242880,
       "total_chunks": N,
       "presigned_urls": [{ "chunk_index": 0, "url": "...", "expires_at": "..." }]
     }
   }
   ```

Environment variables needed: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, AWS_REGION.

Use Deno-compatible imports. Add proper error handling and logging.

IMPORTANT: Also create `supabase/functions/_shared/` directory with:
- `cors.ts` — CORS headers helper (allow all origins for now)
- `auth.ts` — Helper to extract and verify user from Supabase JWT
- `response.ts` — Helper to create consistent JSON responses (success and error formats)
- `tier-limits.ts` — Tier limit constants and validation function

These shared utilities will be reused by all Edge Functions.
```

**After completion:** Update DEVIATION_LOG.md. Note actual file paths, any import issues with Deno.

---

### Prompt 2.1.2 — Create chunk-complete and upload-complete Edge Functions

**Tool: Claude Code**

```
Create two more Supabase Edge Functions for NoCut's upload pipeline. These build on the upload-initiate function we already created.

Reference the shared utilities in `supabase/functions/_shared/` (cors.ts, auth.ts, response.ts).

[Include any deviations from DEVIATION_LOG.md here — e.g., "Note: the shared utilities are at X path and use Y import pattern"]

1. **`supabase/functions/upload-chunk-complete/index.ts`**

   POST endpoint. Request body:
   - upload_session_id (UUID)
   - chunk_index (integer)
   - etag (string — returned by S3 after PUT)

   The function should:
   - Verify auth
   - Verify the upload session belongs to the user (query projects table via the video's project)
   - Store the chunk completion in a tracking mechanism. Options:
     a. Add a `upload_chunks` JSONB column to the videos table (simplest)
     b. Or use a separate tracking table
   - Return: { chunks_completed, chunks_total, progress_percent }

2. **`supabase/functions/upload-complete/index.ts`**

   POST endpoint. Request body:
   - upload_session_id (UUID)

   The function should:
   - Verify auth and ownership
   - Verify all chunks are reported complete
   - Call AWS S3 CompleteMultipartUpload with the ETags
   - Update the project status to 'transcoding'
   - Insert a job_queue row: type='video.transcode', status='queued', payload containing video_id and s3_key
   - Return: { project_id, video_id, status: 'transcoding', estimated_processing_seconds }

Also update the videos table if we need an upload_chunks column — create migration `supabase/migrations/005_upload_tracking.sql` if needed.
```

**After completion:** Update DEVIATION_LOG.md.

---

## 2.2 — Upload UI

### Prompt 2.2.1 — Build upload flow UI

**Tool: Lovable**

```
Build the video upload flow for NoCut. This connects to our Supabase Edge Functions.

[Include any deviations from DEVIATION_LOG.md — e.g., "The upload-initiate function is at /functions/v1/upload-initiate and expects X body format"]

1. **Upload Modal/Page**:
   - Triggered by the "New Project" or "Upload Video" buttons on the dashboard
   - Full-screen overlay or dedicated page at `/upload`
   - Large drag-and-drop zone (dashed purple border, centered)
     - Icon: upload cloud icon
     - Text: "Drag and drop your video, or click to browse"
     - Subtext: "MP4, MOV, WebM, MKV — up to 4GB (Free tier)"
   - Also has a traditional file input (hidden, triggered by clicking the zone)
   - After file selected, show:
     - File name, size, and detected duration (use URL.createObjectURL + video element to read duration)
     - "Upload" button to start the process

2. **Upload Progress**:
   - After clicking Upload:
     - Call the upload-initiate Edge Function with file metadata
     - If error (file too large, duration exceeded): show error message with tier limit info and "Upgrade" link
     - If success: begin chunked upload
   - Chunking logic:
     - Split file into 5MB chunks using File.slice()
     - Upload up to 4 chunks concurrently using the presigned URLs
     - After each chunk completes, call upload-chunk-complete Edge Function
     - Show progress bar (0-100%) based on chunks completed / total chunks
     - Show upload speed (MB/s) and estimated time remaining
   - After all chunks complete:
     - Call upload-complete Edge Function
     - Show "Processing your video..." state with spinning animation
     - Subscribe to Supabase Realtime on the `projects` table for this project_id
     - When status changes to 'detecting', show "Analyzing audio..."
     - When status changes to 'ready', redirect to the editor page at `/project/{project_id}`

3. **Error handling**:
   - Network failure mid-upload: show "Upload interrupted" with "Resume" button (retry from last incomplete chunk)
   - Validation errors from Edge Function: show error message in red below the upload zone
   - Cancel button that aborts all in-progress uploads

Use the Supabase JS client for Edge Function calls. Use fetch() for direct S3 uploads (presigned URLs).
```

**After completion:** Update DEVIATION_LOG.md. Note actual component structure, any Supabase Realtime setup differences.

---

## 2.3 — Transcoding Worker

### Prompt 2.3.1 — Build transcoding Docker service

**Tool: Claude Code**

```
Build the transcoding worker service for NoCut at `services/transcoder/`.

[Include any deviations from DEVIATION_LOG.md — e.g., "The job_queue table schema is X, the videos table has columns Y"]

This is a Node.js service that:
1. Connects to Redis (BullMQ) and polls the `video.transcode` queue
2. For each job, downloads the source video from S3, runs FFmpeg, and uploads results back to S3
3. Updates the Supabase database with the results

Structure:
services/transcoder/
├── Dockerfile
├── package.json
├── src/
│   ├── index.ts          # Entry point, BullMQ worker setup
│   ├── transcoder.ts     # Core transcoding logic
│   ├── s3.ts             # S3 download/upload utilities
│   ├── supabase.ts       # Supabase client (service role) for DB updates
│   └── config.ts         # Environment variables
└── tsconfig.json

**Job payload** (from job_queue table):
```json
{ "video_id": "uuid", "project_id": "uuid", "s3_key": "uploads/user/project/source.mp4" }
```

**Transcoding pipeline** (all via FFmpeg child_process):

1. Download source video from S3 to `/tmp/source.{ext}`

2. **Transcode to H.264/AAC** (standardized format):
   `ffmpeg -i source.mp4 -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart output.mp4`
   
3. **Generate 360p proxy**:
   `ffmpeg -i source.mp4 -vf scale=-2:360 -c:v libx264 -preset fast -crf 28 -c:a aac -b:a 64k proxy.mp4`

4. **Extract audio waveform data** (JSON):
   `ffmpeg -i source.mp4 -ac 1 -ar 8000 -f f32le pipe:1`
   Then downsample to ~1000 points for the timeline waveform. Save as JSON array of floats.

5. **Generate thumbnail sprite sheet**:
   `ffmpeg -i source.mp4 -vf "fps=1,scale=160:-1,tile=10x1" -frames:v 1 thumbnails_%03d.jpg`
   (Generate 1 thumbnail per second, arranged in sprite sheets of 10)

6. Upload all outputs to S3:
   - `uploads/{user_id}/{project_id}/transcoded.mp4`
   - `uploads/{user_id}/{project_id}/proxy.mp4`  
   - `uploads/{user_id}/{project_id}/waveform.json`
   - `uploads/{user_id}/{project_id}/thumbnails/sprite_001.jpg` (etc.)

7. Update Supabase DB:
   - Update videos table with proxy_s3_key, waveform_s3_key, thumbnail_sprite_s3_key, duration, resolution
   - Update project status to 'detecting'
   - Insert new job_queue row for video.detect
   - Update the original job_queue row to status='complete', progress_percent=100

8. On failure: update job_queue to 'failed' with error_message, update project status to 'failed'.

**Dockerfile**: Use node:20-slim base. Install FFmpeg via apt-get. Copy source and build.

**Environment variables**: REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, AWS_REGION

Include proper logging (console.log with JSON format including job_id, project_id for correlation).
```

**After completion:** Update DEVIATION_LOG.md. Note Docker image tag, actual FFmpeg commands used.

---

# SPRINT 3: Detection & Timeline Editor

---

## 3.1 — Silence Detection

### Prompt 3.1.1 — Build silence detection service

**Tool: Claude Code**

```
Build the silence detection service for NoCut at `services/detector/`.

[Include deviations from DEVIATION_LOG.md — especially actual DB schema, job_queue format, S3 paths]

This is a Python service that analyzes video audio to detect silence/pauses.

Structure:
services/detector/
├── Dockerfile
├── requirements.txt
├── src/
│   ├── main.py           # Entry point, BullMQ/Redis consumer
│   ├── detector.py        # Core silence detection logic
│   ├── s3_utils.py        # S3 download utility
│   ├── supabase_client.py # Supabase client for DB updates
│   └── config.py          # Environment variables
└── tests/
    └── test_detector.py

**Job payload**: { "video_id": "uuid", "project_id": "uuid", "s3_key": "uploads/user/project/transcoded.mp4" }

**Detection logic** (in detector.py):

1. Download the video from S3 (or just the audio track)
2. Extract audio using FFmpeg: `ffmpeg -i input.mp4 -ac 1 -ar 16000 -f wav pipe:1`
3. Analyze audio for silence regions:
   - Use librosa or pydub to compute RMS energy in sliding windows (50ms window, 25ms hop)
   - Convert to dB: 20 * log10(rms)
   - Identify contiguous regions where dB < -40 (configurable threshold)
   - Minimum silence duration: 1.5 seconds (configurable)
   - For each silence region, record: start timestamp, end timestamp, duration, average dB level
   - Assign confidence score: longer silence = higher confidence, deeper silence = higher confidence

4. Build the cut map JSON:
```json
{
  "video_id": "uuid",
  "duration": 300.5,
  "cuts": [
    {
      "id": "cut_001",
      "type": "silence",
      "start": 12.34,
      "end": 15.67,
      "duration": 3.33,
      "confidence": 0.92,
      "auto_accept": true,
      "metadata": { "avg_rms_db": -52.3 }
    }
  ]
}
```

`auto_accept` should be true for silences > 2 seconds with confidence > 0.85.

5. Write cut map to Supabase `cut_maps` table
6. Update project status to 'ready'
7. Update job_queue row to 'complete'

**Redis/Queue**: Use `redis` and `rq` (Redis Queue) Python packages, or implement a simple polling loop on the job_queue table via Supabase REST API (simpler for MVP).

For MVP, I recommend polling Supabase job_queue every 5 seconds for 'queued' jobs of type 'video.detect', rather than using Redis. This avoids needing the Redis dependency for this service. We can migrate to BullMQ/Redis later for scale.

**Dockerfile**: Use python:3.11-slim. Install FFmpeg and librosa/pydub via pip. 

**requirements.txt**: librosa, numpy, pydub, supabase, httpx, ffmpeg-python (or just subprocess calls)

Include a test file with a simple test case using a generated silent audio clip.
```

**After completion:** Update DEVIATION_LOG.md. Note detection accuracy, threshold values that work best.

---

## 3.2 — Timeline Editor

### Prompt 3.2.1 — Build editor page layout

**Tool: Lovable**

```
Build the video editor page for NoCut at route `/project/:projectId`.

[Include deviations from DEVIATION_LOG.md — e.g., "Supabase tables are named X, the cut_maps table stores cuts in cuts_json column"]

This is the core editing experience. For this prompt, build the page layout and data loading — we'll build the individual timeline components in the next prompts.

1. **Data Loading** (on page mount):
   - Fetch the project from Supabase: `projects` table where id = projectId
   - Fetch the video: `videos` table where project_id = projectId
   - Fetch the cut map: `cut_maps` table where video_id = video.id
   - If project status is not 'ready', show appropriate state:
     - 'transcoding': "Processing your video..." with progress from Supabase Realtime
     - 'detecting': "Analyzing audio..." with progress
     - 'failed': Error message with "Try Again" button
   - Generate signed URLs for proxy video, waveform JSON, and thumbnail sprites (or use public URLs if CloudFront is set up)

2. **Editor Layout**:
   - Full-screen page (hide sidebar or collapse it)
   - Back button → return to dashboard
   - Project title (editable inline)
   - Top section (60% height): Video preview player
   - Bottom section (40% height): Timeline area (placeholder for now — gray area with "Timeline loading..." text)
   - Right sidebar (280px):
     - "Cuts" panel: list of detected cuts (from cut map)
     - Each cut: type badge, start-end timestamps, duration, toggle switch (include/exclude)
     - "Credit Estimate" section at bottom: "Estimated credits: X" (sum of active cut durations, rounded up to whole seconds)
     - "Export" button (purple, full-width) — disabled until we wire it up

3. **Video Preview Player**:
   - HTML5 <video> element loading the proxy video URL
   - Custom controls: play/pause button, current time / total time, volume slider, playback speed (0.5x, 1x, 1.5x, 2x)
   - Styled to match dark theme

4. **State Management** (use Zustand):
   - Create an editor store with:
     - project, video, cutMap data
     - activeCuts: array of cut IDs that are currently enabled
     - playheadPosition: current time in seconds
     - isPlaying: boolean
     - zoomLevel: number (1-10)
   - Actions: toggleCut(cutId), setPlayhead(time), play(), pause(), setZoom(level)

Build this as a foundation — the actual Canvas-based timeline components come next.
```

**After completion:** Update DEVIATION_LOG.md. Note the Zustand store shape, component names, data loading pattern.

---

### Prompt 3.2.2 — Build waveform timeline component

**Tool: Lovable**

```
Build the waveform-based timeline component for the NoCut editor.

[Include deviations from DEVIATION_LOG.md — especially the Zustand store shape, data loading pattern, and component structure from the previous prompt]

This replaces the "Timeline loading..." placeholder from the previous prompt.

1. **WaveformTimeline component**:
   - Renders in the bottom 40% of the editor
   - Uses an HTML Canvas element (full width of the timeline area)
   - Loads waveform data from the waveform JSON URL (array of float values representing audio amplitude)
   - Draws the waveform as a centered bar chart (bars go up and down from the center line)
   - Colors: waveform bars in gray (#4B5563), silence regions overlaid in semi-transparent blue (#6C5CE7 at 30% opacity)
   - The waveform should be horizontally scrollable and zoomable

2. **Zoom and Scroll**:
   - Zoom control: + and - buttons, or mouse wheel on the timeline
   - At zoom level 1: entire video visible
   - At zoom level 10: ~10 seconds visible at a time
   - Horizontal scrollbar or drag-to-pan
   - Connect to the Zustand store zoomLevel

3. **Silence Overlays**:
   - For each cut in the cutMap where the cut is in activeCuts:
     - Draw a semi-transparent blue rectangle over the waveform region
     - On hover: show tooltip with cut duration
     - On click: toggle the cut on/off (calls toggleCut in Zustand store)
     - Active cuts have blue overlay; deactivated cuts have no overlay (or very faint gray)

4. **Playhead**:
   - Vertical red line at the current playhead position
   - Moves in real-time during video playback (sync with the video element's timeupdate event)
   - Draggable: user can click/drag on the timeline to seek the video
   - Snaps to cut boundaries when within 100ms

5. **Sync with Video Player**:
   - Clicking on the timeline seeks the video to that timestamp
   - Playing the video moves the playhead
   - The playhead position is stored in Zustand and shared between the video player and timeline

Keep the Canvas rendering performant — pre-render the waveform bitmap at the current zoom level and only re-draw when zoom changes or the view scrolls. Use requestAnimationFrame for playhead animation.
```

**After completion:** Update DEVIATION_LOG.md. Note Canvas performance, any issues with waveform rendering.

---

### Prompt 3.2.3 — Build manual cut tool and cut list

**Tool: Lovable**

```
Add manual cutting capabilities to the NoCut timeline editor.

[Include deviations from DEVIATION_LOG.md — especially the WaveformTimeline component structure and Zustand store]

1. **Manual Cut Tool**:
   - Add a toolbar above the timeline with:
     - "Razor" / scissors icon button to activate cut mode
     - When active, cursor changes to crosshair on the timeline
     - Click once to set cut start point (marked with a vertical line)
     - Click again to set cut end point → creates a new manual cut
     - The new cut appears in the cut list and as a purple overlay on the timeline (different color from auto-detected blue)
     - Press Escape to cancel an in-progress cut
   - Also support click-and-drag: click and drag across the timeline to select a region to cut

2. **Cut List Sidebar** (update the existing right sidebar):
   - Section header: "Detected Pauses" with count
   - Each auto-detected cut:
     - Blue dot indicator
     - Time range: "0:12.3 → 0:15.7"
     - Duration: "3.3s"
     - Toggle switch (on/off)
     - Click to seek video to that cut's start time
   - Section header: "Manual Cuts" with count
   - Each manual cut:
     - Purple dot indicator
     - Same format as above
     - Delete button (X icon) to remove
   - All cuts sorted by start time within their sections

3. **Credit Estimate** (update the existing section):
   - Calculate: sum of durations of all active cuts (both auto and manual)
   - Round up to nearest whole second (that's the credit cost)
   - Display: "Estimated credits: {X}" 
   - Below that: "Your balance: {Y} credits" (fetch from Supabase /credits/balance)
   - If estimated > balance, show warning: "Insufficient credits" in red with "Top Up" link
   - Call the /projects/:id/estimate Edge Function when cuts change (debounced, 500ms)

4. **Export Button** (update):
   - Enabled only when there are active cuts
   - Shows credit cost: "Export (3 credits)"
   - On click: show confirmation modal:
     - "This will use 3 credits to generate AI fills for your cuts"
     - "Credits remaining after export: 54"
     - "Format: MP4, 1080p" (or appropriate for tier)
     - "Confirm & Export" button (purple)
     - "Cancel" button
   - On confirm: call the /projects/:id/edl Edge Function
   - Handle errors: insufficient credits (show top-up modal), entitlement errors (show upgrade modal)

Update the Zustand store to include:
- manualCuts: array of { id, start, end } objects
- addManualCut(start, end), removeManualCut(id)
- creditEstimate: number
- creditBalance: { total, monthly, topup }
```

**After completion:** Update DEVIATION_LOG.md. Note the final editor component tree, state shape.

---

# SPRINT 4: Credit System & Payments

---

## 4.1 — Credit Backend

### Prompt 4.1.1 — Create credit Edge Functions

**Tool: Claude Code**

```
Create the credit-related Supabase Edge Functions for NoCut.

[Include deviations from DEVIATION_LOG.md — especially the actual credit_ledger schema, the deduct_credits function signature, and shared utility patterns]

Create these Edge Functions:

1. **`supabase/functions/credits-balance/index.ts`**

   GET endpoint. No request body.
   - Authenticate user
   - Query credit_ledger for all non-expired entries where credits_remaining > 0
   - Calculate:
     - monthly: sum of credits_remaining where type = 'monthly_allowance'
     - topup: sum of credits_remaining where type = 'top_up'
     - total: monthly + topup
   - Also return the breakdown array with each ledger entry (type, credits_remaining, granted_at, expires_at)
   - Return the balance object

2. **`supabase/functions/credits-history/index.ts`**

   GET endpoint. Query params: limit (default 20), offset (default 0).
   - Authenticate user
   - Query credit_transactions for this user, ordered by created_at desc
   - Join with projects table to get project title for deductions
   - Return paginated list of transactions with total_count

3. **`supabase/functions/credits-topup/index.ts`**

   POST endpoint. Request body: { product_id: string }
   - Authenticate user
   - Validate product_id is one of: nocut_credits_10, nocut_credits_30, nocut_credits_75, nocut_credits_200
   - Map to Stripe price IDs (store in config)
   - Create a Stripe Checkout session:
     - mode: 'payment'
     - line_items: the selected product
     - metadata: { user_id, credit_amount }
     - success_url: APP_URL/credits?success=true
     - cancel_url: APP_URL/credits?cancelled=true
   - Return: { checkout_url, session_id, credits, price }

   Uses Stripe SDK (npm: stripe). Store STRIPE_SECRET_KEY in Supabase Vault / env.

4. **`supabase/functions/project-estimate/index.ts`**

   POST endpoint. Request body: { gaps: [{ pre_cut_timestamp, post_cut_timestamp }] }
   - Authenticate user
   - For each gap, estimate fill duration:
     - Simple heuristic for MVP: fill_duration = min(gap_duration * 0.5, 3.0) seconds
     - Round up each to whole seconds
   - Sum all estimated fill durations = total credits required
   - Query user's credit balance
   - Return: { total_credits_required, credits_available, sufficient, gap_estimates }

5. **`supabase/functions/project-edl/index.ts`**

   POST endpoint. Request body: { gaps: [...], output_format: 'mp4', output_resolution: '1080p' }
   - Authenticate user
   - Check RevenueCat entitlement (ai_fill) — for MVP, check user tier from DB
   - Check tier limits (max fill duration per gap: 1s free, 5s pro/business)
   - Calculate required credits (same logic as estimate)
   - Call the deduct_credits Postgres function
   - If deduction fails: return 402 with topup_options
   - If success: 
     - Create edit_decisions row
     - Create job_queue row (type: 'ai.fill', priority based on tier)
     - Update project status to 'generating'
     - Return: { edit_decision_id, credits_charged, credits_remaining, estimated_processing_seconds }

Reuse the shared utilities from _shared/ for auth, CORS, and response formatting.
```

**After completion:** Update DEVIATION_LOG.md. Note actual function names (Supabase may require kebab-case), Stripe integration details.

---

## 4.2 — RevenueCat + Stripe Webhooks

### Prompt 4.2.1 — Create webhook handlers

**Tool: Claude Code**

```
Create webhook handler Edge Functions for NoCut.

[Include deviations from DEVIATION_LOG.md — especially credit ledger schema, Edge Function naming pattern, shared utilities]

1. **`supabase/functions/webhooks-revenuecat/index.ts`**

   POST endpoint. Called by RevenueCat when subscription events occur.
   
   - Verify authorization header matches REVENUECAT_WEBHOOK_SECRET
   - Parse the event body (RevenueCat webhook format: { api_version, event: { type, app_user_id, product_id, ... } })
   - Handle these event types:

   INITIAL_PURCHASE / RENEWAL:
     - Determine tier from product_id (nocut_pro_monthly/annual → 'pro', nocut_business_monthly/annual → 'business')
     - Update users table: set tier
     - Insert credit_ledger row: monthly_allowance, credits based on tier (pro=60, business=200), expires_at = now + 2 months
     - Insert credit_transactions row: type='allocation', reason='monthly_allowance_{tier}'

   PRODUCT_CHANGE:
     - Determine new tier from new product_id
     - Update users table: set tier
     - If upgrade: allocate prorated credits (calculate days remaining in period, proportional credits)
     - Insert credit_transactions for the allocation

   CANCELLATION:
     - No credit action (credits valid until expiry)
     - Could set a flag on users table if desired (cancel_at_period_end = true)

   EXPIRATION:
     - Update users table: set tier = 'free'
     - Insert credit_ledger: monthly_allowance, 5 credits, expires_at = now + 2 months (free tier)
     - Insert credit_transactions: allocation, reason='free_tier_downgrade'

   BILLING_ISSUE:
     - Log the event
     - Could set a billing_issue flag on users table

   UNCANCELLATION:
     - Clear cancel_at_period_end flag if set

   - Always return 200 OK (RevenueCat retries on non-200)

2. **`supabase/functions/webhooks-stripe/index.ts`**

   POST endpoint. Called by Stripe for top-up purchases.

   - Read raw body for signature verification
   - Verify Stripe webhook signature using STRIPE_WEBHOOK_SECRET
   - Handle event types:

   checkout.session.completed:
     - Extract user_id and credit_amount from session.metadata
     - Verify user exists
     - Insert credit_ledger row: type='top_up', credits = credit_amount, expires_at = now + 1 year
     - Insert credit_transactions: type='allocation', reason='topup_purchase'
     - Log the stripe payment_intent ID

   charge.refunded:
     - Extract the original session metadata
     - Try to deduct the refunded credits from the user's top-up balance
     - If credits already consumed: log for manual review, don't block

   - Always return 200 OK

For Stripe signature verification in Deno Edge Functions, you'll need to use the Stripe webhook construct event utility. Import stripe from npm:stripe.
```

**After completion:** Update DEVIATION_LOG.md. Note webhook URLs for configuring in RevenueCat and Stripe dashboards.

---

## 4.3 — Payments UI

### Prompt 4.3.1 — Build credits page and paywall

**Tool: Lovable**

```
Build the credits page and payment flows for NoCut.

[Include deviations from DEVIATION_LOG.md — especially Edge Function URLs/names, credit balance response format, Stripe product IDs]

1. **Credits Page** (`/credits`):
   
   Top section — Credit Balance:
   - Large number showing total credits
   - Breakdown: "Monthly: X | Top-up: Y"
   - Visual bar showing monthly vs top-up proportion
   - If any credits expiring soon (within 7 days), show warning: "X credits expiring on [date]"
   
   Middle section — Top-Up Packs:
   - Grid of 4 cards (2x2):
     - Starter: 10 credits — $4.99 ($0.50/credit)
     - Standard: 30 credits — $11.99 ($0.40/credit) — "Most Popular" badge
     - Value: 75 credits — $24.99 ($0.33/credit) — "Best Value" badge
     - Bulk: 200 credits — $54.99 ($0.27/credit)
   - Each card: credit amount, price, per-credit cost, "Buy" button
   - On Buy click: call /credits-topup Edge Function → redirect to Stripe Checkout URL
   - On return from Stripe (success_url): show success toast "X credits added!", refresh balance
   - On return from Stripe (cancel_url): show info toast "Purchase cancelled"

   Bottom section — Credit History:
   - Table/list of recent transactions
   - Columns: Date, Type (allocation/deduction/refund), Credits (+/-), Reason, Project
   - Pagination (load more button)
   - Fetch from /credits-history Edge Function

2. **Upgrade Paywall** (modal/page):
   - Triggered when user hits a tier limit (file too large, duration exceeded, fill duration exceeded)
   - Or accessible from Settings → "Upgrade Plan"
   - Shows plan comparison:
     - Free (current if applicable): 5 credits/mo, 720p, 5 min, 1s fills
     - Pro: 60 credits/mo, 1080p, 30 min, 5s fills — $14.99/mo or $9.99/mo (annual)
     - Business: 200 credits/mo, 4K, 2hr, 5s fills — $39.99/mo or $29.99/mo (annual)
   - Toggle: Monthly / Annual (annual highlighted as "Save 33%")
   - "Upgrade to Pro" / "Upgrade to Business" buttons
   - On click: use RevenueCat Web SDK `Purchases.getSharedInstance().purchase({ rcPackage })`
   - After purchase: refresh user tier, show success message, redirect back to where they were

3. **Install and configure RevenueCat Web SDK**:
   - npm install @revenuecat/purchases-js
   - Initialize on app load (after Supabase auth is established):
     `Purchases.configure(REVENUECAT_WEB_BILLING_KEY, supabaseUserId)`
   - Create a RevenueCat context/provider that wraps the app
   - Expose: currentOffering, customerInfo, purchase(package), getCustomerInfo()
   - The paywall should use offerings from RevenueCat to display packages

4. **Insufficient Credits Modal**:
   - Triggered when /project-edl returns 402 (insufficient_credits)
   - Shows: "You need X credits but only have Y"
   - Two options:
     - Quick top-up: show the smallest pack that covers the deficit
     - Upgrade: link to paywall
   - After top-up: auto-retry the export

Connect the credits page to the sidebar navigation (Credits link). Update the Settings page to show current plan from RevenueCat customerInfo.
```

**After completion:** Update DEVIATION_LOG.md. Note RevenueCat SDK initialization pattern, Stripe redirect handling.

---

# SPRINT 5: AI Fill Engine

---

### Prompt 5.1.1 — Build AI Engine service scaffold

**Tool: Claude Code**

```
Build the AI fill engine service for NoCut at `services/ai-engine/`.

[Include deviations from DEVIATION_LOG.md — especially job_queue format, S3 paths, Supabase client pattern from other services]

For Phase 1 MVP, the AI engine will use a **crossfade-based fill** (not actual AI generation). This gives us the full pipeline end-to-end, and we'll swap in the real AI model in Phase 2. The crossfade acts as the Level 2 fallback from the AI Engine Spec.

Structure:
services/ai-engine/
├── Dockerfile
├── requirements.txt
├── src/
│   ├── main.py              # Entry point, job consumer
│   ├── config.py             # Environment variables
│   ├── enrollment.py          # Face enrollment (MediaPipe) — stub for MVP
│   ├── boundary_analyzer.py   # Extract boundary frames, compute deltas
│   ├── fill_generator.py      # Abstract base + crossfade implementation
│   ├── compositor.py          # Temporal blending + color matching
│   ├── validator.py           # Quality scoring (SSIM, etc.)
│   ├── s3_utils.py
│   └── supabase_client.py
└── tests/

**Job payload**: 
{ 
  "job_id": "uuid",
  "project_id": "uuid", 
  "edit_decision_id": "uuid",
  "credit_transaction_id": "uuid",
  "source_video_s3_key": "...",
  "gaps": [
    { "gap_index": 0, "pre_cut_timestamp": 12.34, "post_cut_timestamp": 15.67, "estimated_fill_duration": 1.5 }
  ],
  "target_resolution": "1080p",
  "target_fps": 30
}

**MVP Pipeline** (per gap):

1. **Boundary Analysis**:
   - Download source video from S3
   - Extract last 15 frames before pre_cut_timestamp and first 15 frames after post_cut_timestamp using FFmpeg
   - Save as numpy arrays

2. **Crossfade Fill Generation** (MVP — replaces real AI):
   - Generate N frames (fill_duration * fps) that crossfade from the last pre-cut frame to the first post-cut frame
   - Use OpenCV: linear alpha blend from frame A to frame B
   - This is simple but produces a visible morph — good enough to test the full pipeline

3. **Temporal Compositing**:
   - Apply 5-frame crossfade ramp on each boundary
   - Basic color matching (histogram equalization between boundary frames)

4. **Quality Validation**:
   - Compute SSIM between generated boundary frames and real boundary frames
   - For crossfade, this will always score relatively high
   - Return a composite quality score

5. **Output**:
   - Encode generated frames as MP4 segment using FFmpeg
   - Upload to S3: `ai-fills/{user_id}/{project_id}/fill_{gap_index}.mp4`
   - Update ai_fills table with method='crossfade' (since MVP is crossfade, not ai_fill)
   - Update edit_decisions status

6. After ALL gaps processed:
   - Update project status to 'exporting'
   - Enqueue video.export job

The **FillGenerator** should use an abstract base class so we can swap in real AI providers later:

```python
class FillGenerator(ABC):
    @abstractmethod
    def generate(self, pre_frames, post_frames, speaker_embedding, target_frame_count) -> GenerationResult:
        pass

class CrossfadeFillGenerator(FillGenerator):
    def generate(self, pre_frames, post_frames, speaker_embedding, target_frame_count):
        # Linear crossfade implementation
        ...

# Future:
# class DIDFillGenerator(FillGenerator): ...
# class VeoFillGenerator(FillGenerator): ...
```

**Dockerfile**: Python 3.11 + OpenCV + NumPy + FFmpeg. No GPU needed for crossfade MVP.

Handle credit refunds: if all gaps fall back to crossfade (which they will in MVP), the credits should technically be refunded since no AI was used. For MVP, we can skip the refund logic and charge credits anyway (the crossfade IS the product for now), OR refund and make crossfade free. Decision: charge credits for now — the user sees a seamless result.

Include error handling: if any gap fails completely, update that gap's ai_fills entry with method='hard_cut' and trigger a credit refund for that gap.
```

**After completion:** Update DEVIATION_LOG.md. Note whether credits are charged for crossfade in MVP, actual provider pattern.

---

# SPRINT 6: Export Pipeline

---

### Prompt 6.1.1 — Build export service

**Tool: Claude Code**

```
Build the video export service for NoCut at `services/exporter/`.

[Include deviations from DEVIATION_LOG.md — especially ai_fills table structure, S3 paths for fill segments, edit_decisions format]

Structure:
services/exporter/
├── Dockerfile
├── package.json  (or requirements.txt if Python)
├── src/
│   ├── index.ts (or main.py)    # Entry point, job consumer
│   ├── assembler.ts             # Video assembly logic
│   ├── watermark.ts             # Watermark overlay (free tier)
│   ├── audio.ts                 # Audio normalization
│   ├── s3.ts                    # S3 utilities
│   └── supabase.ts              # DB client
└── Dockerfile

Use Node.js with FFmpeg (child_process) OR Python with subprocess — whichever matches the transcoder service pattern we already built.

**Job payload**:
{
  "job_id": "uuid",
  "project_id": "uuid",
  "edit_decision_id": "uuid",
  "user_id": "uuid",
  "source_video_s3_key": "...",
  "edl": [
    { "type": "source", "start": 0.0, "end": 12.34 },
    { "type": "fill", "s3_key": "ai-fills/.../fill_0.mp4", "duration": 1.5 },
    { "type": "source", "start": 15.67, "end": 45.00 },
    { "type": "fill", "s3_key": "ai-fills/.../fill_1.mp4", "duration": 1.0 },
    { "type": "source", "start": 47.50, "end": 300.5 }
  ],
  "output_format": "mp4",
  "output_resolution": "1080p",
  "watermark": true,
  "tier": "free"
}

**Assembly pipeline**:

1. Download source video and all fill segments from S3

2. Create an FFmpeg concat list file:
   - For each source segment: extract the clip using `-ss` and `-to` flags
   - For each fill segment: reference the fill file directly
   - Write a concat.txt file listing all segments in order

3. Concatenate all segments:
   `ffmpeg -f concat -safe 0 -i concat.txt -c copy output_raw.mp4`
   (If codecs don't match, use re-encoding: `-c:v libx264 -c:a aac`)

4. Audio normalization:
   `ffmpeg -i output_raw.mp4 -af loudnorm=I=-16:LRA=11:TP=-1.5 -c:v copy output_norm.mp4`

5. Watermark (free tier only):
   `ffmpeg -i output_norm.mp4 -vf "drawtext=text='Made with NoCut':fontsize=24:fontcolor=white@0.5:x=w-tw-20:y=h-th-20" output_final.mp4`
   Skip this step for Pro/Business tier.

6. Resolution check:
   If the user's tier limits resolution (720p for free), scale down:
   `ffmpeg -i output.mp4 -vf scale=-2:720 output_720p.mp4`

7. Upload final video to S3: `exports/{user_id}/{project_id}/{export_id}.mp4`

8. Generate CloudFront signed download URL (1-hour expiry)

9. Update Supabase:
   - Insert exports row with all metadata
   - Build fill_summary_json: { total_gaps, ai_fills, crossfades, hard_cuts, credits_used, credits_refunded }
   - Update edit_decisions status to 'complete'
   - Update project status to 'complete'
   - Update job_queue to 'complete'

10. Clean up temp files

**Error handling**: On failure, update project status to 'failed', job_queue to 'failed'. Do NOT refund credits on export failure (the AI fills were already generated). User can retry the export.

**Dockerfile**: Same base as transcoder (Node.js + FFmpeg or Python + FFmpeg).
```

**After completion:** Update DEVIATION_LOG.md.

---

### Prompt 6.1.2 — Build export UI

**Tool: Lovable**

```
Build the export progress and completion UI for NoCut.

[Include deviations from DEVIATION_LOG.md — especially the project status flow, export table structure, download URL format]

1. **After EDL submission** (from the editor's Export button):
   - Navigate to or show an overlay: "Generating your video..."
   - Subscribe to Supabase Realtime on job_queue for this project
   - Show progress stages:
     a. "Generating AI fills..." (status: generating) — show per-gap progress if available
     b. "Assembling video..." (status: exporting) — show overall progress
     c. "Finalizing..." (near completion)
   - Progress bar with percentage

2. **Export Complete**:
   - Route: `/project/:projectId/export/:exportId` (or modal overlay)
   - Video preview: <video> element streaming from the CloudFront download URL
   - Below the preview:
     - "Download" button (prominent, purple) — triggers file download
     - File info: format, resolution, duration, file size
   - Export summary card:
     - Total cuts: X
     - AI fills: Y (credits used: Z)
     - Crossfades: A (credits refunded: B)
     - Hard cuts: C
     - Net credits used: Z - B
   - "Back to Editor" link
   - "New Project" link

3. **Export on Dashboard**:
   - Update the project card on the dashboard to show status 'complete' with a green badge
   - Clicking a completed project goes to the export page (or editor with export accessible)

4. **Export Failure**:
   - If project status becomes 'failed' during export:
     - Show error message
     - "Try Again" button (re-submits the EDL)
     - Note: credits were already charged for AI fills, not refunded on export failure
```

**After completion:** Update DEVIATION_LOG.md.

---

# SPRINT 7: Integration & Polish

---

### Prompt 7.1.1 — End-to-end testing checklist

**Tool: Claude Code**

```
Create a comprehensive end-to-end test plan for NoCut MVP at `docs/E2E_TEST_PLAN.md`.

[Include all deviations from DEVIATION_LOG.md — this test plan should reflect the ACTUAL implementation, not the original spec]

The test plan should cover these scenarios as manual test scripts:

1. **New User Sign Up Flow**:
   - Sign up with email/password → verify user created in Supabase → verify 5 free credits allocated → land on dashboard → see empty state

2. **Upload Happy Path**:
   - Upload a 2-minute MP4 talking-head video → chunked upload completes → transcoding runs → detection runs → editor opens with waveform + silence regions

3. **Editor Happy Path**:
   - Review auto-detected silences → toggle some off → add a manual cut → verify credit estimate updates → click Export → confirm credits → generation starts

4. **Export Happy Path**:
   - Generation completes → export assembles → video available → download works → playback is smooth with crossfade transitions at cut points

5. **Credit Depletion**:
   - Use all 5 free credits → attempt another export → see "Insufficient credits" → purchase 10-credit top-up via Stripe → credits appear → retry export succeeds

6. **Subscription Purchase**:
   - From paywall, purchase Pro Monthly via RevenueCat → tier updates to 'pro' → 60 credits allocated → tier limits expanded (30min upload, 1080p export, 5s fills)

7. **Free Tier Limits**:
   - Try to upload a 10-minute video on free tier → see "Duration exceeded" error with upgrade prompt
   - Export on free tier → verify 720p output with watermark

8. **Error Recovery**:
   - Kill upload mid-way → verify resume works
   - Force detection to fail → verify project shows 'failed' with retry option

For each test, document:
- Preconditions
- Steps (numbered)
- Expected results
- Actual results (to be filled during testing)
- Pass/Fail

Also create a simple smoke test script that can be run after each deploy.
```

**After completion:** Run through the test plan. Document all failures in DEVIATION_LOG.md with fixes.

---

### Prompt 7.1.2 — UI polish pass

**Tool: Lovable**

```
Do a polish pass on the entire NoCut app. Review all pages and components and fix these common issues:

[Include deviations from DEVIATION_LOG.md — especially any component names, routes, or state management patterns that differ from the original plan]

1. **Loading States**:
   - Dashboard: skeleton cards while projects load
   - Editor: skeleton layout while video/cut map loads
   - Credits page: skeleton while balance loads
   - Any button that triggers an async action should show a spinner and be disabled during loading

2. **Error States**:
   - Add a toast notification system (top-right corner, auto-dismiss after 5 seconds)
   - Success toasts: green (upload complete, export ready, credits purchased)
   - Error toasts: red (upload failed, network error, API error)
   - Warning toasts: yellow (low credits, approaching tier limit)
   - Use this toast system everywhere — replace any alert() calls

3. **Empty States**:
   - Dashboard with no projects: illustration + "Upload your first video"
   - Credits page with no history: "No transactions yet"
   - Editor before detection: "Analyzing your video..."

4. **Consistency Check**:
   - All buttons use consistent purple (#6C5CE7) for primary actions
   - All text uses consistent colors: white for headings, gray (#9CA3AF) for secondary text
   - All cards use consistent dark backgrounds (#1F2937) with subtle borders (#374151)
   - All modals have consistent overlay (black 50% opacity) and centered card

5. **Edge Cases**:
   - Very long project titles: truncate with ellipsis
   - Very short videos (< 30 seconds): should still work
   - Videos with no detected silences: show message "No pauses detected. You can still add manual cuts."
   - Zero credit balance: show prominent upgrade/top-up CTAs

6. **Navigation polish**:
   - Active sidebar link should be clearly highlighted
   - Browser back/forward should work correctly
   - Page titles should update for each route (document.title)
```

**After completion:** Final DEVIATION_LOG.md update.

---

### Prompt 7.1.3 — Set up CI/CD and deployment

**Tool: Claude Code**

```
Set up CI/CD and deployment for NoCut.

[Include deviations from DEVIATION_LOG.md — especially actual service names, Docker image names, Supabase project structure]

1. **GitHub Actions** at `.github/workflows/`:

   `ci.yml` — Runs on every PR:
   - Lint Supabase Edge Functions (deno lint)
   - Run Edge Function tests (if any)
   - Build Docker images for all services (don't push, just verify they build)
   - Run Python tests for detector and ai-engine
   - Run Node.js tests for transcoder and exporter

   `deploy-staging.yml` — Runs on merge to `develop` branch:
   - Deploy Supabase Edge Functions to staging project: `supabase functions deploy --project-ref STAGING_REF`
   - Apply Supabase migrations to staging: `supabase db push --project-ref STAGING_REF`
   - Build and push Docker images to ECR with :staging tag
   - Update ECS services to use new images (force new deployment)

   `deploy-production.yml` — Manual trigger (workflow_dispatch) on `main` branch:
   - Same as staging but targeting production Supabase and ECS
   - Require approval (GitHub environment protection rules)

2. **Environment setup**:
   - Document how to set up GitHub Secrets for: SUPABASE_ACCESS_TOKEN, AWS credentials, STRIPE keys, etc.
   - Create staging and production environment configs

3. **Monitoring basics**:
   - Add CloudWatch alarms (via Terraform):
     - ECS service CPU > 80% for 5 minutes
     - Redis memory > 80%
     - S3 bucket size approaching limit
   - Add a simple health check endpoint for each ECS service

4. **Lovable deployment**:
   - Document the Lovable publish process (it's done through the Lovable UI)
   - Note custom domain configuration steps
   - Note environment variable configuration in Lovable for Supabase URL, anon key, RevenueCat key
```

**After completion:** Final DEVIATION_LOG.md update. MVP is ready for testing!

---

# Post-Sprint: Handoff Checklist

After completing all sprints, verify:

- [ ] Sign up / sign in works (email + Google)
- [ ] Dashboard shows projects
- [ ] Video upload works (chunked, resumable)
- [ ] Transcoding produces proxy + waveform
- [ ] Silence detection finds pauses
- [ ] Timeline editor displays waveform + silence overlays
- [ ] Manual cuts can be added/removed
- [ ] Credit estimate updates in real-time
- [ ] Export deducts credits and generates video
- [ ] Crossfade transitions are smooth at cut points
- [ ] Watermark appears on free tier exports
- [ ] Credit top-up via Stripe works
- [ ] Subscription purchase via RevenueCat works
- [ ] Webhook handlers process events correctly
- [ ] Credit balance reflects all allocations and deductions
- [ ] Free tier limits are enforced
- [ ] DEVIATION_LOG.md is complete and up to date

**Next step after MVP:** Swap the CrossfadeFillGenerator for a real AI provider (D-ID, HeyGen, or Veo) — this is Sprint 5 of Phase 2 and only requires implementing a new adapter class and updating the model routing config.
