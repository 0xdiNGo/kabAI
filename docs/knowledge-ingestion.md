# Knowledge Ingestion Engine

## Overview

The knowledge ingestion engine processes raw content (text, URLs, files, HuggingFace datasets) into searchable knowledge items that agents use to ground their responses. It supports plain text, HTML pages, IETF RFCs (with full lineage analysis), HuggingFace dataset import, and deep research mode that follows related links.

Retrieval uses a hybrid approach: vector similarity search (Qdrant) combined with MongoDB full-text search, with score fusion to rank results.

## Ingestion Pipeline

### Entry Points

```mermaid
flowchart TD
    A[Admin Action] --> B{Input Type}
    B -->|Paste text| C[POST /knowledge-bases/{id}/ingest]
    B -->|Upload .txt/.md| C
    B -->|URL| D[POST /knowledge-bases/{id}/ingest-url]
    B -->|HuggingFace dataset| HF[POST /knowledge-bases/{id}/ingest-huggingface]
    
    C --> E[Text Ingestion Pipeline]
    D --> F{URL Type Detection}
    HF --> HFP[HuggingFace Ingestion Pipeline]
    HFP --> E
    
    F -->|datatracker.ietf.org| G[RFC Ingestion Pipeline]
    F -->|Any other URL| H{Deep Research?}
    
    H -->|No| I[Fetch & Strip HTML]
    H -->|Yes| J[Deep Research Pipeline]
    
    I --> E
    J --> K[Fetch Primary URL]
    K --> E
    K --> L[Extract & Analyze Links]
    L --> M[LLM Selects Relevant Links]
    M --> N[Fetch Each Related URL]
    N --> E
    
    G --> O[Fetch RFC Metadata]
    O --> P[Map Lineage]
    P --> Q[Ingest All Related RFCs]
    Q --> E
    Q --> R[Generate Changes Analysis]
    R --> E

    style G fill:#d65d0e,color:#1d2021
    style J fill:#d65d0e,color:#1d2021
    style HFP fill:#458588,color:#1d2021
    style E fill:#98971a,color:#1d2021
```

### Full Ingestion Flow

All content sources converge into the same core pipeline. After chunking and enqueuing, the worker handles title generation, persistence, and optional vector embedding.

```mermaid
flowchart TD
    A[Raw Content] --> B[Preprocess<br/>HTML strip / JSON extract / etc.]
    B --> C[Chunk Text<br/>target ~3200 chars]
    C --> D[Create IngestBatch]
    D --> E[Enqueue chunks to<br/>ingest_queue collection<br/>state=pending]
    E --> F[Return job_id to caller]
    
    F --> G[IngestWorker claims batch<br/>up to 50 items]
    G --> H{ai_titles enabled?}
    
    H -->|No| I[Scripted titles:<br/>first-line extraction]
    H -->|Yes| J[AI title generation<br/>5 concurrent workers]
    
    I --> K[Bulk insert KnowledgeItems<br/>to MongoDB]
    J --> L[Insert KnowledgeItem<br/>individually per chunk]
    
    K --> M{embedding_model<br/>configured?}
    L --> M
    
    M -->|Yes| N[Generate embeddings<br/>via litellm.aembedding]
    M -->|No| O[Skip vector indexing]
    
    N --> P[Upsert vectors to Qdrant]
    P --> Q[Mark queue items done]
    O --> Q
    
    Q --> R[Update KB item count<br/>every 50 items]
    R --> S[Check job completion<br/>every 100 items]
    S --> T{Job complete?}
    T -->|Yes| U[Purge done items<br/>from queue]
    T -->|No| G

    N -. failure .-> Q

    style E fill:#458588,color:#1d2021
    style K fill:#98971a,color:#1d2021
    style L fill:#98971a,color:#1d2021
    style N fill:#d65d0e,color:#1d2021
    style P fill:#d65d0e,color:#1d2021
```

Note: embedding generation failures are logged but do not block ingestion. Items are saved to MongoDB regardless of whether the vector upsert succeeds.

### Chunking Strategy

```mermaid
flowchart TD
    A[Input Text] --> B[Split on double newlines<br/>and markdown headers]
    B --> C[For each block]
    
    C --> D{Current + block<br/>≤ 3200 chars?}
    D -->|Yes| E[Merge into current chunk]
    D -->|No| F[Flush current chunk]
    
    F --> G{Block > 4800 chars?}
    G -->|Yes| H[Split at sentence boundaries]
    G -->|No| I[Block becomes new current]
    
    H --> J[Sub-chunks ~3200 chars each]
    
    E --> K{More blocks?}
    I --> K
    J --> K
    K -->|Yes| C
    K -->|No| L[Flush final chunk]
    L --> M[Return chunk list]

    style A fill:#458588,color:#1d2021
    style M fill:#98971a,color:#1d2021
```

**Chunk size presets:**

| Preset  | Target chars | Max chars | Approx tokens |
|---------|-------------|-----------|---------------|
| small   | 1,600       | 2,400     | ~400          |
| medium  | 3,200       | 4,800     | ~800 (default)|
| large   | 6,400       | 9,600     | ~1,600        |
| xlarge  | 12,800      | 19,200    | ~3,200        |

Split boundaries: paragraphs first, then sentences.

## HuggingFace Dataset Ingestion

Datasets from HuggingFace Hub can be imported directly into a knowledge base. The service auto-detects the dataset format and extracts text content, which then flows through the standard ingestion pipeline.

```mermaid
flowchart TD
    A[User provides repo_id<br/>e.g. tatsu-lab/alpaca] --> B[detect_dataset_format]
    B --> C{Detected format}
    
    C -->|chat| D["Extract messages array<br/>(role: content pairs)"]
    C -->|instruction| E["Extract instruction + response<br/>(input/output fields)"]
    C -->|text| F["Extract text/content/document<br/>column value"]
    C -->|unknown| G["Concatenate all<br/>string values > 10 chars"]
    
    D --> H[Accumulate text parts]
    E --> H
    F --> H
    G --> H
    
    H --> I[Stream rows in pages of 100<br/>up to max_rows limit]
    I --> J{More rows<br/>under limit?}
    J -->|Yes| I
    J -->|No| K[Join all text parts]
    
    K --> L["Feed to standard ingest()<br/>chunk + enqueue"]

    style A fill:#458588,color:#1d2021
    style B fill:#d65d0e,color:#1d2021
    style L fill:#98971a,color:#1d2021
```

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as API Endpoint
    participant KS as KnowledgeService
    participant HF as HuggingFaceService
    participant Q as ingest_queue (MongoDB)
    participant IW as IngestWorker

    UI->>API: POST /ingest-huggingface {repo_id, split, max_rows}
    API->>KS: ingest_huggingface_dataset()
    KS->>HF: detect_dataset_format(repo_id)
    HF-->>KS: {format: "instruction", config: "default"}
    
    loop Page through rows (100 per page)
        KS->>HF: stream_rows(repo_id, offset, length)
        HF-->>KS: {rows: [...]}
        KS->>KS: _extract_hf_row_text(row, format)
    end
    
    KS->>KS: Join all text parts
    KS->>KS: ingest() — chunk + enqueue
    KS->>Q: enqueue IngestQueueItems
    
    Note over IW: Worker picks up items normally
    IW->>Q: claim_batch()
    IW->>IW: Generate titles + embeddings
```

**Format detection** inspects the first page of rows and checks column names:
- **chat**: has `messages` or `conversations` columns
- **instruction**: has `instruction`/`input`/`prompt` + `response`/`output`/`answer` columns
- **text**: has `text`, `content`, `document`, `passage`, or similar columns
- **unknown**: falls back to concatenating all string values

## Hybrid Retrieval

When an agent with linked knowledge bases receives a query, the system runs both vector and text search in parallel and fuses the results.

```mermaid
flowchart TD
    A[User query] --> B{Vector service<br/>available?}
    
    B -->|Yes| C[Generate query embedding<br/>via litellm.aembedding]
    B -->|No| D[Text search only]
    
    C --> E[Qdrant vector search<br/>filtered by kb_ids<br/>cosine similarity, limit 15]
    A --> F[MongoDB text search<br/>per KB, merged by score<br/>limit 15]
    
    E --> G[Vector results<br/>id + score pairs]
    F --> H[Text results<br/>ranked KnowledgeItems]
    
    G --> I{Vector results<br/>found?}
    I -->|No| J[Return text results only]
    I -->|Yes| K[Fetch full items for<br/>vector-only results]
    
    H --> K
    K --> L[Deduplicate by item ID]
    L --> M[Score fusion:<br/>0.7 x vector_score +<br/>0.3 x text_rank_score]
    M --> N[Sort by fused score descending]
    N --> O[Top 15 items]
    O --> P[Inject as context<br/>into LLM prompt]

    D --> F
    
    style E fill:#d65d0e,color:#1d2021
    style F fill:#458588,color:#1d2021
    style M fill:#fabd2f,color:#1d2021
    style P fill:#98971a,color:#1d2021
```

```mermaid
sequenceDiagram
    participant User
    participant CS as ConversationService
    participant KS as KnowledgeService
    participant VS as VectorService
    participant QD as Qdrant
    participant Repo as KnowledgeRepository
    participant LLM as LLMService

    User->>CS: send message "How does SMTP handle bounces?"
    CS->>CS: Load agent (has knowledge_base_ids)
    CS->>KS: retrieve(query, kb_ids, limit=15)
    
    par Vector search
        KS->>VS: generate_embedding(query)
        VS->>LLM: litellm.aembedding(model, input)
        LLM-->>VS: embedding vector
        VS->>QD: query_points(vector, filter=kb_ids, limit=15)
        QD-->>VS: [{id, score}, ...]
        VS-->>KS: vector results
    and Text search
        KS->>Repo: search(query, kb_ids, limit=15)
        Repo-->>KS: text results (KnowledgeItems)
    end
    
    KS->>Repo: find_items_by_ids(vector-only IDs)
    Repo-->>KS: full KnowledgeItems
    
    KS->>KS: Score fusion (0.7 vector + 0.3 text)
    KS->>KS: Sort + top 15
    KS-->>CS: context items
    
    CS->>LLM: stream_completion(model, messages, agent, context)
    
    Note over LLM: Messages assembled as:
    Note over LLM: 1. [CONTEXT] block with KB chunks
    Note over LLM: 2. Agent system prompt + grounding
    Note over LLM: 3. Conversation history
    
    LLM-->>User: Grounded response
```

**Score fusion details:**
- Text results are assigned a rank-based score: first result = 1.0, last = ~0.3 (linear decay)
- Vector scores come directly from Qdrant (cosine similarity, 0.0 to 1.0)
- Fused score = `0.7 * vector_score + 0.3 * text_rank_score`
- Items appearing in only one search get 0.0 for the missing component

**Grounding instruction appended to system prompt:**
> "You have been provided with a knowledge base context. Base your answers on that context. If the context doesn't contain enough information to answer accurately, say 'I don't have that information in my knowledge base' -- never fabricate information."

## Vector Search Architecture

Vector search is powered by Qdrant and integrates with litellm for embedding generation.

### Qdrant Collection

| Property      | Value                          |
|---------------|--------------------------------|
| Collection    | `knowledge_vectors`            |
| Distance      | Cosine similarity              |
| Payload       | `{kb_id: str, title: str}`     |
| Index         | `kb_id` field (keyword type)   |

The collection is created lazily on first upsert, with the vector dimension inferred from the embedding model's output.

### Embedding Generation

Embeddings are generated via `litellm.aembedding()` using the model configured in system settings (`embedding_model` field). The model ID follows the standard `provider/model_name` format (e.g., `openai/text-embedding-3-small`).

```mermaid
flowchart TD
    A[Text to embed] --> B{embedding_model<br/>configured in settings?}
    B -->|No| C[Return None<br/>vector search disabled]
    B -->|Yes| D[Truncate text to 8000 chars]
    D --> E[litellm.aembedding<br/>model + provider kwargs]
    E --> F[Return embedding vector]
    
    E -. error .-> G[Log warning, return None]

    style C fill:#fb4934,color:#1d2021
    style F fill:#98971a,color:#1d2021
```

**Batch embedding** sends all texts in a single API call. On failure, falls back to individual calls per text, so partial failures still produce results.

### Graceful Fallback

When no `embedding_model` is configured in system settings:
- `VectorService.generate_embedding()` returns `None`
- `VectorService.generate_embeddings_batch()` returns `[None, ...]`
- The ingest worker skips vector upsert entirely
- Retrieval falls back to MongoDB text search only (keyword matching)
- The system is fully functional without Qdrant -- vector search is an enhancement, not a requirement

### Vector Lifecycle

```mermaid
flowchart TD
    A[KnowledgeItem created] --> B{VectorService<br/>available?}
    B -->|No| C[Item saved to<br/>MongoDB only]
    B -->|Yes| D[Generate embedding]
    D --> E[Upsert to Qdrant<br/>id = item_id]
    
    F[KB deleted] --> G[delete_by_kb<br/>removes all vectors<br/>for that kb_id]
    
    H[Batch deleted] --> I[delete_by_ids<br/>removes specific vectors]

    style C fill:#458588,color:#1d2021
    style E fill:#98971a,color:#1d2021
    style G fill:#fb4934,color:#1d2021
    style I fill:#fb4934,color:#1d2021
```

## Ingest Worker

The `IngestWorker` is a long-lived asyncio task started at application boot. It continuously polls the `ingest_queue` MongoDB collection and processes items in batches.

### Worker Configuration

| Constant               | Value | Description                              |
|------------------------|-------|------------------------------------------|
| `POLL_INTERVAL`        | 1s    | Sleep between polls when queue is empty   |
| `BATCH_SIZE`           | 50    | Items claimed per processing cycle        |
| `CONCURRENT_AI_WORKERS`| 5     | Max parallel LLM calls for AI titles      |
| `STALE_CHECK_INTERVAL` | 30    | Cycles between stale item checks          |
| `STALE_TIMEOUT`        | 120s  | Timeout for individual AI title generation|
| `COUNT_UPDATE_INTERVAL`| 50    | Items processed before updating KB count  |
| `JOB_CHECK_INTERVAL`   | 100   | Items processed before checking job done  |

### Batch Processing Flow

```mermaid
flowchart TD
    A[Worker main loop] --> B[claim_batch<br/>up to 50 pending items<br/>atomic state → processing]
    B --> C{Items found?}
    C -->|No| D[Sleep 1 second]
    D --> A
    
    C -->|Yes| E[Separate scripted<br/>vs AI title items]
    
    E --> F[Scripted batch]
    E --> G[AI batch]
    
    F --> F1[Generate titles:<br/>first-line extraction]
    F1 --> F2[Bulk insert all<br/>KnowledgeItems at once]
    F2 --> F3[Bulk generate embeddings<br/>single API call]
    F3 --> F4[Bulk upsert vectors<br/>to Qdrant]
    F4 --> F5[Bulk mark queue<br/>items done]
    
    G --> G1["Launch up to 5 concurrent<br/>asyncio tasks (semaphore)"]
    G1 --> G2[Each: LLM title generation<br/>120s timeout]
    G2 --> G3[Each: insert KnowledgeItem]
    G3 --> G4[Each: embed + upsert vector]
    G4 --> G5[Each: mark queue item done]
    
    G2 -. timeout/error .-> G6[Mark item failed]
    
    F5 --> H[Track counts per KB]
    G5 --> H
    G6 --> H
    
    H --> I{50+ items for<br/>any KB?}
    I -->|Yes| J[Update KB item_count]
    I -->|No| K{100+ items for<br/>any job?}
    
    J --> K
    K -->|Yes| L{Job fully processed?}
    L -->|Yes| M[Purge done items<br/>from queue]
    L -->|No| A
    K -->|No| A
    M --> A

    F3 -. failure .-> F5

    style F fill:#98971a,color:#1d2021
    style G fill:#d65d0e,color:#1d2021
    style G6 fill:#fb4934,color:#1d2021
```

### Crash Recovery

On startup, the worker resets any `processing` items back to `pending`. This handles the case where the application crashed or was restarted while items were mid-processing.

```mermaid
sequenceDiagram
    participant IW as IngestWorker
    participant Q as ingest_queue

    Note over IW: Application starts
    IW->>Q: reset_stale_processing()
    Q-->>IW: N items reset to pending
    IW->>Q: get_global_queue_status()
    Q-->>IW: {pending: X, processing: 0, done: Y, failed: Z}
    
    Note over IW: Normal processing begins
    loop Every cycle
        IW->>Q: claim_batch(50)
        Note over IW: Process items...
    end
    
    loop Every 30 cycles
        IW->>Q: reset_stale_processing()
        Note over Q: Items stuck in processing<br/>for too long are reset
    end
```

During normal operation, stale processing items are also checked every 30 polling cycles (approximately 30 seconds when idle) and reset to `pending` so they can be retried.

## IETF RFC Ingestion

```mermaid
flowchart TD
    A[RFC URL Detected] --> B[Extract RFC number]
    B --> C[Fetch metadata from<br/>datatracker.ietf.org API]
    
    C --> D{Metadata available?}
    D -->|No| E[Fetch HTML, strip, ingest as text]
    D -->|Yes| F[Extract lineage relations]
    
    F --> G[Map: obsoletes, obsoleted_by,<br/>updates, updated_by]
    G --> H[Build lineage summary]
    H --> I[Ingest lineage summary<br/>with compliance notes]
    
    I --> J[Collect all RFC numbers<br/>primary + related]
    J --> K[For each RFC]
    K --> L[Fetch HTML from datatracker]
    L --> M[Strip HTML to text]
    M --> N[Fetch RFC metadata for title]
    N --> O[Ingest with source label<br/>'RFC NNNN: Title']
    
    O --> P{More RFCs?}
    P -->|Yes| K
    P -->|No| Q{Has version changes?}
    
    Q -->|Yes| R[For each version pair]
    R --> S[LLM: Compare RFC versions]
    S --> T[Identify:<br/>1. Changed/prohibited behavior<br/>2. New requirements<br/>3. Deprecated features<br/>4. Security changes]
    T --> U[Ingest changes analysis]
    
    Q -->|No| V[Return result]
    U --> V

    style I fill:#d65d0e,color:#1d2021
    style T fill:#d65d0e,color:#1d2021
    style V fill:#98971a,color:#1d2021
```

**Lineage summary includes:**
- Which RFCs this one obsoletes/is obsoleted by
- Which RFCs update/are updated by this one
- Compliance note: "Behavior valid under an older RFC may be non-compliant under newer versions"

**Changes analysis per version pair:**
- What was valid before but is now changed/prohibited
- New requirements added
- Deprecated behaviors
- Security-relevant changes

## Deep Research Mode

```mermaid
flowchart TD
    A[URL + deep=true] --> B[Fetch primary page]
    B --> C[Strip HTML, ingest content]
    
    C --> D[Extract all href links<br/>from raw HTML]
    D --> E[Resolve relative URLs<br/>to absolute]
    E --> F[Filter: deduplicate,<br/>exclude self]
    
    F --> G{ai_deep_research?}
    G -->|Yes| H[LLM: Select relevant links<br/>documentation, specs, guides]
    G -->|No| I[Heuristic scoring:<br/>same domain + doc keywords]
    
    H --> J[Up to N relevant URLs<br/>N = ingest_max_urls setting]
    I --> J
    
    J --> K[For each selected URL]
    K --> L{At item limit?}
    L -->|Yes| M[Stop]
    L -->|No| N{At URL limit?}
    N -->|Yes| M
    N -->|No| O[Fetch page]
    O --> P[Strip HTML]
    P --> Q[Ingest content]
    Q --> R{More URLs?}
    R -->|Yes| K
    R -->|No| M
    
    M --> S[Return total items + URLs followed]

    style H fill:#d65d0e,color:#1d2021
    style S fill:#98971a,color:#1d2021
```

## Model Resolution for Ingestion

The ingestion model (used for title generation, link selection, and RFC analysis) is resolved independently from the agent chat model:

```mermaid
flowchart TD
    A[Need ingest model] --> B{KB has<br/>ingest_model set?}
    B -->|Yes| C{Model's provider<br/>enabled?}
    C -->|Yes| D[Use KB model]
    C -->|No| E{System<br/>default_ingest_model<br/>set?}
    
    B -->|No| E
    E -->|Yes| F{Model's provider<br/>enabled?}
    F -->|Yes| G[Use system ingest default]
    F -->|No| H[Use system agent default<br/>via resolve_model]
    
    E -->|No| H

    style D fill:#98971a,color:#1d2021
    style G fill:#98971a,color:#1d2021
    style H fill:#458588,color:#1d2021
```

**Priority chain:** KB override -> system ingest default -> system agent default

## Limits and Safety

```mermaid
flowchart TD
    A[Ingest starts] --> B[Load limits from settings]
    B --> C[ingest_max_items<br/>default: 200]
    B --> D[ingest_max_urls<br/>default: 10]
    
    C --> E[IngestLimits tracker created]
    D --> E
    
    E --> F[During ingestion]
    F --> G{items_created >= max_items?}
    G -->|Yes| H[Skip remaining chunks]
    G -->|No| I[Continue]
    
    F --> J{urls_processed >= max_urls?}
    J -->|Yes| K[Stop following links]
    J -->|No| L[Continue]
    
    H --> M[Return partial result<br/>with limit info]
    K --> M

    style H fill:#fb4934,color:#1d2021
    style K fill:#fb4934,color:#1d2021
    style M fill:#fabd2f,color:#1d2021
```

## Background Processing

Ingestion uses two layers: `IngestManager` handles chunking and enqueuing, while `IngestWorker` processes the persistent queue.

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as API Endpoint
    participant IM as IngestManager
    participant KS as KnowledgeService
    participant Q as ingest_queue (MongoDB)
    participant IW as IngestWorker
    participant VS as VectorService
    participant QD as Qdrant
    participant LLM as LLM Provider
    participant DB as MongoDB (items)

    UI->>API: POST /ingest or /ingest-url
    API->>IM: start_ingest(kb_id, coro)
    IM-->>API: IngestStatus created
    API-->>UI: {"status": "started"}
    
    Note over IM,Q: IngestManager chunks content and enqueues
    
    IM->>KS: run ingestion coroutine
    KS->>Q: enqueue IngestQueueItems (state=pending)
    KS->>IM: update status.current_step
    
    Note over IW,DB: IngestWorker runs continuously (started at app boot)
    
    loop Claim batches of 50
        IW->>Q: claim_batch(50) — atomic state=processing
        Q-->>IW: batch of IngestQueueItems
        alt Scripted titles (default)
            IW->>IW: extract first line as title (bulk)
            IW->>DB: bulk insert KnowledgeItems
            alt embedding_model configured
                IW->>VS: generate_embeddings_batch(texts)
                VS->>LLM: litellm.aembedding(batch)
                LLM-->>VS: embedding vectors
                VS->>QD: upsert points
            end
        else AI titles (opt-in)
            par 5 concurrent workers
                IW->>LLM: generate title
                IW->>DB: create KnowledgeItem
                alt embedding_model configured
                    IW->>VS: embed + upsert vector
                end
            end
        end
        IW->>Q: mark_done (bulk or individual)
    end
    
    loop UI polls every 2 seconds
        UI->>API: GET /queue-status
        API->>Q: aggregate counts
        API-->>UI: {pending, processing, done, failed, total}
    end
    
    Note over UI: User can navigate away
    Note over IW,DB: Worker continues processing queue
    
    Note over IW: On crash/restart: stale processing items reset to pending
```

## Version Control (Batches)

```mermaid
flowchart TD
    A[Each ingest operation] --> B[Create IngestBatch record]
    B --> C[All items get batch_id]
    C --> D[Batch tracks: source, item_count, timestamp]
    
    E[Admin reviews batches] --> F[GET /batches - newest first]
    F --> G{Bad ingest?}
    G -->|Yes| H[DELETE /batches/{id}]
    H --> I[Delete all items<br/>with that batch_id]
    I --> I2[Delete vectors from Qdrant<br/>for those item IDs]
    I2 --> J[Delete batch record]
    J --> K[Update KB item count]
    
    G -->|No| L[Keep]

    style H fill:#fb4934,color:#1d2021
    style K fill:#98971a,color:#1d2021
```

## Data Model

```mermaid
erDiagram
    knowledge_bases {
        ObjectId _id
        string name
        string description
        string ingest_model
        string created_by
        int item_count
        datetime created_at
        datetime updated_at
    }
    
    knowledge_items {
        ObjectId _id
        string knowledge_base_id
        string batch_id
        string title
        string content
        string source
        int chunk_index
        datetime created_at
    }
    
    ingest_batches {
        ObjectId _id
        string knowledge_base_id
        string source
        int item_count
        datetime created_at
    }
    
    knowledge_vectors {
        string id "same as knowledge_item _id"
        vector embedding "cosine similarity"
        string kb_id "indexed for filtering"
        string title
    }
    
    agents {
        ObjectId _id
        string name
        list knowledge_base_ids
    }
    
    knowledge_bases ||--o{ knowledge_items : contains
    knowledge_bases ||--o{ ingest_batches : tracks
    knowledge_items ||--o| knowledge_vectors : "embedded in Qdrant"
    agents }o--o{ knowledge_bases : references
```
