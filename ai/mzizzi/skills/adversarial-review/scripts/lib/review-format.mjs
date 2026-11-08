// Review-only functions from openai/codex-plugin-cc, scripts/lib/render.mjs.
// Revision: db52e28f4d9ded852ab3942cea316258ae4ef346 (Apache-2.0).
// See ../../references/CODEX-LICENSE and ../../references/CODEX-NOTICE.

function severityRank(severity) {
  switch (severity) {
    case "critical": return 0;
    case "high": return 1;
    case "medium": return 2;
    default: return 3;
  }
}

function formatLineRange(finding) {
  if (!finding.line_start) return "";
  if (!finding.line_end || finding.line_end === finding.line_start) return `:${finding.line_start}`;
  return `:${finding.line_start}-${finding.line_end}`;
}

export function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Expected a top-level JSON object.";
  if (typeof data.verdict !== "string" || !data.verdict.trim()) return "Missing string `verdict`.";
  if (typeof data.summary !== "string" || !data.summary.trim()) return "Missing string `summary`.";
  if (!Array.isArray(data.findings)) return "Missing array `findings`.";
  if (!Array.isArray(data.next_steps)) return "Missing array `next_steps`.";
  return null;
}

function normalizeReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const lineStart = Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
  const lineEnd = Number.isInteger(source.line_end) && source.line_end > 0 && (!lineStart || source.line_end >= lineStart)
    ? source.line_end : lineStart;
  return {
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Finding ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "No details provided.",
    file: typeof source.file === "string" && source.file.trim() ? source.file.trim() : "unknown",
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: typeof source.recommendation === "string" ? source.recommendation.trim() : ""
  };
}

function normalizeReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((finding, index) => normalizeReviewFinding(finding, index)),
    next_steps: data.next_steps.filter((step) => typeof step === "string" && step.trim()).map((step) => step.trim())
  };
}

function appendReasoningSection(lines, reasoningSummary) {
  if (!Array.isArray(reasoningSummary) || reasoningSummary.length === 0) return;
  lines.push("", "Reasoning:");
  for (const section of reasoningSummary) lines.push(`- ${section}`);
}

export function renderReviewResult(parsedResult, meta) {
  if (!parsedResult.parsed) {
    const lines = [`# Codex ${meta.reviewLabel}`, "", "Codex did not return valid structured JSON.", "", `- Parse error: ${parsedResult.parseError}`];
    if (parsedResult.rawOutput) lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);
    return `${lines.join("\n").trimEnd()}\n`;
  }
  const validationError = validateReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines = [`# Codex ${meta.reviewLabel}`, "", `Target: ${meta.targetLabel}`, "Codex returned JSON with an unexpected review shape.", "", `- Validation error: ${validationError}`];
    if (parsedResult.rawOutput) lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);
    return `${lines.join("\n").trimEnd()}\n`;
  }
  const data = normalizeReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [`# Codex ${meta.reviewLabel}`, "", `Target: ${meta.targetLabel}`, `Verdict: ${data.verdict}`, "", data.summary, ""];
  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      lines.push(`  ${finding.body}`);
      if (finding.recommendation) lines.push(`  Recommendation: ${finding.recommendation}`);
    }
  }
  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) lines.push(`- ${step}`);
  }
  appendReasoningSection(lines, meta.reasoningSummary);
  return `${lines.join("\n").trimEnd()}\n`;
}
