# Backend

Assignment `backend/` folder. Two processes:

| Package | Role |
|---------|------|
| [`api/`](api/) | Fastify HTTP server — outline, generate, job status, download, cache stats |
| [`worker/`](worker/) | BullMQ consumer — PPTX build, L1/L2 cache on generate path |

From repo root: `npm run dev` starts both with the frontend.
