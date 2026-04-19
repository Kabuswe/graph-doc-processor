/**
 * extractQAPairs — LLM extraction of question-answer pairs from the document.
 * Only runs when processingDepth is not 'summary-only' (or 'shallow').
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { fastModel } from "../models.js";

const QAPairSchema = z.object({
  question: z.string().describe("Question a reader might ask about this document"),
  answer: z.string().describe("Concise, factual answer sourced from the document"),
  confidence: z.number().min(0).max(1),
});

const QASchema = z.object({
  qaPairs: z.array(QAPairSchema).min(1).max(12),
});

const structuredModel = fastModel.withStructuredOutput(QASchema, {
  method: "jsonSchema",
  strict: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractQAPairsNode = async (state: any) => {
  const { rawText, oneLiner, processingDepth } = state;
  const text: string = rawText ?? "";

  if (!text.trim()) {
    return { phase: "extract-qa", qaPairs: [], qaPairCount: 0 };
  }

  const maxPairs = processingDepth === "deep" ? 12 : 6;
  const maxLen   = processingDepth === "deep" ? 10000 : 4000;
  const truncated = text.slice(0, maxLen);

  const result = await structuredModel.invoke([
    new SystemMessage(
      `Generate up to ${maxPairs} question-answer pairs from this document.\n` +
      "Each Q/A pair should be self-contained and useful for an FAQ or knowledge base.\n" +
      "Questions should cover the most important facts, not trivial details.\n" +
      "Answers should be concise (1-3 sentences) and sourced directly from the text.",
    ),
    new HumanMessage(
      `Document summary: ${oneLiner}\n\nDocument text:\n${truncated}`,
    ),
  ]);

  return {
    phase: "extract-qa",
    qaPairs: result.qaPairs,
    qaPairCount: result.qaPairs.length,
  };
};
