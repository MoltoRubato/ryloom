import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";
import { UAParser } from "ua-parser-js";
import { z } from "zod";

import {
  profiles,
  videos,
  videoShares,
  viewEvents,
  viewSessions,
  workspaceMembers,
  workspaceUsage,
} from "@ryloom/db";

import {
  ADMIN_ROLES,
  createTRPCRouter,
  getClientIp,
  hashIp,
  protectedProcedure,
  publicProcedure,
  requireMembership,
  requirePlanFeature,
  type Membership,
  type TRPCContext,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const VIEW_EVENT_TYPES = [
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
] as const;

/** Owner or workspace admin/content_admin access to a video's analytics. */
async function requireVideoAnalyticsAccess(
  ctx: TRPCContext & { user: NonNullable<TRPCContext["user"]> },
  videoId: string,
): Promise<{ video: typeof videos.$inferSelect; membership: Membership }> {
  const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video || video.status === "deleted") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  }
  const membership = await requireMembership(ctx, video.workspaceId);
  const isOwner = video.ownerId === ctx.user.id;
  const isAdmin = ADMIN_ROLES.includes(membership.role) || membership.role === "content_admin";
  if (!isOwner && !isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't view analytics for this video" });
  }
  return { video, membership };
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sessionsToCsv(
  rows: {
    videoId: string;
    videoTitle: string;
    sessionId: string;
    viewerName: string | null;
    viewerEmail: string | null;
    identityEmail: string | null;
    anonymousViewerId: string | null;
    watchMs: number;
    maxPlayheadMs: number;
    completed: boolean;
    device: string | null;
    browser: string | null;
    os: string | null;
    referrer: string | null;
    startedAt: Date;
  }[],
): string {
  const header = [
    "video_id",
    "video_title",
    "session_id",
    "viewer_name",
    "viewer_email",
    "identity_email",
    "anonymous_viewer_id",
    "watch_ms",
    "max_playhead_ms",
    "completed",
    "device",
    "browser",
    "os",
    "referrer",
    "started_at",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.videoId,
      r.videoTitle,
      r.sessionId,
      r.viewerName,
      r.viewerEmail,
      r.identityEmail,
      r.anonymousViewerId,
      r.watchMs,
      r.maxPlayheadMs,
      r.completed,
      r.device,
      r.browser,
      r.os,
      r.referrer,
      r.startedAt.toISOString(),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const analyticsRouter = createTRPCRouter({
  // ----- Viewer-side tracking (public) ---------------------------------------

  startSession: publicProcedure
    .input(
      z.object({
        videoId: z.string().uuid().optional(),
        shareToken: z.string().min(6).max(64).optional(),
        anonymousViewerId: z.string().min(8).max(100),
        identityEmail: z.string().email().optional(),
        referrer: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.videoId && !input.shareToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "videoId or shareToken is required" });
      }

      // Resolve the video. A share token (primary or extra link) grants public
      // tracking; a bare videoId requires an authed workspace member.
      let video: typeof videos.$inferSelect | undefined;
      let shareId: string | null = null;

      if (input.shareToken) {
        video = await ctx.db.query.videos.findFirst({
          where: eq(videos.shareToken, input.shareToken),
        });
        if (!video) {
          const link = await ctx.db.query.videoShares.findFirst({
            where: eq(videoShares.token, input.shareToken),
          });
          if (link && !link.revokedAt) {
            shareId = link.id;
            video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, link.videoId) });
          }
        }
      } else if (input.videoId) {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, input.videoId) });
        if (video) {
          await requireMembership({ db: ctx.db, user: ctx.user }, video.workspaceId);
        }
      }

      if (!video || video.status === "deleted") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      const ua = ctx.headers.get("user-agent") ?? "";
      const parsed = UAParser(ua);
      const device = parsed.device.type ?? "desktop";
      const browser = parsed.browser.name ?? null;
      const os = parsed.os.name ?? null;

      // Unique-viewer detection: same anonymous id (or same logged-in viewer)
      // having any prior session means this is a repeat viewer.
      const priorWhere = and(
        eq(viewSessions.videoId, video.id),
        ctx.user
          ? or(
              eq(viewSessions.viewerId, ctx.user.id),
              eq(viewSessions.anonymousViewerId, input.anonymousViewerId),
            )
          : eq(viewSessions.anonymousViewerId, input.anonymousViewerId),
      );
      const prior = await ctx.db
        .select({ id: viewSessions.id })
        .from(viewSessions)
        .where(priorWhere)
        .limit(1);
      const isNewViewer = prior.length === 0;

      const [session] = await ctx.db
        .insert(viewSessions)
        .values({
          videoId: video.id,
          shareId,
          viewerId: ctx.user?.id ?? null,
          anonymousViewerId: input.anonymousViewerId,
          identityEmail: input.identityEmail ?? ctx.user?.email ?? null,
          ipHash: hashIp(getClientIp(ctx.headers)),
          device,
          browser,
          os,
          referrer: input.referrer ?? ctx.headers.get("referer") ?? null,
          userAgent: ua.slice(0, 500) || null,
        })
        .returning({ id: viewSessions.id });
      if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await ctx.db
        .update(videos)
        .set(
          isNewViewer
            ? {
                viewCount: sql`${videos.viewCount} + 1`,
                uniqueViewerCount: sql`${videos.uniqueViewerCount} + 1`,
              }
            : { viewCount: sql`${videos.viewCount} + 1` },
        )
        .where(eq(videos.id, video.id));

      return { sessionId: session.id };
    }),

  trackEvent: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        eventType: z.enum(VIEW_EVENT_TYPES),
        playheadMs: z.number().int().nonnegative().optional(),
        watchDeltaMs: z
          .number()
          .int()
          .nonnegative()
          .max(10 * 60 * 1000)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.viewSessions.findFirst({
        where: eq(viewSessions.id, input.sessionId),
      });
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "View session not found" });
      }

      await ctx.db
        .update(viewSessions)
        .set({
          watchMs:
            input.watchDeltaMs && input.watchDeltaMs > 0
              ? sql`${viewSessions.watchMs} + ${input.watchDeltaMs}`
              : sql`${viewSessions.watchMs}`,
          maxPlayheadMs:
            input.playheadMs !== undefined
              ? sql`greatest(${viewSessions.maxPlayheadMs}, ${input.playheadMs})`
              : sql`${viewSessions.maxPlayheadMs}`,
          completed: input.eventType === "complete" ? true : session.completed,
          lastHeartbeatAt: new Date(),
        })
        .where(eq(viewSessions.id, session.id));

      // Heartbeats only refresh the session — they aren't discrete events.
      if (input.eventType !== "heartbeat") {
        await ctx.db.insert(viewEvents).values({
          videoId: session.videoId,
          sessionId: session.id,
          eventType: input.eventType,
          playheadMs: input.playheadMs ?? null,
        });
      }

      return { ok: true };
    }),

  // ----- Owner insights --------------------------------------------------------

  getVideoInsights: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { video, membership } = await requireVideoAnalyticsAccess(ctx, input.videoId);
      const durationMs = video.durationMs ?? 0;
      const viewerInsightsEnabled = membership.plan.viewerInsights;
      const engagementGraphEnabled = membership.plan.engagementGraph;

      const sessions = await ctx.db
        .select({
          id: viewSessions.id,
          viewerId: viewSessions.viewerId,
          anonymousViewerId: viewSessions.anonymousViewerId,
          identityEmail: viewSessions.identityEmail,
          watchMs: viewSessions.watchMs,
          maxPlayheadMs: viewSessions.maxPlayheadMs,
          completed: viewSessions.completed,
          startedAt: viewSessions.startedAt,
          lastHeartbeatAt: viewSessions.lastHeartbeatAt,
          viewerName: profiles.name,
          viewerEmail: profiles.email,
          viewerAvatarUrl: profiles.avatarUrl,
        })
        .from(viewSessions)
        .leftJoin(profiles, eq(viewSessions.viewerId, profiles.id))
        .where(eq(viewSessions.videoId, video.id))
        .orderBy(desc(viewSessions.startedAt));

      const totalSessions = sessions.length;

      // --- Per-viewer rollup (grouped by identity, falling back to anon id) ---
      type ViewerRollup = {
        key: string;
        name: string | null;
        email: string | null;
        avatarUrl: string | null;
        anonymous: boolean;
        watchPct: number;
        completed: boolean;
        lastViewedAt: Date;
        sessions: number;
      };
      const viewerMap = new Map<string, ViewerRollup>();
      for (const s of sessions) {
        const key = s.viewerId ?? s.identityEmail ?? s.anonymousViewerId ?? s.id;
        const watchPct =
          durationMs > 0 ? Math.min(100, Math.round((s.maxPlayheadMs / durationMs) * 100)) : 0;
        const existing = viewerMap.get(key);
        if (existing) {
          existing.watchPct = Math.max(existing.watchPct, watchPct);
          existing.completed = existing.completed || s.completed;
          if (s.lastHeartbeatAt > existing.lastViewedAt) existing.lastViewedAt = s.lastHeartbeatAt;
          existing.sessions += 1;
          existing.name ??= s.viewerName;
          existing.email ??= s.viewerEmail ?? s.identityEmail;
        } else {
          viewerMap.set(key, {
            key,
            name: s.viewerName,
            email: s.viewerEmail ?? s.identityEmail,
            avatarUrl: s.viewerAvatarUrl,
            anonymous: !s.viewerId && !s.identityEmail,
            watchPct,
            completed: s.completed,
            lastViewedAt: s.lastHeartbeatAt,
            sessions: 1,
          });
        }
      }
      const viewers = [...viewerMap.values()]
        .sort((a, b) => b.lastViewedAt.getTime() - a.lastViewedAt.getTime())
        .map((v, i) => ({
          ...v,
          label: v.anonymous ? `Anonymous viewer ${i + 1}` : (v.name ?? v.email ?? "Viewer"),
        }));

      // --- Aggregate watch metrics ---
      let watchPctSum = 0;
      let completedCount = 0;
      for (const s of sessions) {
        if (durationMs > 0) {
          watchPctSum += Math.min(1, s.watchMs / durationMs) * 100;
          if (s.completed || s.maxPlayheadMs >= durationMs * 0.95) completedCount += 1;
        } else if (s.completed) {
          completedCount += 1;
        }
      }
      const avgWatchPct = totalSessions > 0 ? Math.round(watchPctSum / totalSessions) : 0;
      const completionRate =
        totalSessions > 0 ? Math.round((completedCount / totalSessions) * 100) : 0;

      // --- Engagement timeline: 100 positional buckets, each = # of sessions
      //     whose max playhead reached at least that % of the video. ---
      const buckets = new Array<number>(100).fill(0);
      if (durationMs > 0) {
        for (const s of sessions) {
          const last = Math.min(99, Math.floor((s.maxPlayheadMs / durationMs) * 100));
          for (let i = 0; i <= last; i++) buckets[i] = (buckets[i] ?? 0) + 1;
        }
      }
      const engagementTimeline = buckets.map((count, i) => ({
        position: i,
        viewers: count,
        pct: totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0,
      }));

      // --- Event counts ---
      const [eventRow] = await ctx.db
        .select({
          ctaClicks: sql<number>`count(*) filter (where ${viewEvents.eventType} = 'cta_clicked')::int`,
          downloads: sql<number>`count(*) filter (where ${viewEvents.eventType} = 'download_clicked')::int`,
        })
        .from(viewEvents)
        .where(eq(viewEvents.videoId, video.id));

      // --- Views by day (last 30 days) ---
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const viewsByDay = await ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${viewSessions.startedAt}), 'YYYY-MM-DD')`,
          views: sql<number>`count(*)::int`,
        })
        .from(viewSessions)
        .where(and(eq(viewSessions.videoId, video.id), gte(viewSessions.startedAt, thirtyDaysAgo)))
        .groupBy(sql`date_trunc('day', ${viewSessions.startedAt})`)
        .orderBy(sql`date_trunc('day', ${viewSessions.startedAt})`);

      // --- Referrers / device & browser breakdowns ---
      const topReferrers = await ctx.db
        .select({ referrer: viewSessions.referrer, views: sql<number>`count(*)::int` })
        .from(viewSessions)
        .where(
          and(
            eq(viewSessions.videoId, video.id),
            isNotNull(viewSessions.referrer),
            ne(viewSessions.referrer, ""),
          ),
        )
        .groupBy(viewSessions.referrer)
        .orderBy(sql`count(*) desc`)
        .limit(10);

      const devices = await ctx.db
        .select({
          device: sql<string>`coalesce(${viewSessions.device}, 'unknown')`,
          views: sql<number>`count(*)::int`,
        })
        .from(viewSessions)
        .where(eq(viewSessions.videoId, video.id))
        .groupBy(sql`coalesce(${viewSessions.device}, 'unknown')`)
        .orderBy(sql`count(*) desc`);

      const browsers = await ctx.db
        .select({
          browser: sql<string>`coalesce(${viewSessions.browser}, 'unknown')`,
          views: sql<number>`count(*)::int`,
        })
        .from(viewSessions)
        .where(eq(viewSessions.videoId, video.id))
        .groupBy(sql`coalesce(${viewSessions.browser}, 'unknown')`)
        .orderBy(sql`count(*) desc`);

      return {
        totalViews: video.viewCount,
        uniqueViewers: viewerMap.size,
        avgWatchPct,
        completionRate,
        durationMs,
        viewerInsightsEnabled,
        engagementGraphEnabled,
        viewers: viewerInsightsEnabled ? viewers : [],
        engagementTimeline: engagementGraphEnabled ? engagementTimeline : [],
        eventCounts: {
          ctaClicks: eventRow?.ctaClicks ?? 0,
          downloads: eventRow?.downloads ?? 0,
          comments: video.commentCount,
          reactions: video.reactionCount,
        },
        viewsByDay,
        topReferrers,
        devices,
        browsers,
      };
    }),

  getWorkspaceInsights: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const mostViewedVideos = await ctx.db
        .select({
          id: videos.id,
          title: videos.title,
          viewCount: videos.viewCount,
          uniqueViewerCount: videos.uniqueViewerCount,
          durationMs: videos.durationMs,
          thumbnailUrl: videos.thumbnailUrl,
          customThumbnailUrl: videos.customThumbnailUrl,
          createdAt: videos.createdAt,
          owner: {
            id: profiles.id,
            name: profiles.name,
            email: profiles.email,
            avatarUrl: profiles.avatarUrl,
          },
        })
        .from(videos)
        .innerJoin(profiles, eq(videos.ownerId, profiles.id))
        .where(and(eq(videos.workspaceId, input.workspaceId), eq(videos.status, "ready")))
        .orderBy(desc(videos.viewCount))
        .limit(10);

      const mostActiveCreators = await ctx.db
        .select({
          userId: videos.ownerId,
          name: profiles.name,
          email: profiles.email,
          avatarUrl: profiles.avatarUrl,
          videosCreated: sql<number>`count(*)::int`,
          totalViews: sql<number>`coalesce(sum(${videos.viewCount}), 0)::int`,
        })
        .from(videos)
        .innerJoin(profiles, eq(videos.ownerId, profiles.id))
        .where(
          and(eq(videos.workspaceId, input.workspaceId), notInArray(videos.status, ["deleted"])),
        )
        .groupBy(videos.ownerId, profiles.id, profiles.name, profiles.email, profiles.avatarUrl)
        .orderBy(sql`count(*) desc`)
        .limit(10);

      const [watchRow] = await ctx.db
        .select({ totalWatchMs: sql<string>`coalesce(sum(${viewSessions.watchMs}), 0)` })
        .from(viewSessions)
        .innerJoin(videos, eq(viewSessions.videoId, videos.id))
        .where(eq(videos.workspaceId, input.workspaceId));

      const [storageRow] = await ctx.db
        .select({ storageBytes: sql<string>`coalesce(sum(${videos.sizeBytes}), 0)` })
        .from(videos)
        .where(
          and(eq(videos.workspaceId, input.workspaceId), notInArray(videos.status, ["deleted"])),
        );

      const countsByPrivacy = await ctx.db
        .select({ privacy: videos.privacy, count: sql<number>`count(*)::int` })
        .from(videos)
        .where(
          and(eq(videos.workspaceId, input.workspaceId), notInArray(videos.status, ["deleted"])),
        )
        .groupBy(videos.privacy);

      const members = await ctx.db
        .select({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.joinedAt,
          name: profiles.name,
          email: profiles.email,
          avatarUrl: profiles.avatarUrl,
        })
        .from(workspaceMembers)
        .innerJoin(profiles, eq(workspaceMembers.userId, profiles.id))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.status, "active"),
          ),
        );
      const recentCreators = await ctx.db
        .select({ ownerId: videos.ownerId })
        .from(videos)
        .where(
          and(
            eq(videos.workspaceId, input.workspaceId),
            gte(videos.createdAt, thirtyDaysAgo),
            notInArray(videos.status, ["deleted"]),
          ),
        )
        .groupBy(videos.ownerId);
      const recentCreatorIds = new Set(recentCreators.map((r) => r.ownerId));
      const inactiveMembers = members.filter((m) => !recentCreatorIds.has(m.userId));

      const period = new Date().toISOString().slice(0, 7);
      const aiUsage = await ctx.db.query.workspaceUsage.findFirst({
        where: and(
          eq(workspaceUsage.workspaceId, input.workspaceId),
          eq(workspaceUsage.period, period),
        ),
      });

      return {
        mostViewedVideos,
        mostActiveCreators,
        totalWatchMs: Number(watchRow?.totalWatchMs ?? 0),
        storageBytes: Number(storageRow?.storageBytes ?? 0),
        countsByPrivacy,
        inactiveMembers,
        aiUsage: aiUsage ?? {
          workspaceId: input.workspaceId,
          period,
          videosCreated: 0,
          storageBytes: 0,
          transcriptionSeconds: 0,
          aiGenerations: 0,
          updatedAt: new Date(),
        },
      };
    }),

  // ----- CSV export (plan-gated) -------------------------------------------------

  exportCsv: protectedProcedure
    .input(
      z
        .object({
          videoId: z.string().uuid().optional(),
          workspaceId: z.string().uuid().optional(),
        })
        .refine((v) => !!v.videoId || !!v.workspaceId, {
          message: "videoId or workspaceId is required",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      let where;
      if (input.videoId) {
        const { membership } = await requireVideoAnalyticsAccess(ctx, input.videoId);
        requirePlanFeature(membership, "exportAnalyticsCsv", "Analytics CSV export");
        where = eq(viewSessions.videoId, input.videoId);
      } else if (input.workspaceId) {
        const membership = await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
        requirePlanFeature(membership, "exportAnalyticsCsv", "Analytics CSV export");
        where = eq(videos.workspaceId, input.workspaceId);
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "videoId or workspaceId is required" });
      }

      const rows = await ctx.db
        .select({
          videoId: viewSessions.videoId,
          videoTitle: videos.title,
          sessionId: viewSessions.id,
          viewerName: profiles.name,
          viewerEmail: profiles.email,
          identityEmail: viewSessions.identityEmail,
          anonymousViewerId: viewSessions.anonymousViewerId,
          watchMs: viewSessions.watchMs,
          maxPlayheadMs: viewSessions.maxPlayheadMs,
          completed: viewSessions.completed,
          device: viewSessions.device,
          browser: viewSessions.browser,
          os: viewSessions.os,
          referrer: viewSessions.referrer,
          startedAt: viewSessions.startedAt,
        })
        .from(viewSessions)
        .innerJoin(videos, eq(viewSessions.videoId, videos.id))
        .leftJoin(profiles, eq(viewSessions.viewerId, profiles.id))
        .where(where)
        .orderBy(desc(viewSessions.startedAt))
        .limit(10000);

      return sessionsToCsv(rows);
    }),
});
