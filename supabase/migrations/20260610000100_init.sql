CREATE TYPE "public"."ai_output_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_output_type" AS ENUM('title', 'summary', 'long_summary', 'chapters', 'action_items', 'bug_report', 'sop', 'email_draft', 'slack_message', 'pr_description', 'jira_issue', 'linear_issue', 'faq', 'meeting_notes', 'recap_email', 'doc');--> statement-breakpoint
CREATE TYPE "public"."api_token_type" AS ENUM('scim', 'api');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('raw', 'mp4', 'hls', 'audio', 'thumbnail', 'gif', 'captions_vtt', 'captions_srt', 'waveform', 'preview', 'export', 'original_backup');--> statement-breakpoint
CREATE TYPE "public"."comment_status" AS ENUM('open', 'resolved', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."integration_type" AS ENUM('slack', 'jira', 'linear', 'github', 'notion', 'zapier', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('probe', 'transcode', 'thumbnail', 'gif_preview', 'waveform', 'hls', 'transcribe', 'ai_generate', 'trim', 'stitch', 'silence_removal', 'filler_removal', 'burn_captions', 'export', 'retention_sweep');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('comment', 'reply', 'mention', 'reaction', 'video_viewed', 'video_ready', 'video_failed', 'workspace_invite', 'member_joined', 'ai_ready', 'system');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'business', 'business_ai', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."recording_mode" AS ENUM('screen', 'camera', 'screen_camera', 'audio');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('created', 'recording', 'uploading', 'completed', 'canceled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');--> statement-breakpoint
CREATE TYPE "public"."transcript_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_privacy" AS ENUM('private', 'workspace', 'specific', 'public', 'password');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('draft', 'uploading', 'processing', 'ready', 'failed', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."view_event_type" AS ENUM('video_loaded', 'play', 'pause', 'seek', 'progress_25', 'progress_50', 'progress_75', 'complete', 'cta_clicked', 'comment_created', 'reaction_added', 'download_clicked', 'heartbeat');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'viewer', 'guest', 'billing_admin', 'content_admin', 'compliance_admin');--> statement-breakpoint
CREATE TABLE "ai_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"type" "ai_output_type" NOT NULL,
	"status" "ai_output_status" DEFAULT 'pending' NOT NULL,
	"model" text,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"input_transcript_hash" text,
	"content_json" jsonb,
	"content_text" text,
	"cost_estimate_cents" integer,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "api_token_type" DEFAULT 'api' NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"author_id" uuid,
	"guest_name" text,
	"guest_email" text,
	"parent_comment_id" uuid,
	"timestamp_ms" integer,
	"body" text NOT NULL,
	"status" "comment_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"emoji" text,
	"color" text,
	"is_space" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "integration_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"actor_id" uuid,
	"workspace_id" uuid,
	"video_id" uuid,
	"comment_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid,
	"workspace_id" uuid,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"input_json" jsonb DEFAULT '{}'::jsonb,
	"output_json" jsonb DEFAULT '{}'::jsonb,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"timezone" text DEFAULT 'UTC',
	"default_workspace_id" uuid,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"user_id" uuid,
	"anonymous_id" text,
	"emoji" text NOT NULL,
	"timestamp_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"video_id" uuid,
	"mode" "recording_mode" DEFAULT 'screen' NOT NULL,
	"status" "recording_status" DEFAULT 'created' NOT NULL,
	"upload_bucket" text DEFAULT 'raw-recordings' NOT NULL,
	"upload_path" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_price_id" text,
	"plan" "plan" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript_id" uuid NOT NULL,
	"idx" integer DEFAULT 0 NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker_label" text,
	"text" text NOT NULL,
	"confidence" integer,
	"words" jsonb
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"provider" text DEFAULT 'openai-whisper' NOT NULL,
	"status" "transcript_status" DEFAULT 'pending' NOT NULL,
	"full_text" text,
	"vtt_path" text,
	"srt_path" text,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"type" "asset_type" NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"label" text,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"token" text DEFAULT encode(extensions.gen_random_bytes(12), 'hex') NOT NULL,
	"label" text,
	"privacy_type" "video_privacy" DEFAULT 'public' NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone,
	"allow_download" boolean DEFAULT true NOT NULL,
	"allow_comments" boolean DEFAULT true NOT NULL,
	"allow_reactions" boolean DEFAULT true NOT NULL,
	"allow_transcript" boolean DEFAULT true NOT NULL,
	"allow_embed" boolean DEFAULT true NOT NULL,
	"domain_restriction" text[],
	"watermark_viewer_email" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" text DEFAULT 'Untitled video' NOT NULL,
	"description" text,
	"status" "video_status" DEFAULT 'draft' NOT NULL,
	"privacy" "video_privacy" DEFAULT 'private' NOT NULL,
	"password_hash" text,
	"share_token" text DEFAULT encode(extensions.gen_random_bytes(12), 'hex') NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps" integer,
	"size_bytes" bigint,
	"original_file_path" text,
	"thumbnail_url" text,
	"animated_thumbnail_url" text,
	"custom_thumbnail_url" text,
	"playback_url" text,
	"hls_url" text,
	"captions_url" text,
	"waveform_url" text,
	"allow_download" boolean DEFAULT true NOT NULL,
	"allow_comments" boolean DEFAULT true NOT NULL,
	"allow_reactions" boolean DEFAULT true NOT NULL,
	"allow_transcript" boolean DEFAULT true NOT NULL,
	"allow_embed" boolean DEFAULT true NOT NULL,
	"require_viewer_identity" boolean DEFAULT false NOT NULL,
	"watermark_viewer_email" boolean DEFAULT false NOT NULL,
	"link_expires_at" timestamp with time zone,
	"link_disabled" boolean DEFAULT false NOT NULL,
	"domain_restriction" text[],
	"cta" jsonb,
	"chapters" jsonb,
	"tags" text[],
	"view_count" integer DEFAULT 0 NOT NULL,
	"unique_viewer_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	"processing_error" text,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" "view_event_type" NOT NULL,
	"playhead_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"share_id" uuid,
	"viewer_id" uuid,
	"anonymous_viewer_id" text,
	"identity_email" text,
	"watch_ms" integer DEFAULT 0 NOT NULL,
	"max_playhead_ms" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"ip_hash" text,
	"country" text,
	"device" text,
	"browser" text,
	"os" text,
	"referrer" text,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_later" (
	"user_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_later_user_id_video_id_pk" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_usage" (
	"workspace_id" uuid NOT NULL,
	"period" text NOT NULL,
	"videos_created" integer DEFAULT 0 NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"transcription_seconds" integer DEFAULT 0 NOT NULL,
	"ai_generations" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_usage_workspace_id_period_pk" PRIMARY KEY("workspace_id","period")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"brand_color" text DEFAULT '#625DF5',
	"hide_branding" boolean DEFAULT false NOT NULL,
	"default_privacy" "video_privacy" DEFAULT 'workspace' NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"allowed_email_domains" text[],
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"sso_provider_id" text,
	"retention_days" integer,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"session_duration_hours" integer,
	"require_viewer_identity" boolean DEFAULT false NOT NULL,
	"watermark_viewer_email" boolean DEFAULT false NOT NULL,
	"disable_downloads_default" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"stripe_customer_id" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_requested_by_profiles_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_permissions" ADD CONSTRAINT "video_permissions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_permissions" ADD CONSTRAINT "video_permissions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_permissions" ADD CONSTRAINT "video_permissions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_shares" ADD CONSTRAINT "video_shares_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_shares" ADD CONSTRAINT "video_shares_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_events" ADD CONSTRAINT "view_events_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_events" ADD CONSTRAINT "view_events_session_id_view_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."view_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_share_id_video_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."video_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_viewer_id_profiles_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_later" ADD CONSTRAINT "watch_later_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_later" ADD CONSTRAINT "watch_later_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_outputs_video_idx" ON "ai_outputs" USING btree ("video_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_workspace_idx" ON "api_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_video_idx" ON "comments" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "folders_workspace_idx" ON "folders" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "integrations_workspace_idx" ON "integrations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_status_idx" ON "processing_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_video_idx" ON "processing_jobs" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_idx" ON "profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "reactions_video_idx" ON "reactions" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "recording_sessions_user_idx" ON "recording_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recording_sessions_video_idx" ON "recording_sessions" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_sub_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_workspace_idx" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_transcript_idx" ON "transcript_segments" USING btree ("transcript_id","idx");--> statement-breakpoint
CREATE INDEX "transcripts_video_idx" ON "transcripts" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "video_assets_video_idx" ON "video_assets" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "video_permissions_video_idx" ON "video_permissions" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_shares_token_idx" ON "video_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "video_shares_video_idx" ON "video_shares" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_share_token_idx" ON "videos" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "videos_workspace_idx" ON "videos" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "videos_owner_idx" ON "videos" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "videos_folder_idx" ON "videos" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "view_events_video_idx" ON "view_events" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX "view_events_session_idx" ON "view_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "view_sessions_video_idx" ON "view_sessions" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "view_sessions_started_idx" ON "view_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_token_idx" ON "workspace_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_idx" ON "workspace_invites" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_invites_email_idx" ON "workspace_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");