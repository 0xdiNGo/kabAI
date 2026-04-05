# Knowledge Ingestion Engine

## Overview

The knowledge ingestion engine processes raw content (text, URLs, files) into searchable knowledge items that agents use to ground their responses. It supports plain text, HTML pages, IETF RFCs (with full lineage analysis), and deep research mode that follows related links.

## Ingestion Flow

### Entry Points

```mermaid
flowchart TD
    A[Admin Action] --> B{Input Type}
    B -->|Paste text| C[POST /knowledge-bases/{id}/ingest]
    B -->|Upload .txt/.md| C
    B -->|URL| D[POST /knowledge-bases/{id}/ingest-url]
    
    C --> E[Text Ingestion Pipeline]
    D --> F{URL Type Detection}
    
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
    style E fill:#98971a,color:#1d2021
```

### Text Ingestion Pipeline

This is the core pipeline that all content flows through regardless of source.

```mermaid
flowchart TD
    A[Raw Text Content] --> B[Create Ingest Batch]
    B --> C[Chunk Text]
    
    C --> D{Check Limits}
    D -->|At item limit| E[Stop - Return count]
    D -->|Under limit| F[Trim chunks to remaining limit]
    
    F --> G[For each chunk]
    G --> H[Resolve Ingest Model]
    H --> I{KB has ingest_model?}
    I -->|Yes + available| J[Use KB model]
    I -->|No| K{System ingest default set?}
    K -->|Yes + available| L[Use system ingest default]
    K -->|No| M[Use system agent default]
    
    J --> N[LLM: Generate title]
    L --> N
    M --> N
    
    N --> O[Create KnowledgeItem<br/>with batch_id]
    O --> P{More chunks?}
    P -->|Yes| G
    P -->|No| Q[Bulk insert items to MongoDB]
    Q --> R[Update batch item count]
    R --> S[Update KB item count]
    S --> T[Return items_created]

    style B fill:#458588,color:#1d2021
    style N fill:#d65d0e,color:#1d2021
    style Q fill:#98971a,color:#1d2021
```

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

**Target sizes:**
- Target chunk: ~3200 chars (~800 tokens)
- Max chunk: ~4800 chars (~1200 tokens)
- Split boundaries: paragraphs first, then sentences

### IETF RFC Ingestion

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

### Deep Research Mode

```mermaid
flowchart TD
    A[URL + deep=true] --> B[Fetch primary page]
    B --> C[Strip HTML, ingest content]
    
    C --> D[Extract all href links<br/>from raw HTML]
    D --> E[Resolve relative URLs<br/>to absolute]
    E --> F[Filter: deduplicate,<br/>exclude self]
    
    F --> G[LLM: Select relevant links]
    G --> H[Prompt: Which links point to<br/>documentation, specs, guides?<br/>Exclude nav, login, social, images]
    H --> I[Up to N relevant URLs<br/>N = ingest_max_urls setting]
    
    I --> J[For each selected URL]
    J --> K{At item limit?}
    K -->|Yes| L[Stop]
    K -->|No| M{At URL limit?}
    M -->|Yes| L
    M -->|No| N[Fetch page]
    N --> O[Strip HTML]
    O --> P[Ingest content]
    P --> Q{More URLs?}
    Q -->|Yes| J
    Q -->|No| L
    
    L --> R[Return total items + URLs followed]

    style G fill:#d65d0e,color:#1d2021
    style R fill:#98971a,color:#1d2021
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

**Priority chain:** KB override → system ingest default → system agent default

## Limits and Safety

```mermaid
flowchart TD
    A[Ingest starts] --> B[Load limits from settings]
    B --> C[ingest_max_items<br/>default: 200]
    B --> D[ingest_max_urls<br/>default: 10]
    
    C --> E[IngestLimits tracker created]
    D --> E
    
    E --> F[During ingestion]
    F --> G{items_created ≥ max_items?}
    G -->|Yes| H[Skip remaining chunks]
    G -->|No| I[Continue]
    
    F --> J{urls_processed ≥ max_urls?}
    J -->|Yes| K[Stop following links]
    J -->|No| L[Continue]
    
    H --> M[Return partial result<br/>with limit info]
    K --> M

    style H fill:#fb4934,color:#1d2021
    style K fill:#fb4934,color:#1d2021
    style M fill:#fabd2f,color:#1d2021
```

## Background Processing

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as API Endpoint
    participant IM as IngestManager
    participant KS as KnowledgeService
    participant LLM as LLM Provider
    participant DB as MongoDB

    UI->>API: POST /ingest or /ingest-url
    API->>IM: start_ingest(kb_id, coro)
    IM-->>API: IngestStatus created
    API-->>UI: {"status": "started"}
    
    Note over IM,DB: Background task runs independently
    
    IM->>KS: run ingestion coroutine
    KS->>LLM: generate titles
    KS->>DB: store items
    KS->>IM: update status.current_step
    
    loop Every 2 seconds
        UI->>API: GET /ingest-status
        API->>IM: get_status(kb_id)
        IM-->>API: {state, current_step, ...}
        API-->>UI: status update
    end
    
    Note over UI: User can navigate away
    Note over IM,DB: Task continues running
    
    KS-->>IM: coroutine completes
    IM->>IM: state = "completed"
    
    Note over UI: User returns
    UI->>API: GET /ingest-status
    API-->>UI: {state: "completed", result: {...}}
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
    I --> J[Delete batch record]
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
    
    agents {
        ObjectId _id
        string name
        list knowledge_base_ids
    }
    
    knowledge_bases ||--o{ knowledge_items : contains
    knowledge_bases ||--o{ ingest_batches : tracks
    agents }o--o{ knowledge_bases : references
```

## Context Injection at Query Time

```mermaid
sequenceDiagram
    participant User
    participant CS as ConversationService
    participant KS as KnowledgeService
    participant Repo as KnowledgeRepository
    participant LLM as LLMService

    User->>CS: send message "How does SMTP handle bounces?"
    CS->>CS: Load agent (has knowledge_base_ids)
    CS->>KS: retrieve(query, kb_ids, limit=5)
    KS->>Repo: MongoDB $text search<br/>across KB items
    Repo-->>KS: Top 5 matching chunks
    KS-->>CS: context items
    
    CS->>LLM: stream_completion(model, messages, agent, context)
    
    Note over LLM: Messages assembled as:
    Note over LLM: 1. [CONTEXT] block with chunks
    Note over LLM: 2. Agent system prompt + grounding
    Note over LLM: 3. Conversation history
    
    LLM-->>User: Grounded response
```

**Grounding instruction appended to system prompt:**
> "You have been provided with a knowledge base context. Base your answers on that context. If the context doesn't contain enough information to answer accurately, say 'I don't have that information in my knowledge base' — never fabricate information."
