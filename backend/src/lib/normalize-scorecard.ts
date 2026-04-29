const clamp = (n: number) => Math.max(0, Math.min(5, Number(n) || 0));

export function normalizeScorecard(raw: any) {
  const scores = [
    { dimension: "Technical Depth", score: clamp(raw.technicalDepth ?? raw.technical_depth ?? 3) },
    { dimension: "Communication", score: clamp(raw.communication ?? 3) },
    { dimension: "Problem Solving", score: clamp(raw.problemSolving ?? raw.problem_solving ?? 3) },
    { dimension: "Domain Knowledge", score: clamp(raw.domainKnowledge ?? raw.domain_knowledge ?? 3) },
    { dimension: "Culture Fit", score: clamp(raw.cultureFit ?? raw.culture_fit ?? 3) },
  ];

  return {
    scores,
    overall: clamp(raw.overall ?? 3),
    combinedScore: raw.combinedScore ?? null,
    atsScore: raw.atsScore ?? null,
    recommendation: raw.recommendation ?? "no_hire",
    overallAssessment: raw.summary ?? raw.overallAssessment ?? "No assessment available.",
    strengths: raw.strengths ?? [],
    weaknesses: raw.weaknesses ?? [],
    evidence: (raw.evidence ?? []).map((e: any) => ({
      dimension: e.dimension ?? "",
      quote: e.quote ?? "",
      assessment: e.assessment ?? "",
    })),
    proctoringNotes: raw.proctoringNotes ?? raw.proctoring_notes ?? "No issues detected.",
  };
}
