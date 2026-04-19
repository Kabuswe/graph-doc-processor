/**
 * generateSummary — LLM summarization: one-liner, abstract, and bullet points.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { reasoningModel } from "../models.js";

const SummarySchema = z.object({
  oneLiner: z.string().max(150).describe("Single sentence capture of the document's core purpose"),
  abstract: z.string().max(600).describe("200-400 word summary suitable for a document preview"),
  bulletSummary: z.array(z.string()).min(3).max(8).describe("3-8 key takeaways as bullet points"),
  keyEntities: z.array(z.string()).describe("Named entities: people, orgs, products, technologies mentioned"),
});

const structuredModel = reasoningModel.withStructuredOutput(SummarySchema, {
  method: "jsonSchema",
  strict: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const generateSummaryNode = async (state: any) => {
  const { rawText, detectedFormat, structuralMetrics, processingDepth } = state;
  const text: string = rawText ?? "";

  if (!text.trim()) {
    return {
      phase: "generate-summary",
      oneLiner: "Empty document",
      abstract: "",
      bulletSummary: ["Document contains no processable text"],
      keyEntities: [],
    };
  }

  // For shallow depth, truncate to first 1000 chars
  const maxLen = processingDepth === "shallow" ? 1000 : processingDepth === "standard" ? 6000 : 12000;
  const truncated = text.slice(0, maxLen);
  const wasTruncated = text.length > maxLen;

  const result = await structuredModel.invoke([
    new SystemMessage(
      "Summarize this document into structured output.\n" +
      "oneLiner: captures the core purpose in one sentence.\n" +
      "abstract: a reader would use this to decide if they need the full document.\n" +
      "bulletSummary: the most important takeaways, each ≤ 20 words.\n" +
      "keyEntities: specific named things (people, orgs, products, places, technologies).",
    ),
    new HumanMessage(
      `Format: ${detectedFormat}\n` +
      `Words: ${structuralMetrics?.wordCount ?? "unknown"}\n` +
      (wasTruncated ? `[Truncated to first ${maxLen} chars]\n` : "") +
      `\n${truncated}`,
    ),
  ]);

  return {
    phase: "generate-summary",
    oneLiner: result.oneLiner,
    abstract: result.abstract,
    bulletSummary: result.bulletSummary,
    keyEntities: result.keyEntities,
  };
};
