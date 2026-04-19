/**
 * tests/doc.test.ts — integration test for graph-doc-processor
 */
import "dotenv/config";
import { graph } from "../src/graph.js";

const TEST_CASES = [
  {
    name: "Markdown doc shallow",
    input: {
      rawContent: `# Getting Started with LangGraph

LangGraph is a library for building stateful, multi-actor applications with LLMs.

## Installation

\`\`\`bash
npm install @langchain/langgraph
\`\`\`

## Key Concepts

- **StateGraph**: The main graph class
- **Nodes**: Functions that transform state  
- **Edges**: Define flow between nodes

## Example

See the [documentation](https://langchain-ai.github.io/langgraph/) for full examples.
`,
      ingestionEnabled: false,
      depth: "shallow",
    },
    validate: (r: Record<string, unknown>) =>
      typeof r.oneLiner === "string" && r.oneLiner.length > 0 &&
      r.detectedFormat === "markdown",
  },
  {
    name: "JSON data deep",
    input: {
      rawContent: JSON.stringify({
        name: "graph-contracts",
        version: "1.0.0",
        description: "Type contracts for the agent graph platform",
        exports: {
          ".": "./dist/index.js",
          "./types": "./dist/types.js",
        },
      }),
      ingestionEnabled: false,
      depth: "standard",
    },
    validate: (r: Record<string, unknown>) =>
      r.detectedFormat === "json" &&
      Array.isArray(r.qaPairs) && (r.qaPairs as unknown[]).length > 0,
  },
];

async function runTest(tc: (typeof TEST_CASES)[0]) {
  const config = { configurable: { thread_id: `test-${Date.now()}` } };
  const result = await graph.invoke(tc.input, config);

  const valid = tc.validate(result as Record<string, unknown>);
  const icon = valid ? "✅" : "⚠️";
  console.log(
    `${icon} [${tc.name}] format=${result.detectedFormat} qa=${(result.qaPairs as unknown[])?.length ?? 0}`,
  );
  console.log(`   oneLiner: ${result.oneLiner}`);
  return valid;
}

async function main() {
  console.log("\n=== graph-doc-processor integration tests ===\n");
  const results = await Promise.all(TEST_CASES.map(runTest));
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
