# Key Architecture Decisions

This document explains the **why** behind every significant technical choice.

---

## 1. Async-First Over Synchronous Processing

**Decision:** All PPT generation is processed asynchronously via a job queue.

**Why:** The synchronous model is the root cause of all three pain points (cost, latency, reliability). A teacher submitting a form should never block on a 30-second LLM call. The async model returns a `jobId` in <100ms, and the teacher polls for status. This decouples the teacher's experience from LLM availability entirely.

**Trade-off:** The teacher doesn't get instant results. We mitigate this with a clear progress UI (step indicators, estimated time) and fast polling (every 3 seconds).

**Alternative considered:** WebSockets for real-time push. Rejected because polling is simpler to debug, deploy, and scale. At the current volume, 5 polls per job is negligible overhead. WebSockets add connection management complexity for no meaningful UX gain.

---

## 1A. Outline-First Over Forced One-Shot Generation

**Decision:** Add a fast editable slide-outline step before final PPTX export.

**Why:** The assignment does not require generation to be one-shot. Teachers get better output when they can inspect slide titles, bullets, examples, and speaker notes before the expensive final artifact is created. This also makes the product feel faster: the teacher sees useful content immediately instead of waiting behind a spinner.

**Cost impact:** If the teacher accepts or edits the outline, the final worker job renders the approved structured JSON directly with pptxgenjs and uses 0 additional LLM tokens after the draft.

**Trade-off:** The flow has one extra interaction. This is intentional for quality-sensitive classroom content. A one-click path can still submit directly to `/api/ppt/generate`.

---

## 2. Provider-Agnostic LLM Router

**Decision:** Keep content generation behind a provider-agnostic adapter. The prototype supports OpenAI, Anthropic, and mock mode.

**Assignment check:** The assignment says “Integration with any LLM of your choice,” so no single vendor is required. OpenAI, Gemini, Anthropic, or an open-source model would all satisfy the requirement.

**Why:** PPT content generation is a structured output task. The important design choice is not the vendor; it is keeping the LLM responsible for concise pedagogical JSON while templates handle layout.

**Future routing:** Production should extract the API and worker adapters into a shared package and choose provider/model based on latency, cost, quality, and provider health.

---

## 3. Fastify Over Express

**Decision:** Use Fastify instead of Express for the API server.

**Why:** Fastify provides 2-5× higher throughput than Express in benchmarks. More importantly, it has built-in JSON schema validation, which means we validate request bodies (chapter, grade, subject, numSlides) at the framework level — no additional middleware needed. The pino-based logging is also superior.

**Trade-off:** Smaller ecosystem than Express. But for an API server with 4 routes, the Express middleware ecosystem is irrelevant.

---

## 4. Template-First Generation (Separate Content from Layout)

**Decision:** The LLM generates only structured JSON content. Layout is handled by pptxgenjs with pre-defined templates.

**Why:** This is the highest-leverage cost reduction. The previous system likely had the LLM generate layout instructions, color suggestions, and positioning — all of which are wasted tokens. By defining 5 fixed templates in code and having the LLM output only `{ slideType, title, bullets, bodyText }`, we cut output tokens by 60-70%.

**Trade-off:** Less variety in slide design. Mitigated by having 6 distinct layouts (including quiz) and mixing them within each deck.

---

## 5. Two-Layer Caching (L1 Exact + L2 Semantic)

**Decision:** Implement L1 exact-match caching on `class|subject|chapter|slides`, plus L2 semantic similarity via OpenAI `text-embedding-3-small` and cosine search in Redis (prototype: brute-force over ≤5K index entries).

**Why:** L1 is trivial to implement (30 minutes of work) and catches 15-30% of requests — teachers commonly regenerate the same topic. L2 semantic caching catches another 15-25% (e.g., "Class 8 Photosynthesis" vs "Grade 8 Photosynthesis"), but requires embeddings and vector search. Building L1 first gives immediate ROI.

**Implementation note:** We cache the *JSON content*, not the PPTX file. Rebuilding PPTX from JSON takes ~1 second with pptxgenjs and costs nothing. This keeps cache storage small.

**L2 prototype:** OpenAI embeddings stored in Redis; brute-force cosine over an index (≤5K entries). Same `grade` + `subject` required before similarity match. Threshold 0.92 (stricter when slide counts differ). Stats exposed on `GET /api/ppt/stats`.

**Production path:** RediSearch vector KNN when the index grows; same payload format.

---

## 5A. CBSE Chapter Catalog (Indian Market UX)

**Decision:** Form order is **class → subject → chapter**. Chapter names come from a static NCERT-aligned catalog ([`cbse-chapters.ts`](backend/api/src/lib/cbse-chapters.ts)), merged with teacher-entered chapters in Redis.

**Why:** Savra serves Indian schools; teachers do not think in anonymous “topics.” CBSE textbooks change slowly — shipping chapter lists improves dropdown UX, cache key stability, and demo credibility. `GET /api/ppt/chapters` powers the frontend select; “Other chapter” remains for edge cases.

**Trade-off:** Catalog maintenance over time (annual NCERT refresh). Acceptable for hackathon; production would sync from Savra’s curriculum DB.

---

## 5B. Slide Add/Delete on Review Screen

**Decision:** Teachers can insert or remove slides on the outline review page (min 3, max 25).

**Why:** Assignment asks for quality without mandating one-shot generation. Slide-level control matches how teachers actually fix decks. Final validation runs on the edited `presentation` JSON, not the original slide count alone.

---

## 5C. Layout Preview Before Export (Not Post-Export Editing)

**Decision:** Step 2 (Review) shows a **16:9 CSS layout preview** beside the editable slide list. Teachers do not get a full WYSIWYG editor after PPTX download.

**Why:** The assignment allows “HTML slide preview” and template injection — previewing layout before export catches pedagogy and structure issues without building a second editing surface on binary PPTX files. The preview mirrors pptxgenjs templates (title, bullets, quiz cards, two-column, visual, quote) so teachers see approximate styling before async export.

**Trade-off:** Preview is approximate (CSS, not PowerPoint rendering). Good enough for hackathon; production could use Savra’s HTML renderer or thumbnail generation.

---

## 5D. Per-Slide Populate (`POST /api/ppt/slide/populate`)

**Decision:** Teachers describe intent for one slide (e.g. “MCQ on coal between slides 3 and 4”), pick a format (Quiz / Discussion / Definition / Visual), and the API fills that slide using the full deck as context.

**Why:** Inserting a blank slide between existing content is a common classroom workflow. One-slide LLM calls are cheaper than regenerating the whole deck and keep surrounding slides coherent.

**Trade-off:** Extra API surface and LLM call per populate. Format chips only set `slideType` / activity role — intent text stays teacher-authored to avoid overwriting their wording.

---

## 5E. Dedicated Quiz Slide Type

**Decision:** `slideType: "quiz"` with `quizQuestions[]` (structured MCQ) and a dedicated pptxgenjs layout (Q badges, A/B/C option rows).

**Why:** Quiz content in a plain bullet-list produced unreadable PPTX. Structured quiz JSON + template layout matches classroom MCQ decks and keeps LLM output token-efficient.

**Legacy:** Bullet-list slides with quiz-like titles still route to the quiz layout when parsed MCQ content is detected.

---

## 6. BullMQ Over Celery / Inngest / Simple Polling

**Decision:** Use BullMQ (Redis-backed) for the job queue.

**Why:** The entire stack is Node.js (Fastify API + pptxgenjs). BullMQ is the standard Node.js job queue — TypeScript-native, supports retries with exponential backoff, job progress tracking, dead letter queues, and configurable concurrency. All of these are needed for this use case.

**Alternative considered:** Celery (Python). Would require running a separate Python worker, cross-language serialization, and gives up pptxgenjs (would need python-pptx instead). No benefit for this use case.

**Alternative considered:** Inngest (serverless). Elegant model, but adds a vendor dependency and removes control over job scheduling. BullMQ gives full visibility into queue depth, processing time, and failure rates.

---

## 7. Request Deduplication

**Decision:** If the same request (same chapter + grade + subject + numSlides, or same approved presentation hash) is submitted within 30 seconds, return the existing jobId instead of creating a new job.

**Why:** Teachers double-click. Form resubmissions happen. Without deduplication, each click creates a new LLM call. With deduplication, the second click is free and returns instantly.

---

## 8. Worker as Separate Process

**Decision:** The BullMQ worker runs as a separate Node.js process from the Fastify API server.

**Why:** Worker isolation. If the worker crashes (out of memory, LLM timeout, pptxgenjs error), the API server continues accepting new requests. In production, this means two separate Railway/Render services. Workers can be scaled independently of the API — if the queue backs up, add more workers without touching the API.

---

## 9. Rate Limiting (10 req/min per client)

**Decision:** Implement a simple in-memory rate limiter (10 requests per minute per IP).

**Why:** Without rate limiting, a single rogue client or script could fill the queue and exhaust LLM rate limits. At 10 req/min, a teacher can generate freely (no one generates 10 PPTs per minute), but automated abuse is blocked.

**Implementation:** Rate limiting now uses Redis `INCR` + TTL keys, so multiple API instances share the same limit window. The in-memory prototype map was removed.

---

## 9A. Redis-Backed Request Deduplication

**Decision:** Store short-lived dedupe reservations in Redis instead of process memory.

**Why:** Multiple API instances must agree that a duplicate request should reuse the first `jobId`. Redis `SET NX EX` gives atomic reservation and a 30-second expiry without adding another database.

**Failure behavior:** If queue insertion fails after reserving a dedupe key, the API releases the reservation so the teacher can retry immediately.

---

## 9B. Storage Adapter Over Hard-Coded Local Disk

**Decision:** Keep local disk as the default demo driver, but route completed PPTX files through a storage adapter that can upload to Cloudflare R2.

**Why:** Local disk is fine for a single-machine prototype. Multi-worker production needs object storage so any API instance can serve a download.

**Trade-off:** R2 requires four environment variables. The public download route remains unchanged.

---

## 10. What I Skipped (and Why)

| Skipped | Why |
|---------|-----|
| **WebSockets** | Polling every 3s is sufficient. WebSockets add deployment complexity. |
| **PostgreSQL database** | Not needed for the prototype. Job state lives in Redis (via BullMQ). Add PostgreSQL for user/teacher/school models in a full system. |
| **PDF download** | Requires LibreOffice headless in a separate container. Out of scope for a prototype. |
| **RediSearch KNN** | L2 implemented with brute-force cosine; vector index at scale. |
| **Authentication** | Assumed to exist in Savra's current system. Not relevant to PPT generation redesign. |
| **PPTX-to-PDF conversion** | Assignment mentions PDF; LibreOffice sidecar out of scope for prototype. |

---

## 11. Repository Layout (Assignment §05)

**Decision:** `backend/api` + `backend/worker` + `frontend/` — matches assignment `backend/` and `frontend/` folders.

**Why:** Worker stays a separate Node process under `backend/worker` for isolation and independent scale. HTTP API lives in `backend/api`. System diagram is Mermaid in [`architecture/diagram.md`](architecture/diagram.md) (renders on GitHub without a PNG export step).
