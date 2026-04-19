/**
 * detectFormat — detects document format from content heuristics.
 * Zero LLM calls — pure pattern matching.
 */

type ProcessingMode = "text" | "tabular";

function detectMimeFormat(content: string): { format: string; mode: ProcessingMode } {
  const trimmed = content.trim();

  // JSON
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { JSON.parse(trimmed); return { format: "json", mode: "text" }; } catch { /* not valid json */ }
  }

  // HTML
  if (/<html[\s>]/i.test(trimmed) || /<!doctype html/i.test(trimmed)) {
    return { format: "html", mode: "text" };
  }

  // Markdown
  if (/^#{1,6} /m.test(trimmed) || /^\*\*[^*]+\*\*/m.test(trimmed) || /^\- /m.test(trimmed)) {
    return { format: "markdown", mode: "text" };
  }

  // CSV (at least 2 rows with same number of commas)
  const lines = trimmed.split("\n").slice(0, 5);
  if (lines.length >= 2) {
    const commas = lines.map(l => (l.match(/,/g) ?? []).length);
    if (commas[0] >= 2 && commas.every(c => Math.abs(c - commas[0]) <= 1)) {
      return { format: "csv", mode: "tabular" };
    }
  }

  // XML
  if (trimmed.startsWith("<?xml") || (trimmed.startsWith("<") && trimmed.endsWith(">"))) {
    return { format: "xml", mode: "text" };
  }

  // YAML
  if (/^[a-z_]+:\s/m.test(trimmed) && !/[{}[\]]/.test(trimmed.slice(0, 100))) {
    return { format: "yaml", mode: "text" };
  }

  return { format: "txt", mode: "text" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const detectFormatNode = async (state: any) => {
  const content: string = state.rawContent ?? "";
  const docType: string = state.docType ?? "";

  // Prioritize explicit docType hint
  let detected = detectMimeFormat(content);
  if (docType && ["json", "csv", "html", "markdown", "md", "xml", "yaml", "txt", "pdf"].includes(docType.toLowerCase())) {
    detected = { format: docType.toLowerCase() === "md" ? "markdown" : docType.toLowerCase(), mode: detected.mode };
  }

  return {
    phase: "detect-format",
    detectedFormat: detected.format,
    processingMode: detected.mode,
  };
};
