/**
 * tests/doc.test.ts -- vitest integration tests for graph-doc-processor.
 * Makes real LLM calls via OpenRouter -- requires OPENROUTER_API_KEY in .env.
 */
import "dotenv/config";
import { describe, test, expect } from "vitest";
import { graph } from "../src/graph.js";

describe("graph-doc-processor", () => {
  test("detects markdown format and generates summary + QA pairs", async () => {
    const result = await graph.invoke(
      {
        rawContent: [
          "# Getting Started with LangGraph",
          "",
          "LangGraph is a library for building stateful, multi-actor applications with LLMs.",
          "",
          "## Installation",
          "",
          "Run: npm install @langchain/langgraph",
          "",
          "## Key Concepts",
          "",
          "- StateGraph: The main graph class",
          "- Nodes: Functions that transform state",
          "- Edges: Define flow between nodes",
        ].join("\n"),
        clientId: "test",
        processingDepth: "full",
      },
      { configurable: { thread_id: "test-doc-1-" + Date.now() } },
    );
    expect(result.detectedFormat).toBe("markdown");
    expect(result.phase).toBe("trigger-ingestion");
    expect(typeof result.oneLiner).toBe("string");
    expect((result.oneLiner as string).length).toBeGreaterThan(10);
    expect(Array.isArray(result.bulletSummary)).toBe(true);
    expect((result.bulletSummary as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(result.docId).toBeTruthy();
    expect(result.status).toBe("processed");
  }, 120000);

  test("detects JSON format and extracts QA pairs", async () => {
    const result = await graph.invoke(
      {
        rawContent: JSON.stringify({
          name: "graph-contracts",
          version: "1.0.0",
          description: "Type contracts for the agent graph platform",
          exports: { ".": "./dist/index.js" },
        }),
        clientId: "test",
        processingDepth: "full",
      },
      { configurable: { thread_id: "test-doc-2-" + Date.now() } },
    );
    expect(result.detectedFormat).toBe("json");
    expect(result.phase).toBe("trigger-ingestion");
    expect(Array.isArray(result.qaPairs)).toBe(true);
    expect((result.qaPairs as unknown[]).length).toBeGreaterThan(0);
    expect(typeof result.qaPairCount).toBe("number");
  }, 120000);

  test("summary-only depth skips QA extraction", async () => {
    const result = await graph.invoke(
      {
        rawContent: "Retrieval-Augmented Generation (RAG) combines a language model with a vector database to answer questions using retrieved documents as context.",
        clientId: "test",
        processingDepth: "summary-only",
      },
      { configurable: { thread_id: "test-doc-3-" + Date.now() } },
    );
    expect(result.phase).toBe("generate-summary");
    expect(typeof result.oneLiner).toBe("string");
    expect((result.oneLiner as string).length).toBeGreaterThan(5);
  }, 90000);

  test("plain text with URL extracts external references", async () => {
    const result = await graph.invoke(
      {
        rawContent: "AI agents use LangGraph for orchestration. See https://langchain-ai.github.io/langgraph/ for details. Refer to the Installation section for setup.",
        clientId: "test",
        processingDepth: "full",
      },
      { configurable: { thread_id: "test-doc-4-" + Date.now() } },
    );
    expect(result.detectedFormat).toBe("txt");
    expect(result.phase).toBe("trigger-ingestion");
    expect(Array.isArray(result.externalRefs)).toBe(true);
    expect((result.externalRefs as string[]).some((r) => r.includes("langchain"))).toBe(true);
  }, 120000);
});