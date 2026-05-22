# Changelog

## 2026-05-22 (session 5) — Review layout preview, quiz slides, Populate API

### Added

- **Slide layout preview (Review step)** — [`frontend/src/components/SlidePreview.tsx`](frontend/src/components/SlidePreview.tsx): 16:9 CSS previews for all six `slideType`s (Savra purple/cyan palette), synced with active slide in [`OutlineEditor.tsx`](frontend/src/components/OutlineEditor.tsx).
- **Quiz slide type** — `quiz` in shared types + [`packages/shared/quiz.ts`](packages/shared/quiz.ts); dedicated MCQ card layout in [`backend/worker/src/pptx-builder.ts`](backend/worker/src/pptx-builder.ts).
- **Per-slide Populate API** — `POST /api/ppt/slide/populate` ([`backend/api/src/lib/populate-slide.ts`](backend/api/src/lib/populate-slide.ts), [`llm-populate.ts`](backend/api/src/lib/llm-populate.ts)): intent + format + deck context fills a single slide.
- **PPTX layout polish** — improved styling for two-column, bullet-list, content-with-image, quote-or-definition, and quiz decks.

### Changed

- Review UI: split editor + sticky preview column; step label **Review & preview**; wider workspace in review mode.
- Populate UX: format chips (Quiz / Discussion / Definition / Visual) set layout only; teacher intent text is preserved.
- Redis `docker-compose`: `maxmemory-policy noeviction` (queue/cache safety).
- Root `npm run dev` runs `predev` → builds `@savra/shared` before API/worker start.

### Verified

- `frontend`: `npm run build`
- `backend/api`: `npm test`, `npm run build`
- `backend/worker`: `npm run build`

---

## 2026-05-22 (session 4) — Submission polish + resilient outline fallback

### Added

- **Provider-failure outline fallback** — `POST /api/ppt/outline` now returns an editable `template-fallback` draft if the configured LLM provider fails, so teachers are not blocked before async export.
- **Apple-style workspace UI** — frontend now uses a simple sidebar workflow, clean form canvas, compact controls, and provider-neutral pipeline copy.
- **Provider-failure export fallback** — direct `/generate` jobs now render a deterministic `template-fallback` PPTX if providers fail.
- **Redis-backed rate limit and dedupe** — API coordination no longer depends on per-process memory.
- **Storage adapter** — worker output now flows through local/R2-compatible storage while keeping the same download route.
- **Shared runtime helpers** — request normalization, cache keys, outline fallback, validation, and storage helpers are centralized under `packages/shared`.

### Changed

- Provider-specific docs were softened: OpenAI and Anthropic are prototype adapters; production should route across providers.
- Cost wording now says approved-outline export uses **0 additional LLM tokens after draft approval**, not that the whole PPT broadly costs zero tokens.
- Template fallback drafts/decks are not written to the normal content cache, avoiding stale fallback content after a temporary provider outage.
- Documentation now calls out the remaining provider-adapter duplication and the shared helpers already extracted.

### Verified

- `backend/api`: `npm test` (9 tests), `npm run build`
- `backend/worker`: `npm run build`
- `frontend`: `npm run build`
- `git diff --check`
- Safari smoke check at `http://127.0.0.1:5173/`

---

## 2026-05-22 (session 3) — Assignment folder layout + Mermaid diagram

### Changed

- Moved `apps/api` -> `backend/api`, `apps/worker` -> `backend/worker` (matches the assignment layout).
- Added [`architecture/diagram.md`](architecture/diagram.md) — Mermaid flowchart, sequence, and cache diagrams (replaces `diagram.png` requirement for GitHub-native viewing).
- Updated root `package.json`, README, DECISIONS, and design-doc paths.

---

## 2026-05-22 (session 2) — Curriculum UX, caching, dev ergonomics

### Added

- **CBSE / NCERT chapter catalog** ([`backend/api/src/lib/cbse-chapters.ts`](backend/api/src/lib/cbse-chapters.ts)) — chapter names for classes 6–12 across Science, Mathematics, Physics, Chemistry, Biology, Social Science, History, Geography, English, Hindi, Computer Science, Economics, and Political Science.
- **`GET /api/ppt/chapters`** — returns merged CBSE seed + teacher-submitted chapters from Redis.
- **Class → subject → chapter form UX** — dropdown chapter picker with “Other (type manually)” fallback.
- **L2 semantic cache (assignment bonus)** — OpenAI `text-embedding-3-small`, cosine similarity (threshold 0.92), grade+subject gate; logs hits and estimated ₹ saved via `/api/ppt/stats`.
- **Unified L1 content cache** on `POST /api/ppt/outline` and worker generate path — key: `ppt:content:l1:{hash(class|subject|chapter|slides)}`.
- **Slide editor controls** — add slide below (between slides) and delete slide (3–25 slides) on the review screen.
- **Root `npm run dev`** — starts API, worker, and frontend via `concurrently`.
- **`.env` loading** — API and worker load repo-root `.env` automatically ([`load-env.ts`](backend/api/src/load-env.ts), worker equivalent).
- **API LLM module** ([`backend/api/src/lib/llm.ts`](backend/api/src/lib/llm.ts)) — outline step can call OpenAI/Anthropic synchronously (not only worker).
- Tests: semantic cosine similarity; outline tests updated for `chapter` field.

### Changed

- Renamed request field **`topic` → `chapter`** (API accepts `topic` as deprecated alias).
- Outline resolution order: **L1 exact → L2 semantic → LLM → template (mock)**.
- [`backend/api/src/lib/cache.ts`](backend/api/src/lib/cache.ts) — canonical cache layer; worker uses matching Redis keys via [`content-cache.ts`](backend/worker/src/lib/content-cache.ts).
- Vite proxy error returns JSON hint when API is not running.
- README, DECISIONS, design-doc, and Excalidraw brief aligned with the assignment.

### Fixed

- `ECONNREFUSED` on `/api/ppt/outline` when only frontend was started — documented and fixed via `npm run dev` from repo root.

---

## 2026-05-22 (session 1) — Outline-first pipeline

### Added

- Outline-first teacher workflow: editable slide draft before final PPTX export.
- `POST /api/ppt/outline` for slide-level draft generation.
- Approved slide content in `POST /api/ppt/generate`; worker renders with **0 additional LLM tokens after draft approval**.
- Editable slide review UI (type, title, content, teacher notes).
- API tests for outline, validation, and approved-content cache keys.
- Excalidraw-ready architecture brief.

### Changed

- Frontend visual style: Mac/iOS-inspired professional UI (replaced dark/purple demo).
- Architecture narrative: outline-first + async export (not queue-only).
- README cost math corrected for 43K PPTs/month × ₹15/PPT.

### Verified

- `backend/api`: `npm run build`, `npm test` (6 tests)
- `backend/worker`: `npm run build`
- `frontend`: `npm run build`
