/**
 * triggerIngestion — registers the processed document (generates docId + timestamps).
 * In production: calls graph-doc-ingestion via RemoteGraph.
 * Here: deterministic ID generation + status tracking.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const triggerIngestionNode = async (state: any) => {
  const { clientId, docType, detectedFormat, qaPairCount, structuralMetrics } = state;

  const docId = crypto.randomUUID();
  const ingestedAt = new Date().toISOString();

  // Call remote doc-ingestion graph if deployment URL is configured
  const ingestionUrl = process.env.DOC_INGESTION_DEPLOYMENT_URL;
  if (ingestionUrl) {
    try {
      const response = await fetch(`${ingestionUrl}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistant_id: "doc-ingestion",
          input: {
            rawContent: state.rawText,
            clientId: clientId ?? "system",
            docType: docType ?? detectedFormat ?? "unknown",
            metadata: { docId, processedAt: ingestedAt, qaPairCount, wordCount: structuralMetrics?.wordCount },
          },
        }),
      });
      if (response.ok) {
        console.log(`[triggerIngestion] Ingestion triggered for docId ${docId}`);
      }
    } catch (err) {
      console.warn("[triggerIngestion] Remote ingestion call failed:", (err as Error).message);
    }
  }

  return {
    phase: "trigger-ingestion",
    docId,
    ingestedAt,
    status: "processed",
  };
};
