/**
 * resolveReferences — extracts internal and external references from document text.
 * Zero LLM calls — regex-based extraction.
 */

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const DOC_REF_RE = /(?:see|refer to|as per|per|in|from)\s+(?:section\s+)?["']?([A-Z][^"'\n,;.]{3,60})["']?/gi;
const CITATION_RE = /\[(\d+)\]|\[(?:[A-Z][a-z]+\s+)?(?:et al\.?\s+)?\d{4}\]/g;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resolveReferencesNode = async (state: any) => {
  const { rawText, documentOutline } = state;
  const text: string = rawText ?? "";

  // External URLs
  const urlMatches = text.match(URL_RE) ?? [];
  const externalRefs = [...new Set(urlMatches.map(u => u.replace(/[.,;!?)]+$/, "")))]
    .filter(u => u.length < 200);

  // Internal document references (section mentions)
  const internalRefs: string[] = [];
  let match: RegExpExecArray | null;
  const docRefRe = new RegExp(DOC_REF_RE.source, "gi");
  while ((match = docRefRe.exec(text)) !== null) {
    const ref = match[1].trim();
    if (ref.length > 3 && ref.length < 60 && !ref.match(/^(the|this|that|a|an|of|in|and)$/i)) {
      internalRefs.push(ref);
    }
  }

  // Citations
  const citations = text.match(CITATION_RE) ?? [];

  // Section titles as internal references
  const sectionTitles = (documentOutline?.sections ?? []).map((s: { title: string }) => s.title);

  const allInternal = [...new Set([...internalRefs, ...citations])];

  return {
    phase: "resolve-refs",
    internalRefs: allInternal.slice(0, 20),
    externalRefs: externalRefs.slice(0, 20),
    relatedDocIds: [],
  };
};
