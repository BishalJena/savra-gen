# Changelog

## 2026-05-22 (session 3) — Assignment folder layout + Mermaid diagram

### Changed

- Moved `apps/api` → `backend/api`, `apps/worker` → `backend/worker` (matches [ASSIGNMENT.md](ASSIGNMENT.md) §05).
- Added [`architecture/diagram.md`](architecture/diagram.md) — Mermaid flowchart, sequence, and cache diagrams (replaces `diagram.png` requirement for GitHub-native viewing).
- Updated root `package.json`, README, DECISIONS, pitch script, and design-doc paths.

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
- README, DECISIONS, design-doc, Excalidraw brief, and pitch script aligned with [ASSIGNMENT.md](ASSIGNMENT.md).

### Fixed

- `ECONNREFUSED` on `/api/ppt/outline` when only frontend was started — documented and fixed via `npm run dev` from repo root.

---

## 2026-05-22 (session 1) — Outline-first pipeline

### Added

- Outline-first teacher workflow: editable slide draft before final PPTX export.
- `POST /api/ppt/outline` for slide-level draft generation.
- Approved slide content in `POST /api/ppt/generate`; worker renders with **0 LLM tokens**.
- Editable slide review UI (type, title, content, teacher notes).
- API tests for outline, validation, and approved-content cache keys.
- Excalidraw-ready architecture brief and pitch script.

### Changed

- Frontend visual style: Mac/iOS-inspired professional UI (replaced dark/purple demo).
- Architecture narrative: outline-first + async export (not queue-only).
- README cost math corrected for 43K PPTs/month × ₹15/PPT.

### Verified

- `backend/api`: `npm run build`, `npm test` (6 tests)
- `backend/worker`: `npm run build`
- `frontend`: `npm run build`
