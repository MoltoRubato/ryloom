/**
 * Plan matrix — the single source of truth for feature gating.
 * Mirrors Loom's tiers: Free ("Starter"), Pro ("Business"-lite), Business,
 * Business + AI, Enterprise.
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
  /** AI generations per month (summaries, chapters, docs…); 0 = none, null = unlimited */
  aiGenerationsPerMonth: number | null;
  aiWorkflows: boolean; // video-to-doc, video-to-ticket, recap email…
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

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    name: "Starter",
    maxVideos: 25,
    maxRecordingMinutes: 5,
    maxResolution: 720,
    hlsStreaming: false,
    customThumbnails: false,
    passwordProtection: false,
    expiringLinks: false,
    domainRestriction: false,
    watermarkViewerEmail: false,
    disableDownloads: false,
    customBranding: false,
    removeRyloomBranding: false,
    folders: false,
    teamSpaces: false,
    viewerInsights: false,
    engagementGraph: false,
    exportAnalyticsCsv: false,
    transcriptionMinutesPerMonth: 60,
    aiGenerationsPerMonth: 5,
    aiWorkflows: false,
    silenceRemoval: false,
    fillerWordRemoval: false,
    trimStitch: true, // basic start/end trim is free
    editByTranscript: false,
    integrations: false,
    priorityProcessing: false,
    sso: false,
    scim: false,
    auditLogs: false,
    retentionPolicies: false,
    advancedAdminRoles: false,
    maxSeats: 50,
  },
  pro: {
    name: "Pro",
    maxVideos: null,
    maxRecordingMinutes: null,
    maxResolution: 1080,
    hlsStreaming: true,
    customThumbnails: true,
    passwordProtection: true,
    expiringLinks: true,
    domainRestriction: false,
    watermarkViewerEmail: false,
    disableDownloads: true,
    customBranding: false,
    removeRyloomBranding: false,
    folders: true,
    teamSpaces: false,
    viewerInsights: true,
    engagementGraph: true,
    exportAnalyticsCsv: false,
    transcriptionMinutesPerMonth: 300,
    aiGenerationsPerMonth: 25,
    aiWorkflows: false,
    silenceRemoval: false,
    fillerWordRemoval: false,
    trimStitch: true,
    editByTranscript: false,
    integrations: false,
    priorityProcessing: false,
    sso: false,
    scim: false,
    auditLogs: false,
    retentionPolicies: false,
    advancedAdminRoles: false,
    maxSeats: 100,
  },
  business: {
    name: "Business",
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
    aiGenerationsPerMonth: 50,
    aiWorkflows: false,
    silenceRemoval: true,
    fillerWordRemoval: false,
    trimStitch: true,
    editByTranscript: false,
    integrations: true,
    priorityProcessing: true,
    sso: false,
    scim: false,
    auditLogs: false,
    retentionPolicies: false,
    advancedAdminRoles: false,
    maxSeats: null,
  },
  business_ai: {
    name: "Business + AI",
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
    sso: false,
    scim: false,
    auditLogs: false,
    retentionPolicies: false,
    advancedAdminRoles: false,
    maxSeats: null,
  },
  enterprise: {
    name: "Enterprise",
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
  },
};

export function getPlan(plan: PlanId): PlanLimits {
  return PLANS[plan];
}

/** Ordered for upgrade comparisons. */
export const PLAN_ORDER: PlanId[] = ["free", "pro", "business", "business_ai", "enterprise"];

export function planAtLeast(current: PlanId, required: PlanId): boolean {
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(required);
}

/** Lowest plan that has a given boolean feature enabled. */
export function minimumPlanFor(feature: keyof PlanLimits): PlanId {
  for (const id of PLAN_ORDER) {
    const v = PLANS[id][feature];
    if (v === true || v === null) return id;
  }
  return "enterprise";
}
