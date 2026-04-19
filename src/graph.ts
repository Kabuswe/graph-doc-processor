/**
 * graph-doc-processor
 *
 * Pipeline: detectFormat → extractStructure → resolveReferences → generateSummary → extractQAPairs → triggerIngestion
 *
 * Input:  DocProcessorInput  (rawContent, docType, clientId, processingDepth)
 * Output: DocProcessorOutput (oneLiner, abstract, bulletSummary[], qaPairs[], docId, status)
 *
 * TODO: implement nodes under src/nodes/ per PRD.md
 * TODO: implement src/local.ts for Electron mode
 */

import { StateGraph, START, END, MemorySaver, StateSchema, UntrackedValue } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import { z } from 'zod';

function lastValue<T>(schema: z.ZodType<T, any, any>): UntrackedValue<T> {
  return schema as unknown as UntrackedValue<T>;
}

const ProcessorState = new StateSchema({
  rawContent:        lastValue(z.string().default('')),
  docType:           lastValue(z.string().default('')),
  clientId:          lastValue(z.string().default('')),
  processingDepth:   lastValue(z.enum(['summary-only', 'full']).default('full')),
  detectedFormat:    lastValue(z.string().default('')),
  processingMode:    lastValue(z.enum(['text', 'tabular']).default('text')),
  documentOutline:   lastValue(z.any().default(() => ({}))),
  structuralMetrics: lastValue(z.any().default(() => ({}))),
  rawText:           lastValue(z.string().default('')),
  internalRefs:      lastValue(z.array(z.string()).default(() => [])),
  externalRefs:      lastValue(z.array(z.string()).default(() => [])),
  relatedDocIds:     lastValue(z.array(z.string()).default(() => [])),
  oneLiner:          lastValue(z.string().default('')),
  abstract:          lastValue(z.string().default('')),
  bulletSummary:     lastValue(z.array(z.string()).default(() => [])),
  qaPairs:           lastValue(z.array(z.any()).default(() => [])),
  qaPairCount:       lastValue(z.number().default(0)),
  docId:             lastValue(z.string().default('')),
  ingestedAt:        lastValue(z.string().default('')),
  status:            lastValue(z.string().default('processing')),
  error:             lastValue(z.string().optional()),
  phase:             lastValue(z.string().default('')),
});

const standardRetry = { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2 };

// TODO: implement real nodes
const detectFormatNode      = async (s: any) => ({ phase: 'detect-format', detectedFormat: 'txt', processingMode: 'text' as const });
const extractStructureNode  = async (s: any) => ({ phase: 'extract-structure', documentOutline: {}, structuralMetrics: {}, rawText: s.rawContent });
const resolveReferencesNode = async (s: any) => ({ phase: 'resolve-refs', internalRefs: [], externalRefs: [], relatedDocIds: [] });
const generateSummaryNode   = async (s: any) => ({ phase: 'generate-summary', oneLiner: '', abstract: '', bulletSummary: [] });
const extractQAPairsNode    = async (s: any) => ({ phase: 'extract-qa', qaPairs: [], qaPairCount: 0 });
const triggerIngestionNode  = async (s: any) => ({ phase: 'trigger-ingestion', docId: crypto.randomUUID(), ingestedAt: new Date().toISOString(), status: 'processed' });

// Conditional: skip QA + ingestion if processingDepth === 'summary-only'
const routeByDepth = (s: any) => s.processingDepth === 'summary-only' ? END : 'extractQAPairs';

function assembleGraph(checkpointer?: MemorySaver) {
  const builder = new StateGraph(ProcessorState)
    .addNode('detectFormat',      detectFormatNode,      { retryPolicy: standardRetry })
    .addNode('extractStructure',  extractStructureNode,  { retryPolicy: standardRetry })
    .addNode('resolveReferences', resolveReferencesNode, { retryPolicy: standardRetry })
    .addNode('generateSummary',   generateSummaryNode,   { retryPolicy: standardRetry })
    .addNode('extractQAPairs',    extractQAPairsNode,    { retryPolicy: standardRetry })
    .addNode('triggerIngestion',  triggerIngestionNode,  { retryPolicy: standardRetry })
    .addEdge(START, 'detectFormat')
    .addEdge('detectFormat', 'extractStructure')
    .addEdge('extractStructure', 'resolveReferences')
    .addEdge('resolveReferences', 'generateSummary')
    .addConditionalEdges('generateSummary', routeByDepth, ['extractQAPairs', END])
    .addEdge('extractQAPairs', 'triggerIngestion')
    .addEdge('triggerIngestion', END);

  return checkpointer ? builder.compile({ checkpointer }) : builder.compile();
}

export const graph: any = assembleGraph(new MemorySaver());

export async function buildGraph(): Promise<any> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  return assembleGraph(checkpointer as unknown as MemorySaver);
}
