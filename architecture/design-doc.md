# Savra PPT Generation — Engineering Architecture Document

**Role:** Full-Stack Engineering Candidate  
**Scope:** PPT Generation System Redesign ([ASSIGNMENT.md](../ASSIGNMENT.md))  
**LLM Choice:** OpenAI (chat + L2 embeddings) and Anthropic (chat); assignment allows any provider  
**Prototype status:** Outline-first async pipeline, L1+L2 cache, CBSE chapter catalog, slide add/delete — see [CHANGELOG.md](../CHANGELOG.md)

**Diagram:** See [`diagram.md`](diagram.md) for Mermaid architecture views (flowchart, sequence, cache layers).

### Submission checklist (assignment §05)

| Deliverable | Location |
|-------------|----------|
| Architecture document (Part 1) | This file |
| System diagram | [`diagram.md`](diagram.md) (Mermaid — renders on GitHub) |
| Backend | [`backend/`](../backend/) — `api/` HTTP server + `worker/` queue consumer |
| Frontend UI | [`frontend/`](../frontend/) |
| Decisions + rationale | [`DECISIONS.md`](../DECISIONS.md) |
| Pitch / demo script | [`PITCH_SCRIPT.md`](../PITCH_SCRIPT.md) |

---

## The Problem, Stated Precisely

The current system has three distinct failure modes, and they share one root cause:

**Root cause:** The system is synchronous and one-shot. One HTTP request → one LLM call → one blocked teacher. There is no reviewable outline, no queue, no cache, no fallback logic that doesn't degrade quality, and no separation between content generation and slide building.

**The three failures:**

| Failure | Symptom | Root Cause |
|---|---|---|
| Cost (₹15/PPT) | Unsustainable at scale | Wrong model, no caching, wasted tokens on layout |
| Latency (30s → 2min) | Teacher stuck on spinner | Synchronous blocking, no async handoff |
| Reliability (503s) | Errors mid-workflow | Single LLM dependency, no real fallback |

Fixing any one of these without addressing the others is cosmetic. This document addresses all three together through a single architectural shift.

---

## Part 1 — System Architecture

### The Core Architectural Decision: Outline-First + Async Export

The most important choice in this redesign is moving from synchronous one-shot generation to an outline-first workflow with asynchronous final export. This is not optional — it is the foundation everything else builds on.

**Current (synchronous):**
```
Teacher submits form
  → HTTP request held open
    → Backend calls LLM (30s)
      → Template injection (2s)
        → Response sent
Teacher waits 32 seconds staring at a spinner.
If the LLM 503s, the teacher gets an error.
```

**Proposed (outline-first + async):**
```
Teacher submits form
  → API returns editable slide-level draft
    → Teacher edits titles, bullets, examples, speaker notes
      → Teacher clicks Generate PPTX
        → HTTP POST returns in <100ms with a jobId
          → Background worker renders final PPTX
Teacher's UI is never blocked, and teachers can correct content before final export.
```

This changes the entire failure surface. The teacher never sees a 503. The backend never times out. The system can retry, switch models, and recover — all invisibly. For reviewed drafts, the final export can skip the LLM entirely and render approved structured content.

---

### Request Flow (Detailed)

```
┌─────────────┐       POST /api/ppt/outline     ┌──────────────────┐
│   Teacher   │ ──────────────────────────────→ │   API Server     │
│  (Browser)  │ ←──── editable slide draft ───  │  (Fastify/Node)  │
│             │                                  └────────┬─────────┘
│ edits draft │                                           │
│             │       POST /api/ppt/generate              │
│             │ ──────────────────────────────────────────┘
│             │ ←────── { jobId, status }─────  ┌──────────────────┐
│             │                                  │   API Server     │
│             │                                  └────────┬─────────┘
│  polls every│                                           │ enqueue
│  3 seconds  │                                           ▼
│  GET /job/:id│                                 ┌──────────────────┐
│             │                                  │   BullMQ Queue   │
│             │                                  │   (Redis-backed) │
│             │                                  └────────┬─────────┘
│             │                                           │ dequeue
│             │                                           ▼
│             │                              ┌────────────────────────┐
│             │                              │      PPT Worker        │
│             │                              │                        │
│             │                              │  1. Use approved draft │
│             │                              │     or check L1 cache  │
│             │                              │     (Redis hash)       │
│             │                              │  2. Check L2 cache     │
│             │                              │     (semantic embed)   │
│             │                              │  3. Call LLM if needed │
│             │                              │     (Haiku → Sonnet    │
│             │                              │      fallback)         │
│             │                              │  4. Build PPTX         │
│             │                              │     (pptxgenjs)        │
│             │                              │  5. Store in S3/disk   │
│             │                              │  6. Update job status  │
│  "✓ Ready   │    Job status = "done"       └────────────────────────┘
│  Download"  │ ←────────────────────────────────────────────────────
└─────────────┘
```

### API Contracts

**GET `/api/ppt/chapters?grade=8&subject=Science`**

Returns NCERT-aligned chapter names merged with teacher-submitted chapters (Redis SET).

**POST `/api/ppt/outline`**

Request:
```json
{
  "chapter": "Photosynthesis",
  "grade": 8,
  "subject": "Science",
  "numSlides": 10
}
```

(`topic` accepted as deprecated alias for `chapter`.)

Resolution order: **L1 exact cache → L2 semantic cache → LLM (if API key) → template (mock)**.

Response:
```json
{
  "presentation": { "presentationTitle": "...", "slides": [] },
  "cached": true,
  "strategy": "l1-cache | l2-semantic | llm | template",
  "similarityScore": 0.94,
  "matchedChapter": "Photosynthesis",
  "estimatedSecondsSaved": 20
}
```

**POST `/api/ppt/generate`**

Request:
```json
{
  "chapter": "Photosynthesis",
  "grade": 8,
  "subject": "Science",
  "numSlides": 10,
  "language": "en"
}
```

The same endpoint can also accept an approved `presentation` object. In that path, the worker renders directly from the teacher-approved slide JSON instead of making another LLM call.

Response (immediate, <100ms):
```json
{
  "jobId": "a3f8c21e",
  "status": "queued",
  "estimatedSeconds": 15,
  "pollUrl": "/api/ppt/job/a3f8c21e"
}
```

**GET `/api/ppt/job/:jobId`**

Response (in-progress):
```json
{
  "jobId": "a3f8c21e",
  "status": "processing",
  "step": "Generating slide content...",
  "progress": 40,
  "cached": false
}
```

Response (done):
```json
{
  "jobId": "a3f8c21e",
  "status": "done",
  "cached": true,
  "downloadUrl": "/api/ppt/download/a3f8c21e",
  "expiresAt": "2026-05-22T10:00:00Z",
  "tokensUsed": 0
}
```

---

## Part 2 — Cost Reduction Strategy

### Where the ₹15/PPT Goes Today

Before fixing it, we need to understand where the cost actually comes from. At ₹15/PPT = ~$0.18/PPT (at ₹83/$1), the current system is almost certainly using an expensive model with no caching and token-heavy prompts.

Breakdown of likely current token usage (10-slide deck, Gemini Pro pricing equivalent):
- System prompt repeated on every request: ~1,200 tokens
- Per-slide generation (10 slides, sequential): ~1,000 tokens each = 10,000 tokens
- Layout injection instructions included in prompt: ~2,000 tokens
- Total input: ~13,200 tokens + ~5,000 tokens output

That's a very expensive request. The three biggest levers to pull are:

**Lever 1: Model Selection (biggest single change)**

Switch from a single expensive default model to a provider-agnostic model router for standard requests.

| Model | Input (per MTok) | Output (per MTok) |
|---|---|---|
| Fast structured-output model | Low | Low |
| Higher-quality model | Medium | Medium |
| Premium reasoning model | High | High |

The right primary model is a fast structured-output model. The task is schema-constrained educational content generation, not open-ended reasoning. A higher-quality model becomes the fallback or upgrade path only when complexity or provider health requires it.

**Lever 2: Prompt Caching (90% off repeated input)**

Most major providers now offer some form of prompt or context caching. The prototype uses Anthropic cache controls, but the architecture should treat this as a provider capability, not a hard dependency.

The system prompt — which includes the slide schema, formatting rules, grade-level instructions, and output format — is the same for every request. Cache it. This turns a recurring 1,200-token cost into a one-time write + repeated 10% reads.

**Lever 3: Template-First Generation (60-70% fewer output tokens)**

This is the most important architectural change for cost. The current approach likely asks the LLM to generate the full slide including layout decisions. Instead:

- Define 5-6 fixed slide layout templates in code (title, bullet-list, two-column, image+text, quote, data-table)
- Ask the LLM to generate only content as structured JSON: `{ slideType, title, bullets[], bodyText, notes }`
- The PPTX builder (pptxgenjs) handles all layout, positioning, and styling

This eliminates layout tokens entirely from the LLM output. A 10-slide deck that previously needed 5,000 output tokens now needs ~2,000.

### Real Cost Math

**Per-PPT token budget (new system, 10 slides):**

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| System prompt (cached read) | 1,200 | $0.10/MTok | $0.00012 |
| User prompt (fresh input) | 200 | $1.00/MTok | $0.00020 |
| Output (structured JSON, all 10 slides) | 2,000 | $5.00/MTok | $0.01000 |
| **Total per LLM call** | | | **$0.01032** |
| **In rupees (₹83/$1)** | | | **≈ ₹0.86** |

With caching applied (L1 exact + L2 semantic), using EdTech's observed ~45% cache hit rate:
- 55% of requests hit the LLM: 0.55 × ₹0.86 = ₹0.47
- 45% served from cache: ₹0
- **Average cost per PPT: ₹0.47**

That is a **97% cost reduction** from ₹15.

### Bonus: Monthly Cost Projection at 10,000 Users

Assumptions:
- 10,000 users total; 50% are teachers = 5,000 teachers
- Each teacher generates 2 PPTs/week = 10,000 PPTs/week = ~43,333 PPTs/month

| Scenario | PPTs/month | Cost/PPT | Monthly LLM Cost |
|---|---|---|---|
| Current system | 3,000 (100/day) | ₹15.00 | ₹45,000 |
| New system, 0% cache | 43,333 | ₹0.86 | ₹37,267 |
| New system, 45% cache | 43,333 | ₹0.47 | ₹20,366 |
| New system, 45% cache + Batch API* | 43,333 | ₹0.24 | ₹10,400 |

*Anthropic's Batch API gives 50% off on async workloads — which this architecture already supports.

**Bottom line:** The new system handles 14× the volume at less than half the current monthly cost.

---

## Part 3 — Caching Architecture (Two Layers)

Caching is the single highest-ROI optimization after the async queue. There are two layers, serving different purposes.

### Layer 1: Exact Match Cache (L1)

**How it works:** Hash the normalized request parameters using SHA-256 and look up in Redis. O(1) lookup, sub-millisecond response.

**Normalization before hashing:**
```
chapter.toLowerCase().trim().replace(/\s+/g, ' ')
grade (integer)
subject.toLowerCase().trim()
numSlides (integer)
```

"Class 8 Photosynthesis 10 slides" and "class 8  photosynthesis  10 slides" must produce the same L1 hash. L2 catches phrasing that L1 misses via embeddings.

**Cache key format:** `ppt:content:l1:{sha256(chapter|grade|subject|numSlides)}`

**What's stored:** The full generated slide JSON (not the PPTX — the PPTX is rebuilt from the JSON on cache hit, which takes ~1s and costs nothing vs the LLM).

**TTL:** 7 days. Curriculum content doesn't change frequently.

**Expected hit rate:** 15-30% (exact duplicates — same chapter, grade, subject, slides). Teachers commonly regenerate the same chapter. In EdTech, automated retries and repeated requests can push this to 30%.

### Layer 2: Semantic Cache (L2)

**How it works:** When L1 misses, embed the normalized request using a lightweight embedding model, then cosine-similarity search against stored embeddings. "Class 8 Photosynthesis" and "Grade 8 Photosynthesis" are semantically the same request but have different hashes.

**Implementation:**
- Embedding model: `text-embedding-3-small` (OpenAI, $0.02/MTok) or Anthropic's own embedding endpoint. The cost per embedding is ~0.0001¢ — negligible.
- Vector storage: Redis with RediSearch module (sufficient up to ~1M entries). No separate vector DB needed at this scale.
- Similarity threshold: Start at 0.92. Below that, go to LLM. Tune based on observed false-positive rate.

**Expected hit rate:** EdTech platforms report 40-45% semantic cache hit rates. Combined with L1, total cache hit rate of 45-55% is realistic.

**Prototype status:** L1 and L2 are both implemented. L2 uses OpenAI `text-embedding-3-small`, Redis hash index, and brute-force cosine similarity (threshold 0.92, same grade+subject required). Production upgrade: RediSearch KNN when index exceeds ~10K entries.

**Bonus cost answer (10K users, 50% teachers, 2 PPTs/week ≈ 43,333 PPTs/month):**

| Scenario | Monthly LLM cost (approx.) |
|---|---|
| Current system @ ₹15/PPT | ₹6,50,000 |
| New system, no cache | ₹37,267 |
| L1 ~30% hit | ₹26,087 |
| L1 + L2 ~40.5% combined hit | ₹22,130 |
| + 50% teacher-approved export (0 tokens) | ~₹11,065 |

Embedding cost is negligible (~$1/month) vs LLM savings.

### Cache Invalidation

Cache TTL is the primary invalidation mechanism. For explicit invalidation (e.g., curriculum updates), implement tag-based invalidation: store a set of cache keys per `(grade, subject)` pair, and flush the set when a teacher admin triggers a refresh.

---

## Part 4 — Reliability Plan

### The Real Problem with 503s

A 503 from an LLM provider is not a bug — it is expected behavior under load. The current system has no strategy for it beyond "show the teacher an error." The new system never shows the teacher an error for a transient LLM failure.

### Retry Strategy (Exponential Backoff)

BullMQ handles retries natively. Configure the PPT worker with:

```
attempts: 3
backoff:
  type: exponential
  delay: 1000ms   → retries at 1s, 2s, 4s
```

Three retries with exponential backoff handle the vast majority of transient 503s. The teacher sees "still generating" — not an error.

### Model Fallback (Not Degraded Quality)

After 3 failed Haiku attempts, the worker escalates to Sonnet 4.6 — not as a "cheap fallback" but as a more reliable model. The prompt and output schema are identical. The teacher gets the same quality output; it just costs 3× more for that one request (~₹2.58 instead of ₹0.86).

This happens for a small fraction of requests (Haiku 503 rate is low; Sonnet is used only as exception). The blended average cost barely moves.

**Fallback sequence:**
```
Haiku 4.5 → [503] → retry 1 (1s) → [503] → retry 2 (2s) → [503] → retry 3 (4s) → [503]
  → escalate to Sonnet 4.6 → [503] → retry 1 → [503] → retry 2
    → mark job failed → notify teacher via email/notification
    → offer "retry later" button
```

The teacher only receives a failure notification after all retries on both models are exhausted. In practice, this is rare.

### Dead Letter Queue

BullMQ moves exhausted-retry jobs to a "failed" set. Monitor this set and alert on it. Do not let it grow silently. Set `removeOnFail: { count: 100 }` to keep only the last 100 failed jobs in Redis memory.

### Worker Isolation

Run the PPT worker as a **separate process from the API server**. A worker crash should not take down the API. In production on Railway/Render, this means two separate deployed services: `api` and `worker`.

This also enables independent scaling — if the queue backs up, you scale workers horizontally without touching the API.

---

## Part 5 — Scaling Plan

### Behavior at Different Load Levels

**Current load (~100 PPTs/day):**

The new architecture is overbuilt for this. A single worker process on a $7/month Railway instance handles it trivially. Redis can run on the same box. This is the MVP configuration.

**500 PPTs/day (5× current):**

Single worker starts showing queue depth > 10 jobs during peak hours. Add a second worker process. Redis stays on a single node. No infrastructure changes needed beyond horizontal worker scaling.

**2,000 PPTs/day (20× current, ~10K users):**

At 2,000 PPTs/day and ~8 working hours, that's ~4 PPTs/minute. Each PPT takes 10-15s end-to-end. A single worker handles ~4-6 PPTs/minute. You need 1-2 workers at this load. Still manageable on a single Redis node. Add a Redis Cloud instance ($30/month) for HA.

**Bottlenecks at this scale and how to eliminate them:**

| Bottleneck | When It Hits | Fix |
|---|---|---|
| LLM rate limits | ~500 PPTs/day | Distribute across 2-3 API keys, or use Anthropic's Batch API for queued work |
| Redis memory | ~100K cached entries | Set `maxmemory-policy: allkeys-lru` — evict least-recently-used automatically |
| File storage (PPTX) | Continuous growth | Store in S3/Cloudflare R2 ($0.015/GB), not local disk. Generate signed time-limited download URLs. |
| Worker concurrency | Queue depth growing | BullMQ `concurrency: N` — start at 5, tune up. Each worker can handle N jobs in parallel |

### Infrastructure Decisions: Now vs Later

**Build now:**
- Async queue (non-negotiable — this is the foundation)
- L1 exact cache (30 minutes of work, immediate ROI)
- Two-process deployment (API + worker)
- S3/R2 file storage (local disk breaks as soon as you have more than one worker instance)

**Build at 500 PPTs/day:**
- L2 semantic cache
- Redis Cloud HA instance
- Worker autoscaling (BullMQ exposes queue depth metrics; feed them to your hosting platform's autoscaler)

**Build at 2,000 PPTs/day:**
- Anthropic Batch API integration for non-urgent jobs (50% cost reduction on top of everything else)
- Queue priority tiers: premium teachers get a high-priority queue, free tier goes to standard queue
- Structured logging + cost dashboard (know exactly what each teacher costs you per month)

---

## Part 6 — Template-First Generation (Implementation Detail)

This deserves its own section because it is the part most likely to get implemented wrong.

### Why Template-First

Naive LLM-powered slide generation asks the model: "Generate a full slide about photosynthesis." The LLM outputs: title, body text, bullet points, suggested layout, color notes, image descriptions, speaker notes. Most of that output is tokens you're paying for but don't need — the template handles layout.

Template-first separates the concerns:

- **LLM's job:** Generate content as structured JSON (fast, cheap, reliable)
- **pptxgenjs's job:** Inject that content into pre-designed templates (deterministic, free)

### Slide Templates to Define (in Code)

Define these 5 layouts as JavaScript objects in pptxgenjs. Pre-define all colors, fonts, positions, and sizes:

1. **`title`** — Large topic title, subtitle, decorative element. Used for slide 1 only.
2. **`bullet-list`** — Slide title + 4-6 bullet points. Most common layout.
3. **`two-column`** — Slide title + two content panels side by side. Good for comparisons.
4. **`content-with-image`** — Left text panel + right image placeholder. Visual.
5. **`quote-or-definition`** — Large text block with accent styling. Good for key concepts.

### The LLM Prompt Structure

The system prompt (cached, ~1,200 tokens) defines the schema and rules once:

```
You are a slide content generator for Indian school teachers.
Output ONLY valid JSON matching this schema — no markdown, no explanation.

Schema:
{
  "presentationTitle": string,
  "slides": [
    {
      "slideType": "title" | "bullet-list" | "two-column" | "content-with-image" | "quote-or-definition",
      "title": string (max 8 words),
      "bullets": string[] (max 5 items, max 12 words each),
      "bodyText": string (max 40 words),
      "leftContent": string (for two-column only),
      "rightContent": string (for two-column only),
      "quoteText": string (for quote-or-definition only),
      "speakerNote": string (max 30 words, for teacher use)
    }
  ]
}

Rules:
- First slide must be type "title"
- Mix slide types across the deck for variety
- Content must be accurate and appropriate for the specified grade level
- Keep text extremely concise — slides are visual aids, not textbooks
- Do not reference images you cannot see — describe concepts in text
```

The user prompt (fresh, ~200 tokens) is just:
```
Topic: Photosynthesis
Grade: 8
Subject: Science
Number of slides: 10
```

This separation means the expensive part (system prompt) is cached. The cheap part (user prompt) is fresh. The output is minimal structured JSON — not verbose prose.

---

## Tech Stack (Justified)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | pptxgenjs is JS-native; BullMQ is JS-native; no context switch |
| Framework | Fastify (not Express) | 2× the throughput of Express for the API server, built-in JSON schema validation |
| Queue | BullMQ + Redis | Battle-tested, TypeScript-native, handles retries/backoff/concurrency natively, 3.2ms p50 latency under load |
| LLM (prototype) | Anthropic adapter | One real provider implementation; assignment allows any LLM |
| LLM (production) | Provider router | Choose OpenAI/Gemini/Anthropic/open-source based on cost, health, and quality |
| PPTX generation | pptxgenjs | Only mature Node.js PPTX library, no LibreOffice dependency, ~1s per deck |
| Cache | Redis (same instance) | L1 exact hash; add RediSearch for L2 semantic at scale |
| File storage | Cloudflare R2 | S3-compatible API, $0.015/GB storage, free egress — cheaper than S3 |
| Frontend | React + Tailwind | Polling-based status UI; no WebSockets needed at this scale |
| Hosting | Railway | Supports separate services (API + worker) on free/starter plan; easy Redis add-on |
| Embeddings (L2 cache) | OpenAI text-embedding-3-small | $0.02/MTok — essentially free for this use case |

---

## Directory Structure (for Claude Code)

When implementing, use this structure:

```
savra-gen/
├── architecture/
│   ├── design-doc.md           # Part 1 (this document)
│   └── diagram.md              # Mermaid system diagram
├── backend/
│   ├── api/                    # Fastify API server
│   │   └── src/
│   │       ├── routes/ppt.ts
│   │       ├── lib/            # cache, semantic-cache, llm, chapters
│   │       └── index.ts
│   └── worker/                 # BullMQ worker (separate process)
│       └── src/
│           ├── processor.ts
│           ├── llm.ts
│           ├── pptx-builder.ts
│           └── index.ts
├── packages/shared/            # Shared types (reference)
├── frontend/                   # React app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── GenerateForm.tsx
│   │   │   └── JobStatus.tsx   # Polling component
│   │   └── api.ts              # API client
│   └── package.json
│
├── docker-compose.yml          # Local: Redis + API + Worker
└── railway.toml                # Deploy config
```

---

## Key Implementation Notes for Claude Code

1. **BullMQ requires `maxRetriesPerRequest: null`** on the ioredis connection. Without this, BullMQ throws immediately instead of waiting.

2. **Anthropic prompt caching** requires adding `"cache_control": {"type": "ephemeral"}` to the system prompt block in the API call. The cache TTL is 5 minutes (resets on each hit) or 1 hour (costs 2× to write). For PPT generation where requests cluster during school hours, 5-minute TTL is sufficient.

3. **pptxgenjs `writeFile()`** is async and writes to disk. In a worker environment, write to a temp path first, upload to R2, then delete the local file. Never write to the API server's filesystem.

4. **BullMQ job data size** should be kept small. Store large payloads (generated slide JSON) in Redis separately and reference by key in the job data. Job data is stored in Redis Sorted Sets — keep it under 1KB.

5. **Poll interval:** 3 seconds is the right default for the frontend. At 15s average generation time, that's 5 polls per job. WebSockets are not needed and add complexity. If you want push notifications at scale, add Server-Sent Events (SSE) in week 2.

6. **removeOnComplete and removeOnFail:** Always set these on BullMQ workers. A queue doing 2,000 PPTs/day will exhaust Redis memory within days if completed jobs are not purged.
   ```
   removeOnComplete: { count: 500, age: 86400 }  // keep last 500 or last 24h
   removeOnFail: { count: 100 }
   ```

7. **Worker concurrency:** Start with `concurrency: 3`. Each job takes 10-15s and is mostly I/O-bound (LLM call + file write). Three concurrent jobs per worker instance is safe without overwhelming the LLM rate limits.

8. **Environment variables required:**
   ```
   ANTHROPIC_API_KEY
   REDIS_URL
   R2_ACCOUNT_ID
   R2_ACCESS_KEY_ID
   R2_SECRET_ACCESS_KEY
   R2_BUCKET_NAME
   ```

---

## Failure Modes and How the System Handles Them

| Failure | System Behavior | Teacher Experience |
|---|---|---|
| LLM 503 (transient) | BullMQ retries with backoff | "Still generating..." (no error) |
| LLM 503 (sustained) | Escalates to Sonnet after 3 Haiku failures | Slight delay, same quality output |
| Both models down | Job marked failed after all retries | Email notification + "Try again" button |
| Redis down | API falls back to sync LLM call (no queue) | Slower, but still works |
| Worker crash | BullMQ moves active job back to waiting on reconnect | Job reprocessed automatically |
| R2/S3 down | PPTX write fails, job retried | Transparent retry |
| Bad LLM JSON output | Worker catches JSON parse error, retries with explicit format reminder in prompt | Transparent retry |

The only scenario where the teacher sees an error is if both LLMs are down simultaneously for an extended period — a genuine infrastructure outage, not a transient failure.

---

## What This Document Does Not Cover (and Why)

**Authentication/authorization:** Out of scope for PPT generation. Assumed to exist in Savra's current system.

**WebSockets for live updates:** The polling approach (GET every 3s) is sufficient and simpler to implement, debug, and scale. Revisit if teachers complain about the UI feeling unresponsive.

**Multi-tenant isolation:** At 10K users, a single queue is fine. At 50K users, consider per-school queues with priority scheduling so one school's bulk generation doesn't starve another's real-time requests.

**PPTX to PDF conversion:** The assignment brief mentions PDF download as an option. At scale, run LibreOffice in a separate container as a conversion service. Do not run it in the same process as the PPT worker — LibreOffice is memory-heavy and its process model does not play well with Node.js.

---

*This document is complete for use as an implementation brief. The prototype uses Anthropic, but the assignment permits any LLM provider and the production design should route across providers.*
