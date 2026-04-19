/**
 * graph-doc-processor
 *
 * Pipeline: detectFormat â†’ extractStructure â†’ resolveReferences â†’ generateSummary â†’ extractQAPairs â†’ triggerIngestion
 *
 * Input:  DocProcessorInput  (rawContent, docType, clientId, processingDepth)
 * Output: DocProcessorOutput (oneLiner, abstract, bulletSummary[], qaPairs[], docId, status)
 *
 * Implementation tracked in GitHub issues -- see repo Issues tab.
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

import { detectFormatNode }      from './nodes/detectFormat.js';
import { extractStructureNode }  from './nodes/extractStructure.js';
import { resolveReferencesNode } from './nodes/resolveReferences.js';
import { generateSummaryNode }   from './nodes/generateSummary.js';
import { extractQAPairsNode }    from './nodes/extractQAPairs.js';
import { triggerIngestionNode }  from './nodes/triggerIngestion.js';

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
