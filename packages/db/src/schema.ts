import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "viewer",
  "guest",
  "billing_admin",
  "content_admin",
  "compliance_admin",
]);

export const memberStatusEnum = pgEnum("member_status", [
  "active",
  "invited",
  "suspended",
]);

export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const planEnum = pgEnum("plan", [
  "free",
  "pro",
  "business",
  "business_ai",
  "enterprise",
]);

export const videoStatusEnum = pgEnum("video_status", [
  "draft",
  "uploading",
  "processing",
  "ready",
  "failed",
  "archived",
  "deleted",
]);

export const videoPrivacyEnum = pgEnum("video_privacy", [
  "private",
  "workspace",
  "specific",
  "public",
  "password",
]);

export const assetTypeEnum = pgEnum("asset_type", [
  "raw",
  "mp4",
  "hls",
  "audio",
  "thumbnail",
  "gif",
  "captions_vtt",
  "captions_srt",
  "waveform",
  "preview",
  "export",
  "original_backup",
]);

export const assetStatusEnum = pgEnum("asset_status", [
  "pending",
  "ready",
  "failed",
  "deleted",
]);

export const recordingModeEnum = pgEnum("recording_mode", [
  "screen",
  "camera",
  "screen_camera",
  "audio",
]);

export const recordingStatusEnum = pgEnum("recording_status", [
  "created",
  "recording",
  "uploading",
  "completed",
  "canceled",
  "failed",
]);

export const jobTypeEnum = pgEnum("job_type", [
  "probe",
  "transcode",
  "thumbnail",
  "gif_preview",
  "waveform",
  "hls",
  "transcribe",
  "ai_generate",
  "trim",
  "stitch",
  "silence_removal",
  "filler_removal",
  "burn_captions",
  "export",
  "retention_sweep",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);

export const transcriptStatusEnum = pgEnum("transcript_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const aiOutputTypeEnum = pgEnum("ai_output_type", [
  "title",
  "summary",
  "long_summary",
  "chapters",
  "action_items",
  "bug_report",
  "sop",
  "email_draft",
  "slack_message",
  "pr_description",
  "jira_issue",
  "linear_issue",
  "faq",
  "meeting_notes",
  "recap_email",
  "doc",
]);

export const aiOutputStatusEnum = pgEnum("ai_output_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const commentStatusEnum = pgEnum("comment_status", [
  "open",
  "resolved",
  "deleted",
]);

export const viewEventTypeEnum = pgEnum("view_event_type", [
  "video_loaded",
  "play",
  "pause",
  "seek",
  "progress_25",
  "progress_50",
  "progress_75",
  "complete",
  "cta_clicked",
  "comment_created",
  "reaction_added",
  "download_clicked",
  "heartbeat",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "comment",
  "reply",
  "mention",
  "reaction",
  "video_viewed",
  "video_ready",
  "video_failed",
  "workspace_invite",
  "member_joined",
  "ai_ready",
  "system",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

export const integrationTypeEnum = pgEnum("integration_type", [
  "slack",
  "jira",
  "linear",
  "github",
  "notion",
  "zapier",
  "webhook",
]);

export const apiTokenTypeEnum = pgEnum("api_token_type", ["scim", "api"]);

// ---------------------------------------------------------------------------
// Users / profiles  (profiles.id === auth.users.id, created by trigger)
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(), // mirrors auth.users.id
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    timezone: text("timezone").default("UTC"),
    defaultWorkspaceId: uuid("default_workspace_id"),
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [uniqueIndex("profiles_email_idx").on(t.email)],
);

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    brandColor: text("brand_color").default("#625DF5"),
    hideBranding: boolean("hide_branding").notNull().default(false),
    defaultPrivacy: videoPrivacyEnum("default_privacy").notNull().default("workspace"),
    plan: planEnum("plan").notNull().default("free"),
    // Enterprise controls
    allowedEmailDomains: text("allowed_email_domains").array(),
    enforceSso: boolean("enforce_sso").notNull().default(false),
    ssoProviderId: text("sso_provider_id"),
    retentionDays: integer("retention_days"), // null = keep forever
    legalHold: boolean("legal_hold").notNull().default(false),
    sessionDurationHours: integer("session_duration_hours"),
    requireViewerIdentity: boolean("require_viewer_identity").notNull().default(false),
    watermarkViewerEmail: boolean("watermark_viewer_email").notNull().default(false),
    disableDownloadsDefault: boolean("disable_downloads_default").notNull().default(false),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    stripeCustomerId: text("stripe_customer_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    status: memberStatusEnum("status").notNull().default("active"),
    invitedBy: uuid("invited_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    token: text("token").notNull(),
    status: inviteStatusEnum("status").notNull().default("pending"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("workspace_invites_token_idx").on(t.token),
    index("workspace_invites_workspace_idx").on(t.workspaceId),
    index("workspace_invites_email_idx").on(t.email),
  ],
);

// ---------------------------------------------------------------------------
// Folders / Spaces
// ---------------------------------------------------------------------------

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    emoji: text("emoji"),
    color: text("color"),
    // A "space" is a top-level team library section; a folder lives inside one.
    isSpace: boolean("is_space").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("folders_workspace_idx").on(t.workspaceId)],
);

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export type VideoChapter = { title: string; startMs: number };
export type VideoCta = {
  label: string;
  url: string;
  color?: string;
  showAtMs?: number | null;
};

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default("Untitled video"),
    description: text("description"),
    status: videoStatusEnum("status").notNull().default("draft"),
    privacy: videoPrivacyEnum("privacy").notNull().default("private"),
    passwordHash: text("password_hash"),
    // Primary share token — every video gets one; extra links live in video_shares.
    shareToken: text("share_token")
      .notNull()
      .default(sql`encode(gen_random_bytes(12), 'hex')`),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    fps: integer("fps"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    originalFilePath: text("original_file_path"),
    thumbnailUrl: text("thumbnail_url"),
    animatedThumbnailUrl: text("animated_thumbnail_url"),
    customThumbnailUrl: text("custom_thumbnail_url"),
    playbackUrl: text("playback_url"),
    hlsUrl: text("hls_url"),
    captionsUrl: text("captions_url"),
    waveformUrl: text("waveform_url"),
    allowDownload: boolean("allow_download").notNull().default(true),
    allowComments: boolean("allow_comments").notNull().default(true),
    allowReactions: boolean("allow_reactions").notNull().default(true),
    allowTranscript: boolean("allow_transcript").notNull().default(true),
    allowEmbed: boolean("allow_embed").notNull().default(true),
    requireViewerIdentity: boolean("require_viewer_identity").notNull().default(false),
    watermarkViewerEmail: boolean("watermark_viewer_email").notNull().default(false),
    linkExpiresAt: timestamp("link_expires_at", { withTimezone: true }),
    linkDisabled: boolean("link_disabled").notNull().default(false),
    domainRestriction: text("domain_restriction").array(),
    cta: jsonb("cta").$type<VideoCta | null>(),
    chapters: jsonb("chapters").$type<VideoChapter[] | null>(),
    tags: text("tags").array(),
    viewCount: integer("view_count").notNull().default(0),
    uniqueViewerCount: integer("unique_viewer_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    reactionCount: integer("reaction_count").notNull().default(0),
    sourceUrl: text("source_url"), // tab URL captured by the recorder/extension
    processingError: text("processing_error"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("videos_share_token_idx").on(t.shareToken),
    index("videos_workspace_idx").on(t.workspaceId),
    index("videos_owner_idx").on(t.ownerId),
    index("videos_folder_idx").on(t.folderId),
    index("videos_status_idx").on(t.status),
    index("videos_created_at_idx").on(t.createdAt),
  ],
);

export const videoAssets = pgTable(
  "video_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    type: assetTypeEnum("type").notNull(),
    storageBucket: text("storage_bucket").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    label: text("label"), // e.g. "1080p", "720p", "en"
    status: assetStatusEnum("status").notNull().default("pending"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("video_assets_video_idx").on(t.videoId)],
);

// Specific-people access grants (privacy = "specific")
export const videoPermissions = pgTable(
  "video_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    email: text("email"),
    role: text("role").notNull().default("viewer"), // viewer | commenter | editor
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("video_permissions_video_idx").on(t.videoId)],
);

// Additional share links beyond the primary token
export const videoShares = pgTable(
  "video_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    token: text("token")
      .notNull()
      .default(sql`encode(gen_random_bytes(12), 'hex')`),
    label: text("label"),
    privacyType: videoPrivacyEnum("privacy_type").notNull().default("public"),
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    allowDownload: boolean("allow_download").notNull().default(true),
    allowComments: boolean("allow_comments").notNull().default(true),
    allowReactions: boolean("allow_reactions").notNull().default(true),
    allowTranscript: boolean("allow_transcript").notNull().default(true),
    allowEmbed: boolean("allow_embed").notNull().default(true),
    domainRestriction: text("domain_restriction").array(),
    watermarkViewerEmail: boolean("watermark_viewer_email").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("video_shares_token_idx").on(t.token),
    index("video_shares_video_idx").on(t.videoId),
  ],
);

// Personal "watch later" list
export const watchLater = pgTable(
  "watch_later",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.videoId] })],
);

// ---------------------------------------------------------------------------
// Recording sessions & processing jobs
// ---------------------------------------------------------------------------

export const recordingSessions = pgTable(
  "recording_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "set null" }),
    mode: recordingModeEnum("mode").notNull().default("screen"),
    status: recordingStatusEnum("status").notNull().default("created"),
    uploadBucket: text("upload_bucket").notNull().default("raw-recordings"),
    uploadPath: text("upload_path").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("recording_sessions_user_idx").on(t.userId),
    index("recording_sessions_video_idx").on(t.videoId),
  ],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0), // higher first
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorMessage: text("error_message"),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>().default({}),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>().default({}),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("processing_jobs_status_idx").on(t.status, t.scheduledAt),
    index("processing_jobs_video_idx").on(t.videoId),
  ],
);

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    language: text("language").notNull().default("en"),
    provider: text("provider").notNull().default("openai-whisper"),
    status: transcriptStatusEnum("status").notNull().default("pending"),
    fullText: text("full_text"),
    vttPath: text("vtt_path"),
    srtPath: text("srt_path"),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("transcripts_video_idx").on(t.videoId)],
);

export type TranscriptWord = { word: string; startMs: number; endMs: number };

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transcriptId: uuid("transcript_id")
      .notNull()
      .references(() => transcripts.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull().default(0),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speakerLabel: text("speaker_label"),
    text: text("text").notNull(),
    confidence: integer("confidence"), // 0-100
    words: jsonb("words").$type<TranscriptWord[] | null>(),
  },
  (t) => [index("transcript_segments_transcript_idx").on(t.transcriptId, t.idx)],
);

// ---------------------------------------------------------------------------
// AI outputs
// ---------------------------------------------------------------------------

export const aiOutputs = pgTable(
  "ai_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    type: aiOutputTypeEnum("type").notNull(),
    status: aiOutputStatusEnum("status").notNull().default("pending"),
    model: text("model"),
    promptVersion: text("prompt_version").notNull().default("v1"),
    inputTranscriptHash: text("input_transcript_hash"),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>(),
    contentText: text("content_text"),
    costEstimateCents: integer("cost_estimate_cents"),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    errorMessage: text("error_message"),
    requestedBy: uuid("requested_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("ai_outputs_video_idx").on(t.videoId, t.type)],
);

// ---------------------------------------------------------------------------
// Comments & reactions
// ---------------------------------------------------------------------------

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    guestName: text("guest_name"),
    guestEmail: text("guest_email"),
    parentCommentId: uuid("parent_comment_id"),
    timestampMs: integer("timestamp_ms"),
    body: text("body").notNull(),
    status: commentStatusEnum("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("comments_video_idx").on(t.videoId),
    index("comments_parent_idx").on(t.parentCommentId),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    anonymousId: text("anonymous_id"),
    emoji: text("emoji").notNull(),
    timestampMs: integer("timestamp_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("reactions_video_idx").on(t.videoId)],
);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const viewSessions = pgTable(
  "view_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    shareId: uuid("share_id").references(() => videoShares.id, {
      onDelete: "set null",
    }),
    viewerId: uuid("viewer_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    anonymousViewerId: text("anonymous_viewer_id"),
    identityEmail: text("identity_email"),
    watchMs: integer("watch_ms").notNull().default(0),
    maxPlayheadMs: integer("max_playhead_ms").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    ipHash: text("ip_hash"),
    country: text("country"),
    device: text("device"),
    browser: text("browser"),
    os: text("os"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("view_sessions_video_idx").on(t.videoId),
    index("view_sessions_started_idx").on(t.startedAt),
  ],
);

export const viewEvents = pgTable(
  "view_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => viewSessions.id, { onDelete: "cascade" }),
    eventType: viewEventTypeEnum("event_type").notNull(),
    playheadMs: integer("playhead_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("view_events_video_idx").on(t.videoId, t.createdAt),
    index("view_events_session_idx").on(t.sessionId),
  ],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Audit logs (enterprise)
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(), // e.g. "video.privacy_changed"
    targetType: text("target_type"), // video | user | workspace | share_link | ...
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("audit_logs_workspace_idx").on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripePriceId: text("stripe_price_id"),
    plan: planEnum("plan").notNull(),
    status: subscriptionStatusEnum("status").notNull(),
    seats: integer("seats").notNull().default(1),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
    index("subscriptions_workspace_idx").on(t.workspaceId),
  ],
);

// Monthly usage rollup per workspace (period = "YYYY-MM")
export const workspaceUsage = pgTable(
  "workspace_usage",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    videosCreated: integer("videos_created").notNull().default(0),
    storageBytes: bigint("storage_bytes", { mode: "number" }).notNull().default(0),
    transcriptionSeconds: integer("transcription_seconds").notNull().default(0),
    aiGenerations: integer("ai_generations").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.period] })],
);

// ---------------------------------------------------------------------------
// Integrations & API tokens (SCIM etc.)
// ---------------------------------------------------------------------------

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: integrationTypeEnum("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("integrations_workspace_idx").on(t.workspaceId)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: apiTokenTypeEnum("type").notNull().default("api"),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(), // first 8 chars for display
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_idx").on(t.tokenHash),
    index("api_tokens_workspace_idx").on(t.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const profilesRelations = relations(profiles, ({ many }) => ({
  memberships: many(workspaceMembers),
  videos: many(videos),
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  members: many(workspaceMembers),
  invites: many(workspaceInvites),
  folders: many(folders),
  videos: many(videos),
  subscriptions: many(subscriptions),
  creator: one(profiles, {
    fields: [workspaces.createdBy],
    references: [profiles.id],
  }),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(profiles, {
    fields: [workspaceMembers.userId],
    references: [profiles.id],
  }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [folders.workspaceId],
    references: [workspaces.id],
  }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: "folder_parent",
  }),
  children: many(folders, { relationName: "folder_parent" }),
  videos: many(videos),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [videos.workspaceId],
    references: [workspaces.id],
  }),
  owner: one(profiles, {
    fields: [videos.ownerId],
    references: [profiles.id],
  }),
  folder: one(folders, {
    fields: [videos.folderId],
    references: [folders.id],
  }),
  assets: many(videoAssets),
  shares: many(videoShares),
  permissions: many(videoPermissions),
  transcripts: many(transcripts),
  aiOutputs: many(aiOutputs),
  comments: many(comments),
  reactions: many(reactions),
  viewSessions: many(viewSessions),
}));

export const videoAssetsRelations = relations(videoAssets, ({ one }) => ({
  video: one(videos, { fields: [videoAssets.videoId], references: [videos.id] }),
}));

export const videoSharesRelations = relations(videoShares, ({ one }) => ({
  video: one(videos, { fields: [videoShares.videoId], references: [videos.id] }),
}));

export const videoPermissionsRelations = relations(videoPermissions, ({ one }) => ({
  video: one(videos, {
    fields: [videoPermissions.videoId],
    references: [videos.id],
  }),
  user: one(profiles, {
    fields: [videoPermissions.userId],
    references: [profiles.id],
  }),
}));

export const transcriptsRelations = relations(transcripts, ({ one, many }) => ({
  video: one(videos, { fields: [transcripts.videoId], references: [videos.id] }),
  segments: many(transcriptSegments),
}));

export const transcriptSegmentsRelations = relations(transcriptSegments, ({ one }) => ({
  transcript: one(transcripts, {
    fields: [transcriptSegments.transcriptId],
    references: [transcripts.id],
  }),
}));

export const aiOutputsRelations = relations(aiOutputs, ({ one }) => ({
  video: one(videos, { fields: [aiOutputs.videoId], references: [videos.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  video: one(videos, { fields: [comments.videoId], references: [videos.id] }),
  author: one(profiles, { fields: [comments.authorId], references: [profiles.id] }),
  parent: one(comments, {
    fields: [comments.parentCommentId],
    references: [comments.id],
    relationName: "comment_replies",
  }),
  replies: many(comments, { relationName: "comment_replies" }),
}));

export const reactionsRelations = relations(reactions, ({ one }) => ({
  video: one(videos, { fields: [reactions.videoId], references: [videos.id] }),
  user: one(profiles, { fields: [reactions.userId], references: [profiles.id] }),
}));

export const viewSessionsRelations = relations(viewSessions, ({ one, many }) => ({
  video: one(videos, { fields: [viewSessions.videoId], references: [videos.id] }),
  viewer: one(profiles, {
    fields: [viewSessions.viewerId],
    references: [profiles.id],
  }),
  events: many(viewEvents),
}));

export const viewEventsRelations = relations(viewEvents, ({ one }) => ({
  session: one(viewSessions, {
    fields: [viewEvents.sessionId],
    references: [viewSessions.id],
  }),
  video: one(videos, { fields: [viewEvents.videoId], references: [videos.id] }),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  video: one(videos, { fields: [processingJobs.videoId], references: [videos.id] }),
}));

export const recordingSessionsRelations = relations(recordingSessions, ({ one }) => ({
  video: one(videos, {
    fields: [recordingSessions.videoId],
    references: [videos.id],
  }),
  user: one(profiles, {
    fields: [recordingSessions.userId],
    references: [profiles.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(profiles, { fields: [notifications.userId], references: [profiles.id] }),
  actor: one(profiles, { fields: [notifications.actorId], references: [profiles.id] }),
  video: one(videos, { fields: [notifications.videoId], references: [videos.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [auditLogs.workspaceId],
    references: [workspaces.id],
  }),
  actor: one(profiles, { fields: [auditLogs.actorId], references: [profiles.id] }),
}));
