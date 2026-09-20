import type { Profile, SchemeMatch } from "@sahayak/shared";

export const CATALOG_NOTICE = "Illustrative prefilter only—not an eligibility decision. Check current official rules, exclusions, location and application dates. This small catalog must be updated before real use.";

export function matchSchemes(profile: Profile): SchemeMatch[] {
  const result: SchemeMatch[] = [];
  const baseMissing = [!profile.state?.trim() ? "state" : "", profile.annualIncome === undefined ? "annualIncome" : ""].filter(Boolean);
  if ((profile.occupation === undefined || profile.occupation === "farmer") && profile.ownsFarmland !== false) {
    const missing = [...baseMissing, ...(profile.occupation === undefined ? ["occupation"] : []), ...(profile.ownsFarmland === undefined ? ["ownsFarmland"] : [])];
    result.push({
      id: "pm-kisan", title: "PM-KISAN", status: missing.length ? "needs-details" : "potential-match",
      reason: "A lead for landholding farmer families. Land records and official exclusion criteria require verification; owning land does not establish eligibility.",
      officialUrl: "https://pmkisan.gov.in/", missingDetails: missing
    });
  }
  if (profile.occupation === undefined || profile.occupation === "student") {
    const missing = [...baseMissing, ...(profile.occupation === undefined ? ["occupation"] : []), ...(profile.age === undefined ? ["age"] : [])];
    result.push({
      id: "national-scholarship-portal", title: "National Scholarship Portal",
      status: missing.length ? "needs-details" : "potential-match",
      reason: "A directory of scholarship opportunities, not a single scheme. Course, institution, category, income limits and application windows differ by scholarship.",
      officialUrl: "https://scholarships.gov.in/", missingDetails: [...missing, "course and institution", "selected scholarship criteria"]
    });
    result[result.length - 1].status = "needs-details";
  }
  if (profile.occupation === undefined || profile.occupation === "self-employed") {
    result.push({
      id: "mudra", title: "Pradhan Mantri MUDRA Yojana", status: "needs-details",
      reason: "A financing lead for qualifying micro-enterprises, not a grant or loan approval. Business activity and lender requirements must be checked.",
      officialUrl: "https://www.mudra.org.in/", missingDetails: [...baseMissing, "business activity", "lender assessment"]
    });
  }
  return result;
}
