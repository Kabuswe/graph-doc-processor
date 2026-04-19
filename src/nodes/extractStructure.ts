/**
 * extractStructure — parses document into outline + rawText based on detected format.
 * Minimal LLM usage: uses deterministic parsing, LLM only for complex HTML/XML.
 */

interface DocumentOutline {
  sections: Array<{ level: number; title: string; charCount: number }>;
  tableCount: number;
  codeBlockCount: number;
  linkCount: number;
  listCount: number;
}

function extractMarkdownStructure(content: string): { outline: DocumentOutline; rawText: string } {
  const lines = content.split("\n");
  const sections: DocumentOutline["sections"] = [];
  let tableCount = 0, codeBlockCount = 0, linkCount = 0, listCount = 0;
  let inCode = false;
  const textLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("```")) { inCode = !inCode; codeBlockCount += inCode ? 1 : 0; continue; }
    if (inCode) continue;

    const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);
    if (headingMatch) {
      sections.push({ level: headingMatch[1].length, title: headingMatch[2].trim(), charCount: 0 });
      textLines.push(headingMatch[2]);
      continue;
    }

    if (line.startsWith("|") && line.includes("|")) { tableCount++; continue; }
    if (/^[-*+]\s/.test(line)) { listCount++; textLines.push(line.replace(/^[-*+]\s/, "").trim()); continue; }
    if (/^\d+\.\s/.test(line)) { listCount++; textLines.push(line.replace(/^\d+\.\s/, "").trim()); continue; }

    const links = line.match(/\[([^\]]+)\]\([^)]+\)/g) ?? [];
    linkCount += links.length;

    const plainLine = line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`[^`]+`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    if (plainLine.trim()) textLines.push(plainLine.trim());
  }

  return {
    outline: { sections, tableCount, codeBlockCount, linkCount, listCount },
    rawText: textLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function extractPlainText(content: string): { outline: DocumentOutline; rawText: string } {
  const lines = content.split("\n");
  const sections: DocumentOutline["sections"] = [];

  // Detect all-caps lines as potential section headers
  for (const line of lines) {
    if (line.trim().length > 4 && line.trim() === line.trim().toUpperCase() && !/[.!?,]/.test(line)) {
      sections.push({ level: 1, title: line.trim(), charCount: 0 });
    }
  }

  return {
    outline: { sections, tableCount: 0, codeBlockCount: 0, linkCount: 0, listCount: 0 },
    rawText: content.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function extractHtmlText(content: string): { outline: DocumentOutline; rawText: string } {
  const sections: DocumentOutline["sections"] = [];
  const headingRegex = /<h([1-6])[^>]*>([^<]+)<\/h[1-6]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    sections.push({ level: parseInt(match[1]), title: match[2].trim(), charCount: 0 });
  }
  const rawText = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tableCount = (content.match(/<table/gi) ?? []).length;
  const linkCount  = (content.match(/<a /gi) ?? []).length;
  return { outline: { sections, tableCount, codeBlockCount: 0, linkCount, listCount: 0 }, rawText };
}

function extractCsvStructure(content: string): { outline: DocumentOutline; rawText: string } {
  const lines = content.trim().split("\n");
  const headers = lines[0]?.split(",").map(h => h.trim().replace(/^"|"$/g, "")) ?? [];
  const rowCount = lines.length - 1;
  return {
    outline: {
      sections: [{ level: 1, title: `CSV: ${headers.join(", ")}`, charCount: content.length }],
      tableCount: 1, codeBlockCount: 0, linkCount: 0, listCount: 0,
    },
    rawText: `Table with ${rowCount} rows and columns: ${headers.join(", ")}\n\n${content.slice(0, 2000)}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractStructureNode = async (state: any) => {
  const { rawContent, detectedFormat } = state;
  const content: string = rawContent ?? "";

  let result: { outline: DocumentOutline; rawText: string };

  switch (detectedFormat) {
    case "markdown":
    case "md":
      result = extractMarkdownStructure(content);
      break;
    case "html":
      result = extractHtmlText(content);
      break;
    case "csv":
      result = extractCsvStructure(content);
      break;
    default:
      result = extractPlainText(content);
  }

  const structuralMetrics = {
    charCount: content.length,
    wordCount: result.rawText.split(/\s+/).filter(Boolean).length,
    lineCount: content.split("\n").length,
    sectionCount: result.outline.sections.length,
  };

  return {
    phase: "extract-structure",
    documentOutline: result.outline,
    structuralMetrics,
    rawText: result.rawText,
  };
};
