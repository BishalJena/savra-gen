# Key Architecture Decisions

This document explains the **why** behind every significant technical choice.

---

## 1. Async-First Over Synchronous Processing

**Decision:** All PPT generation is processed asynchronously via a job queue.

**Why:** The synchronous model is the root cause of all three pain points (cost, latency, reliability). A teacher submitting a form should never block on a 30-second LLM call. The async model returns a `jobId` in <100ms, and the teacher polls for status. This decouples the teacher's experience from LLM availability entirely.

**Trade-off:** The teacher doesn't get instant results. We mitigate this with a clear progress UI (step indicators, estimated time) and fast polling (every 3 seconds).

**Alternative considered:** WebSockets for real-time push. Rejected because polling is simpler to debug, deploy, and scale. At the current volume, 5 polls per job is negligible overhead. WebSockets add connection management complexity for no meaningful UX gain.

---

## 2. Claude Haiku 4.5 as Primary Model (Not Sonnet or GPT-4)

**Decision:** Use Claude Haiku 4.5 ($1/$5 per MTok) as the primary generation model.

**Why:** PPT content generation is a structured output task — it doesn't require deep reasoning or chain-of-thought. Haiku handles "generate 10 slides about Photosynthesis as JSON" extremely well. The content quality difference between Haiku and Sonnet for this task type is negligible.

**Cost impact:** Haiku is 3× cheaper on input and 3× cheaper on output vs. Sonnet. At 43K PPTs/month, this saves ~₹50,000/month.

**Fallback:** Sonnet 4.6 is the fallback, not a degraded model. If Haiku returns 503s, we escalate to Sonnet, which is *more* reliable (higher rate limits). The teacher gets the same quality; we just pay 3× more for that one request.

---

## 3. Fastify Over Express

**Decision:** Use Fastify instead of Express for the API server.

**Why:** Fastify provides 2-5× higher throughput than Express in benchmarks. More importantly, it has built-in JSON schema validation, which means we validate request bodies (topic, grade, numSlides) at the framework level — no additional middleware needed. The pino-based logging is also superior.

**Trade-off:** Smaller ecosystem than Express. But for an API server with 4 routes, the Express middleware ecosystem is irrelevant.

---

## 4. Template-First Generation (Separate Content from Layout)

**Decision:** The LLM generates only structured JSON content. Layout is handled by pptxgenjs with pre-defined templates.

**Why:** This is the highest-leverage cost reduction. The previous system likely had the LLM generate layout instructions, color suggestions, and positioning — all of which are wasted tokens. By defining 5 fixed templates in code and having the LLM output only `{ slideType, title, bullets, bodyText }`, we cut output tokens by 60-70%.

**Trade-off:** Less variety in slide design. Mitigated by having 5 distinct layouts and mixing them within each deck.

---

## 5. Two-Layer Caching (L1 Exact + L2 Semantic)

**Decision:** Implement L1 exact-match caching first (Redis hash), with L2 semantic caching as a later optimization.

**Why:** L1 is trivial to implement (30 minutes of work) and catches 15-30% of requests — teachers commonly regenerate the same topic. L2 semantic caching catches another 15-25% (e.g., "Class 8 Photosynthesis" vs "Grade 8 Photosynthesis"), but requires embeddings and vector search. Building L1 first gives immediate ROI.

**Implementation note:** We cache the *JSON content*, not the PPTX file. Rebuilding PPTX from JSON takes ~1 second with pptxgenjs and costs nothing. This keeps cache storage small.

---

## 6. BullMQ Over Celery / Inngest / Simple Polling

**Decision:** Use BullMQ (Redis-backed) for the job queue.

**Why:** The entire stack is Node.js (Fastify API + pptxgenjs). BullMQ is the standard Node.js job queue — TypeScript-native, supports retries with exponential backoff, job progress tracking, dead letter queues, and configurable concurrency. All of these are needed for this use case.

**Alternative considered:** Celery (Python). Would require running a separate Python worker, cross-language serialization, and gives up pptxgenjs (would need python-pptx instead). No benefit for this use case.

**Alternative considered:** Inngest (serverless). Elegant model, but adds a vendor dependency and removes control over job scheduling. BullMQ gives full visibility into queue depth, processing time, and failure rates.

---

## 7. Request Deduplication

**Decision:** If the same request (same topic + grade + subject + numSlides) is submitted within 30 seconds, return the existing jobId instead of creating a new job.

**Why:** Teachers double-click. Form resubmissions happen. Without deduplication, each click creates a new LLM call. With deduplication, the second click is free and returns instantly.

---

## 8. Worker as Separate Process

**Decision:** The BullMQ worker runs as a separate Node.js process from the Fastify API server.

**Why:** Worker isolation. If the worker crashes (out of memory, LLM timeout, pptxgenjs error), the API server continues accepting new requests. In production, this means two separate Railway/Render services. Workers can be scaled independently of the API — if the queue backs up, add more workers without touching the API.

---

## 9. Rate Limiting (10 req/min per client)

**Decision:** Implement a simple in-memory rate limiter (10 requests per minute per IP).

**Why:** Without rate limiting, a single rogue client or script could fill the queue and exhaust LLM rate limits. At 10 req/min, a teacher can generate freely (no one generates 10 PPTs per minute), but automated abuse is blocked.

**Future:** Move to Redis-based sliding window rate limiting when multi-instance deployment requires shared state.

---

## 10. What I Skipped (and Why)

| Skipped | Why |
|---------|-----|
| **WebSockets** | Polling every 3s is sufficient. WebSockets add deployment complexity. |
| **PostgreSQL database** | Not needed for the prototype. Job state lives in Redis (via BullMQ). Add PostgreSQL for user/teacher/school models in a full system. |
| **PDF download** | Requires LibreOffice headless in a separate container. Out of scope for a prototype. |
| **L2 semantic cache** | Described in the architecture doc. L1 is sufficient for the prototype demo. |
| **Authentication** | Assumed to exist in Savra's current system. Not relevant to PPT generation redesign. |
| **PPTX-to-PDF conversion** | LibreOffice is heavy and memory-intensive. Document this as a future service. |
