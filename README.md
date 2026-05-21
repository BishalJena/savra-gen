# SAVRA PPT Generator — Async, Cost-Optimized, Scalable

A redesigned PPT generation system for [Savra](https://savraedu.com) that reduces cost by **97%** (₹15 → ₹0.47/PPT), handles **10× the volume**, and **never shows the teacher a 503 error**.

## What I Built

- ✅ **Async job queue** (BullMQ + Redis) — teacher submits form, gets `jobId` in <100ms, polls for completion
- ✅ **Template-first generation** — LLM produces structured JSON, pptxgenjs builds slides from 5 pre-designed templates
- ✅ **Smart model routing** — Claude Haiku 4.5 (primary, cheap) → Claude Sonnet 4.6 (fallback, reliable)
- ✅ **Prompt caching** — system prompt cached via Anthropic's `cache_control: ephemeral` (90% input cost savings)
- ✅ **L1 exact-match cache** — SHA-256 hash of normalized requests, 7-day TTL, sub-millisecond lookups
- ✅ **Request deduplication** — double-clicks return the same `jobId`, no duplicate LLM calls
- ✅ **Rate limiting** — 10 requests/minute per client
- ✅ **Real PPTX output** — downloadable .pptx files with professional styling and speaker notes
- ✅ **Progress UI** — step-by-step progress bar, slide preview, cost/token metrics display

## What I Skipped

| Feature | Why |
|---------|-----|
| L2 Semantic Cache | Described in architecture doc. L1 is sufficient for prototype. |
| WebSockets | Polling is simpler and sufficient at this scale. |
| PostgreSQL | Job state lives in Redis. DB needed only for full user/school models. |
| PDF Download | Requires LibreOffice in a separate container — out of scope. |
| Auth | Assumed existing in Savra's system. |

## Architecture

```
Teacher → Fastify API → BullMQ Queue (Redis) → Worker → Claude Haiku 4.5 → pptxgenjs → .PPTX
  ↑                                                  ↓
  └── polls /job/:id ← Redis job status ←── Job complete
```

The worker checks L1 cache before calling the LLM. On cache hit, it rebuilds the PPTX from stored JSON (~1s, $0).

## Cost Math

| Scenario | Cost/PPT | Monthly (43K PPTs) |
|----------|:--------:|:------------------:|
| Current system | ₹15.00 | ₹45,000 |
| New system (no cache) | ₹0.86 | ₹37,267 |
| **New system (45% cache)** | **₹0.47** | **₹20,366** |
| New + Batch API | ₹0.24 | ₹10,400 |

## Tech Stack

| Layer | Choice | Justification |
|-------|--------|---------------|
| API | Fastify | 2-5× Express throughput, built-in schema validation |
| Queue | BullMQ + Redis | TypeScript-native, retries, progress tracking |
| LLM | Claude Haiku 4.5 | $1/$5 MTok, fast, sufficient for structured JSON |
| PPTX | pptxgenjs | JS-native, no LibreOffice dependency |
| Frontend | React + Vite | Polling-based status UI |
| Cache | Redis | L1 exact-match, shared with BullMQ |

## Running Locally

### Prerequisites
- Node.js 20+
- Docker (for Redis) OR a local Redis instance
- An Anthropic API key (optional — runs in mock mode without one)

### Steps

```bash
# 1. Start Redis
docker compose up -d

# 2. Install dependencies
cd apps/api && npm install
cd ../worker && npm install
cd ../../frontend && npm install

# 3. Set env vars (optional — mock mode works without)
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Start the services (3 terminals)
cd apps/api && npm run dev       # API on :3001
cd apps/worker && npm run dev    # Worker process
cd frontend && npm run dev       # Frontend on :5173
```

Visit **http://localhost:5173** to generate presentations.

### Mock Mode

If no `ANTHROPIC_API_KEY` is set, the worker uses realistic mock data — the full pipeline runs (queue → worker → pptx build → download) but without LLM calls. This lets you test the entire architecture without incurring API costs.

## Assumptions

1. Teacher authentication exists in Savra's current system and is not in scope for this prototype
2. The 5 slide layout templates (title, bullet-list, two-column, content-with-image, quote) cover the majority of use cases
3. Cache TTL of 7 days is appropriate — curriculum content doesn't change frequently
4. 45% cache hit rate is achievable based on EdTech production data — teachers commonly generate similar topics
5. Anthropic's pricing and prompt caching behavior as of May 2026 is stable
