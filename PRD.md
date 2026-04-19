# graph-doc-processor — Product Requirements Document

## Purpose
Intelligence layer on top of `graph-doc-ingestion`. Where doc-ingestion handles raw extraction and vector storage (no LLM), doc-processor adds semantic understanding: it generates a structured summary, extracts Q&A pairs for RAG pre-seeding, resolves internal cross-references between documents, and identifies key entities. This is the pipeline used when a client uploads documents to the Electron desktop app for local chat, or when documents are added to a client’s knowledge base via the portal.

## Deployment
- Deployed on LangSmith Deployment as `docProcessor`
- `langgraph.json`: `{ "graphs": { "docProcessor": "./src/graph.ts:graph" } }`
- Called by Electron app’s local supervisor after a file is selected
- Also callable from the portal’s document upload flow

## Pipeline
```
START → detectFormat → extractStructure → resolveReferences → generateSummary → extractQAPairs → triggerIngestion → END
```

### Node Responsibilities

**`detectFormat`**
- Detect MIME type from file extension or magic bytes
- Supported: PDF, DOCX, MD, TXT, HTML, EPUB, CSV
- For CSV: route to tabular processing (summarize schema + sample rows instead of full text)
- Output: `detectedFormat`, `processingMode: 'text' | 'tabular'`

**`extractStructure`** (fastModel for section titles only)
- Extract document outline: `sections[]` with `title` and `level`
- Identify abstract/intro, conclusion/summary sections if present
- Count: pages, paragraphs, tables, code blocks, images
- Output: `documentOutline`, `structuralMetrics`, `rawText: string`

**`resolveReferences`**
- Identify internal references: "see section 3", "as described above", "refer to Figure 2"
- Identify external references: URLs, DOIs, citation markers
- Cross-reference with existing DynamoDB doc registry to find related already-indexed docs by `clientId`
- Output: `internalRefs[]`, `externalRefs[]`, `relatedDocIds[]`

**`generateSummary`** (reasoningModel)
- Generate a 3-tier summary:
  - `oneLiner`: ≤ 1 sentence — what is this document about?
  - `abstract`: 2–3 paragraph structured summary covering purpose, key findings, and recommended action
  - `bulletSummary`: 5–8 key takeaways as `string[]`
- Preserve the document’s technical level in the summary
- Output: `oneLiner`, `abstract`, `bulletSummary`

**`extractQAPairs`** (reasoningModel)
- Generate 10–20 Q&A pairs that a user might ask about this document
- Each pair: `{ question: string, answer: string, sourceSection: string, confidence: 0-1 }`
- These are written to S3 Vectors as separate vectors (not chunks) to pre-seed RAG with high-quality matches
- Output: `qaPairs[]`, `qaPairCount`

**`triggerIngestion`**
- Call `graph-doc-ingestion` via `RemoteGraph` with the `rawText` and processed metadata
- Pass `processingDepth: 'full'` — includes QA pairs as additional content
- Also write `{ oneLiner, abstract, bulletSummary, qaPairs[] }` to DynamoDB `kabatoshi-doc-registry` alongside the ingestion record
- Output: `docId`, `ingestedAt`, `status: 'processed'`

## State Schema
```ts
{
  rawContent: string;
  docType: string;
  clientId: string;
  processingDepth: 'summary-only' | 'full'; // default 'full'

  detectedFormat: string;
  processingMode: 'text' | 'tabular';
  documentOutline: object;
  structuralMetrics: object;
  rawText: string;
  internalRefs: string[];
  externalRefs: string[];
  relatedDocIds: string[];

  oneLiner: string;
  abstract: string;
  bulletSummary: string[];
  qaPairs: Array<{ question: string; answer: string; sourceSection: string; confidence: number }>;
  qaPairCount: number;

  docId: string;
  ingestedAt: string;
  status: string;

  error?: string;
  phase: string;
}
```

## Local Mode (Electron)
- `processingMode` detected from file path via `src/local.ts`
- `triggerIngestion` calls the local graph-doc-ingestion instance (Ollama embeddings, SQLite-vec) instead of RemoteGraph
- Summary and QA pairs written to local SQLite `kabatoshi.db`

## Environment Variables
```
OPENROUTER_API_KEY=
DOC_INGESTION_DEPLOYMENT_URL=
DYNAMODB_REGISTRY_TABLE=kabatoshi-doc-registry
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
LANGSMITH_API_KEY=
LANGSMITH_TRACING_V2=true
LANGSMITH_PROJECT=graph-doc-processor
DATABASE_URL=
```

## Agent Instructions
1. `extractQAPairs` should use `withStructuredOutput` with a Zod schema enforcing min 10, max 20 pairs
2. For tabular (CSV) processing mode: `generateSummary` describes the schema and provides 3 sample rows; `extractQAPairs` generates data-query style questions ("What is the total for...", "Which rows have...")
3. `triggerIngestion` must pass Q&A pairs as additional content items — each pair embedded separately
4. `processingDepth: 'summary-only'` skips `extractQAPairs` and `triggerIngestion` — returns only summary fields; used for quick preview in upload UI before committing
5. Add `src/local.ts` entry point for Electron: routes all storage to SQLite instead of DynamoDB/RemoteGraph

## Acceptance Criteria
- A 20-page PDF produces: `oneLiner` (≤ 1 sentence), `abstract` (2-3 paragraphs), `bulletSummary` (5–8 items), `qaPairs` (10–20 pairs)
- `processingDepth: 'summary-only'` returns in < 15 seconds with no ingestion triggered
- Q&A pairs are semantically diverse — not all asking about the same section
- `relatedDocIds` correctly identifies previously indexed documents with overlapping topics (by clientId scoping)
- LangSmith trace shows all 6 nodes with token counts logged at `generateSummary` and `extractQAPairs`
