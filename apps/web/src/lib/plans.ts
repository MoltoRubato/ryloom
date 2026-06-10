/**
 * Ryloom runs as an internal tool: there is a single plan with every feature
 * enabled and no usage limits. The PlanId union and helpers are kept so the
 * database enum and existing call sites stay valid, but every plan id resolves
 * to the same full-access limits.
 */

export type PlanId = "free" | "pro" | "business" | "business_ai" | "enterprise";

export type PlanLimits = {
  name: string;
  /** null = unlimited */
  maxVideos: number | null;
  /** per-recording cap in minutes; null = unlimited */
  maxRecordingMinutes: number | null;
  /** max transcode resolution height */
  maxResolution: 720 | 1080 | 2160;
  hlsStreaming: boolean;
  customThumbnails: boolean;
  passwordProtection: boolean;
  expiringLinks: boolean;
  domainRestriction: boolean;
  watermarkViewerEmail: boolean;
  disableDownloads: boolean;
  customBranding: boolean;
  removeRyloomBranding: boolean;
  folders: boolean;
  teamSpaces: boolean;
  viewerInsights: boolean;
  engagementGraph: boolean;
  exportAnalyticsCsv: boolean;
  /** transcription minutes per month; null = unlimited */
  transcriptionMinutesPerMonth: number | null;
  /** AI generations per month; 0 = none, null = unlimited */
  aiGenerationsPerMonth: number | null;
  aiWorkflows: boolean;
  silenceRemoval: boolean;
  fillerWordRemoval: boolean;
  trimStitch: boolean;
  editByTranscript: boolean;
  integrations: boolean;
  priorityProcessing: boolean;
  sso: boolean;
  scim: boolean;
  auditLogs: boolean;
  retentionPolicies: boolean;
  advancedAdminRoles: boolean;
  maxSeats: number | null;
};

const INTERNAL_PLAN: PlanLimits = {
  name: "Internal",
  maxVideos: null,
  maxRecordingMinutes: null,
  maxResolution: 2160,
  hlsStreaming: true,
  customThumbnails: true,
  passwordProtection: true,
  expiringLinks: true,
  domainRestriction: true,
  watermarkViewerEmail: true,
  disableDownloads: true,
  customBranding: true,
  removeRyloomBranding: true,
  folders: true,
  teamSpaces: true,
  viewerInsights: true,
  engagementGraph: true,
  exportAnalyticsCsv: true,
  transcriptionMinutesPerMonth: null,
  aiGenerationsPerMonth: null,
  aiWorkflows: true,
  silenceRemoval: true,
  fillerWordRemoval: true,
  trimStitch: true,
  editByTranscript: true,
  integrations: true,
  priorityProcessing: true,
  sso: true,
  scim: true,
  auditLogs: true,
  retentionPolicies: true,
  advancedAdminRoles: true,
  maxSeats: null,
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: INTERNAL_PLAN,
  pro: INTERNAL_PLAN,
  business: INTERNAL_PLAN,
  business_ai: INTERNAL_PLAN,
  enterprise: INTERNAL_PLAN,
};

export function getPlan(_plan: PlanId): PlanLimits {
  return INTERNAL_PLAN;
}

/** Ordered for upgrade comparisons (legacy call sites). */
export const PLAN_ORDER: PlanId[] = ["free", "pro", "business", "business_ai", "enterprise"];

export function planAtLeast(_current: PlanId, _required: PlanId): boolean {
  return true;
}

/** Every feature is available on the single internal plan. */
export function minimumPlanFor(_feature: keyof PlanLimits): PlanId {
  return "free";
}
