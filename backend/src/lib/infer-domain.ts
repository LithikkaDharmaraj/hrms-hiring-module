/**
 * Lightweight domain inference from job description / role text.
 * Used when an external ATS service (ATSv4) does not return a domain field.
 * Priority order matters — more specific patterns are checked first.
 */
export function inferDomain(text: string): string {
  const t = text.toLowerCase();

  if (/data\s*(science|engineer|analyst|pipeline|warehouse|lake)|machine learning|deep learning|\bml\b|\bai\b|nlp\b|llm\b|analytics|business intelligence|\bbi\b|tableau|power\s*bi|looker/.test(t))
    return "Data";

  if (/devops|site reliability|sre\b|cloud\s*(engineer|architect)|kubernetes|docker|\baws\b|\bazure\b|\bgcp\b|infrastructure|platform\s*engineer/.test(t))
    return "DevOps";

  if (/software engineer|backend|front.?end|full.?stack|developer|programmer|typescript|python|java\b|golang|rust\b|node\.?js|react\b|angular\b|spring\b/.test(t))
    return "Tech";

  if (/product manager|product owner|\bpm\b|product roadmap|user research|go.to.market|product strategy/.test(t))
    return "Product";

  if (/\bux\b|\bui\b|user experience|interaction design|visual design|figma|sketch|prototyp|wireframe/.test(t))
    return "Design";

  if (/\bsales\b|account executive|business development|\bbd\b|quota|pipeline|crm\b|salesforce|revenue target|cold call/.test(t))
    return "Sales";

  if (/marketing|seo\b|sem\b|content strateg|brand|paid ads|campaign|growth\s*hacker|demand gen/.test(t))
    return "Marketing";

  if (/\bhr\b|human resource|talent acquisition|recruiter|onboarding|payroll|hrbp|people ops|employee relation/.test(t))
    return "HR";

  if (/finance|accounting|cfo\b|audit|budget|forecast|tax\b|\bcpa\b|\bcfa\b|financial analyst|controller/.test(t))
    return "Finance";

  if (/operations|supply chain|logistics|procurement|warehouse|inventory|vendor management/.test(t))
    return "Operations";

  if (/customer success|customer support|\bcx\b|help desk|support engineer|service desk|client success/.test(t))
    return "Customer Success";

  if (/legal|compliance|counsel|paralegal|attorney|regulatory/.test(t))
    return "Legal";

  return "Other";
}
