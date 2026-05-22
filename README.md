# SAVRA PPT Generator — Async, Cost-Optimized, Scalable

A redesigned PPT generation system for [Savra](https://savraedu.com) that moves PPT creation from a blocked one-shot request into an **outline-first, async export pipeline**. Built for the Full-Stack Engineering Assignment: cheaper, faster, more reliable, ready for 10x scale.

Teachers pick **class → subject → CBSE chapter**, review editable slides with a **layout preview** (add/delete, per-slide Populate), then export PPTX asynchronously. Approved outlines and cache hits avoid repeat LLM spend.

## Repository structure (assignment §05)

```
├── architecture/
│   ├── design-doc.md      # Part 1
│   └── diagram.md         # Mermaid system diagram
├── backend/
│   ├── api/               # Fastify HTTP server
│   └── worker/            # BullMQ PPTX worker
├── frontend/              # React UI (Draft → Review & preview → Export)
├── packages/shared/       # Shared types, quiz helpers, storage adapter
├── DECISIONS.md
└── README.md
```

## What I Built

- ✅ **Async job queue** (BullMQ + Redis) — teacher submits form, gets `jobId` in <100ms, polls for completion
- ✅ **Editable outline step** — teacher reviews slide-level content before final PPTX generation
- ✅ **Layout preview in Review** — 16:9 CSS preview mirrors exported PPTX templates (title, bullets, quiz cards, two-column, visual, quote) before export
- ✅ **Template-first generation** — LLM produces structured JSON, pptxgenjs builds slides from 6 pre-designed templates (including dedicated quiz layout)
- ✅ **Provider-swappable LLM layer** — prototype supports OpenAI, Anthropic, and mock mode; production can route across Gemini or open-source models too
- ✅ **Prompt caching ready** — provider adapters can use prompt/context caching where supported
- ✅ **L1 exact-match cache** — SHA-256 hash of `class|subject|chapter|slides`, 7-day TTL
- ✅ **L2 semantic cache (bonus)** — OpenAI embeddings catch similar phrasing (e.g. “Class 8 Photosynthesis” ≈ “Grade 8 photosynthesis presentation”)
- ✅ **Provider-failure outline fallback** — if the LLM fails during `/outline`, the teacher still gets an editable template draft
- ✅ **Provider-failure export fallback** — direct `/generate` renders a template PPTX if providers fail after retries
- ✅ **CBSE chapter catalog** — NCERT-aligned chapter names for classes 6–12 (Science, Math, Social Science, and more); class → subject → chapter dropdown
- ✅ **Slide editor** — Add or delete slides between any slide on the review screen (3–25 slides)
- ✅ **Per-slide Populate** — `POST /api/ppt/slide/populate`: describe intent (e.g. quiz between slides 3–4); AI fills one slide using full deck context + format (Quiz / Discussion / Definition / Visual)
- ✅ **Redis-backed request deduplication** — double-clicks return the same `jobId`, no duplicate LLM calls across API instances
- ✅ **Redis-backed rate limiting** — 10 requests/minute per client across API instances
- ✅ **Real PPTX output** — downloadable .pptx files with professional styling and speaker notes
- ✅ **Storage adapter** — local disk for demo, Cloudflare R2-compatible upload for production
- ✅ **Progress UI** — three-step sidebar (Draft → Review & preview → Export), job polling, cost/token metrics on export

## What I Skipped

| Feature | Why |
|---------|-----|
| RediSearch KNN at scale | L2 uses brute-force cosine over Redis index (≤5K entries); migrate to RediSearch for 10K+ |
| WebSockets | Polling is simpler and sufficient at this scale. |
| PostgreSQL | Job state lives in Redis. DB needed only for full user/school models. |
| PDF Download | Requires LibreOffice in a separate container — out of scope. |
| Auth | Assumed existing in Savra's system. |
| Full LLM package extraction | Shared helpers live in `@savra/shared`; OpenAI/Anthropic adapters remain in api/worker for now. |

## Assignment mapping

| Assignment requirement | Where it lives |
|------------------------|----------------|
| Part 1 — Architecture doc | [`architecture/design-doc.md`](architecture/design-doc.md), [`architecture/diagram.md`](architecture/diagram.md) |
| Part 2 — Working prototype | [`backend/`](backend/) + [`frontend/`](frontend/) |
| System diagram | [`architecture/diagram.md`](architecture/diagram.md) (Mermaid) |
| Async queue + polling | BullMQ + `GET /api/ppt/job/:id` |
| LLM integration (any provider) | OpenAI + Anthropic + mock ([`backend/api/src/lib/llm.ts`](backend/api/src/lib/llm.ts)) |
| Meaningful optimization | L1 + L2 cache, outline-first export with 0 additional LLM tokens, Redis dedupe/rate limit, layout preview before export |
| Bonus — semantic cache | [`backend/api/src/lib/semantic-cache.ts`](backend/api/src/lib/semantic-cache.ts) |
| Decisions + rationale | [`DECISIONS.md`](DECISIONS.md) |

**Repo layout:** `backend/api` (HTTP) + `backend/worker` (queue) match assignment `backend/` + separate worker process for isolation.

## Architecture

```
Teacher → class / subject / chapter → POST /outline → L1 → L2 → LLM or template fallback → editable draft
Teacher edits + layout preview (add/delete, Populate per slide) → POST /generate → BullMQ Worker → pptxgenjs → .PPTX
  ↑                                                              ↓
  └──────────── polls /job/:id ← Redis ←─────────────────────────┘
```

The one-shot path still exists, but the preferred flow is outline-first. If the teacher approves or edits the draft, the worker renders the approved structured content directly, so final export uses **0 additional LLM tokens after the draft**.

## Cost Math

| Scenario | Cost/PPT | Monthly (43K PPTs) |
|----------|:--------:|:------------------:|
| Current system | ₹15.00 | ₹6,45,000 |
| New system (no cache) | ₹0.86 | ₹37,267 |
| **New system (~45% L1+L2 cache)** | **~₹0.47** | **~₹20,366** |
| New + approved outlines (~50% zero-additional-token export) | lower still | **~₹11,000** (see design-doc) |
| New + Batch API (future) | ₹0.24 | ₹10,400 |

**Bonus assumptions (10K users, 50% teachers, 2 PPTs/week):** ~43,333 PPTs/month. See [`architecture/design-doc.md`](architecture/design-doc.md) for the full table.

Approved export uses **0 additional LLM tokens after the draft is approved**. First draft per chapter may call the LLM once; repeats hit L1 or L2 cache.

## Tech Stack

| Layer | Choice | Justification |
|-------|--------|---------------|
| API | Fastify | 2-5× Express throughput, built-in schema validation |
| Queue | BullMQ + Redis | TypeScript-native, retries, progress tracking |
| LLM | OpenAI (`gpt-4o-mini` default) + Anthropic fallback | Assignment allows any provider; OpenAI also powers L2 embeddings |
| PPTX | pptxgenjs | JS-native, no LibreOffice dependency |
| Frontend | React + Vite | Polling-based status UI |
| Cache / coordination | Redis | L1 exact, L2 semantic index, BullMQ, rate limits, dedupe |
| Storage | Local / Cloudflare R2 | Local by default; R2-compatible adapter for multi-worker production |
| Curriculum | `cbse-chapters.ts` | NCERT-aligned chapter dropdowns |

## Running Locally

### Prerequisites
- Node.js 20+
- Docker (for Redis) OR a local Redis instance
- An OpenAI or Anthropic API key (optional — runs in mock mode without one; the assignment allows any LLM)

### Steps

```bash
# 1. Start Redis
docker compose up -d

# 2. Install dependencies
npm install
cd backend/api && npm install
cd ../worker && npm install
cd ../../frontend && npm install

# 3. LLM keys (optional — mock mode works without)
cp .env.example .env
# Edit .env: OPENAI_API_KEY enables LLM outlines + L2 semantic cache; ANTHROPIC works for chat without L2
# Optional production storage: set STORAGE_DRIVER=r2 plus R2_* variables.

# 4. Start all services (from repo root — required for /api proxy)
npm run dev   # builds @savra/shared, then API :3001, worker, frontend :5173

# Or use 3 terminals from repo root:
# cd backend/api && npm run dev
# cd backend/worker && npm run dev
# cd frontend && npm run dev
```

Visit **http://localhost:5173** to generate presentations.

### Mock Mode

If no `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set, the worker uses realistic mock data — the full pipeline runs (queue → worker → pptx build → download) but without LLM calls. This lets you test the entire architecture without incurring API costs.

## Assumptions

1. Teacher authentication exists in Savra's current system and is not in scope for this prototype
2. The 6 slide layout templates (title, bullet-list, quiz, two-column, content-with-image, quote-or-definition) cover the majority of classroom use cases
3. Cache TTL of 7 days is appropriate — curriculum content doesn't change frequently
4. 45% cache hit rate is achievable based on EdTech production data — teachers commonly generate similar topics
5. OpenAI and Anthropic are prototype adapters, not assignment requirements
