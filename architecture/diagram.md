# System Architecture Diagram

Mermaid source for the Savra PPT generation redesign. Renders in GitHub, VS Code, and most markdown viewers.

## Outline-first async pipeline

```mermaid
flowchart LR
  subgraph teacher [Teacher]
    Browser[Browser]
  end

  subgraph frontend [frontend]
    UI[React UI]
    Preview[Layout preview Review]
  end

  subgraph backend [backend]
    API[Fastify API]
    Worker[BullMQ Worker]
  end

  subgraph redis [Redis]
    Queue[BullMQ Queue]
    L1[L1 exact cache]
    L2[L2 semantic index]
    Chapters[Chapter catalog]
  end

  LLM[OpenAI / Anthropic]
  PPTX[pptxgenjs]

  Browser --> UI
  UI --> Preview
  UI -->|GET chapters| API
  UI -->|POST outline| API
  UI -->|POST slide populate| API
  API --> Chapters
  API --> L1
  API --> L2
  L2 -.->|on miss| LLM
  L1 -.->|on miss| LLM
  API -->|editable JSON| UI
  UI -->|POST generate + approved slides| API
  API -->|enqueue| Queue
  Queue --> Worker
  Worker --> L1
  Worker --> L2
  Worker -.->|cache miss, no approval| LLM
  Worker -->|approved path: 0 additional tokens| PPTX
  LLM -->|structured JSON| Worker
  Worker --> PPTX
  PPTX -->|download| UI
  UI -->|poll job status| API
```

## Request sequence (happy path)

```mermaid
sequenceDiagram
  participant T as Teacher
  participant UI as Frontend
  participant API as backend/api
  participant R as Redis
  participant W as backend/worker
  participant LLM as LLM

  T->>UI: Class, subject, chapter
  UI->>API: GET /api/ppt/chapters
  API->>R: SMEMBERS catalog
  API-->>UI: Chapter list

  UI->>API: POST /api/ppt/outline
  API->>R: L1 lookup
  alt L1 or L2 hit
    R-->>API: Cached slide JSON
  else cache miss
    API->>LLM: Generate content
    LLM-->>API: Slide JSON
    API->>R: L1 set + L2 index
  end
  API-->>UI: Editable presentation

  T->>UI: Edit slides, preview layout, optional Populate
  opt Per-slide Populate
    UI->>API: POST /api/ppt/slide/populate
    API->>LLM: Fill one slide
    LLM-->>API: Updated slide JSON
    API-->>UI: slide
  end
  UI->>API: POST /api/ppt/generate
  API-->>UI: jobId under 100ms

  API->>R: Enqueue job
  R->>W: Dequeue
  W->>W: Render approved JSON with pptxgenjs
  Note over W: 0 LLM tokens

  loop Poll every 3s
    UI->>API: GET /api/ppt/job/:id
    API-->>UI: progress / done
  end

  UI->>API: GET /api/ppt/download/:id
  API-->>T: .pptx file
```

## Cache layers

```mermaid
flowchart TD
  req[Request: class + subject + chapter + slides]
  l1{L1 exact hash hit?}
  l2{L2 cosine >= 0.92?}
  llm[LLM generate once]
  store[Store in L1 + L2 index]
  out[Return slide JSON]

  req --> l1
  l1 -->|yes| out
  l1 -->|no| l2
  l2 -->|yes| out
  l2 -->|no| llm
  llm --> store
  store --> out
```

## Before vs after

```mermaid
flowchart TB
  subgraph old [Current Savra]
    O1[Teacher waits on HTTP]
    O2[One LLM call]
    O3[PPTX or 503]
    O1 --> O2 --> O3
  end

  subgraph new [This redesign]
    N1[Fast outline + cache]
    N2[Teacher reviews + layout preview]
    N3[Async job + retries]
    N4[PPTX download]
    N1 --> N2 --> N3 --> N4
  end
```
