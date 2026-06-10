import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  folders,
  processingJobs,
  profiles,
  videoAssets,
  videoPermissions,
  videos,
  videoShares,
  watchLater,
  workspaces,
} from "@ryloom/db";

import { createPlaybackToken } from "@/lib/playback-token";
import { BUCKETS, createSignedUrl, deletePrefix } from "@/lib/storage";
import {
  ADMIN_ROLES,
  CREATOR_ROLES,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  requireMembership,
  requirePlanFeature,
  writeAuditLog,
  type Membership,
  type TRPCContext,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const videoIdInput = z.object({ videoId: z.string().uuid() });

async function getOwnedVideo(
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
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't manage this video" });
  }
  return { video, membership };
}

async function enqueueJob(
  ctx: TRPCContext,
  job: {
    videoId: string;
    workspaceId: string;
    type: (typeof processingJobs.$inferInsert)["type"];
    input?: Record<string, unknown>;
    priority?: number;
  },
) {
  await ctx.db.insert(processingJobs).values({
    videoId: job.videoId,
    workspaceId: job.workspaceId,
    type: job.type,
    inputJson: job.input ?? {},
    priority: job.priority ?? 0,
  });
}

/** Effective share settings: a share-link row overrides the video defaults. */
type EffectiveShare = {
  privacy: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  disabled: boolean;
  allowDownload: boolean;
  allowComments: boolean;
  allowReactions: boolean;
  allowTranscript: boolean;
  allowEmbed: boolean;
  domainRestriction: string[] | null;
  watermarkViewerEmail: boolean;
  shareId: string | null;
};

function effectiveShareSettings(
  video: typeof videos.$inferSelect,
  link: typeof videoShares.$inferSelect | null,
): EffectiveShare {
  if (link) {
    return {
      privacy: link.privacyType,
      passwordHash: link.passwordHash,
      expiresAt: link.expiresAt,
      disabled: link.revokedAt !== null,
      allowDownload: link.allowDownload && video.allowDownload,
      allowComments: link.allowComments && video.allowComments,
      allowReactions: link.allowReactions && video.allowReactions,
      allowTranscript: link.allowTranscript && video.allowTranscript,
      allowEmbed: link.allowEmbed && video.allowEmbed,
      domainRestriction: link.domainRestriction ?? video.domainRestriction,
      watermarkViewerEmail: link.watermarkViewerEmail || video.watermarkViewerEmail,
      shareId: link.id,
    };
  }
  return {
    privacy: video.privacy,
    passwordHash: video.passwordHash,
    expiresAt: video.linkExpiresAt,
    disabled: video.linkDisabled,
    allowDownload: video.allowDownload,
    allowComments: video.allowComments,
    allowReactions: video.allowReactions,
    allowTranscript: video.allowTranscript,
    allowEmbed: video.allowEmbed,
    domainRestriction: video.domainRestriction,
    watermarkViewerEmail: video.watermarkViewerEmail,
    shareId: null,
  };
}

const editableFields = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  allowDownload: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  allowReactions: z.boolean().optional(),
  allowTranscript: z.boolean().optional(),
  allowEmbed: z.boolean().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  cta: z
    .object({
      label: z.string().min(1).max(80),
      url: z.string().url(),
      color: z.string().max(20).optional(),
      showAtMs: z.number().int().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
  chapters: z
    .array(z.object({ title: z.string().min(1).max(200), startMs: z.number().int().nonnegative() }))
    .max(100)
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const videoRouter = createTRPCRouter({
  // ----- Library ------------------------------------------------------------

  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        view: z
          .enum([
            "my_videos",
            "workspace",
            "shared_with_me",
            "drafts",
            "archived",
            "trash",
            "watch_later",
            "recent",
            "popular",
          ])
          .default("my_videos"),
        folderId: z.string().uuid().nullish(),
        cursor: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(60).default(24),
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId);
      const base = and(
        eq(videos.workspaceId, input.workspaceId),
        input.folderId ? eq(videos.folderId, input.folderId) : undefined,
      );

      let where;
      switch (input.view) {
        case "my_videos":
          where = and(
            base,
            eq(videos.ownerId, ctx.user.id),
            inArray(videos.status, ["draft", "uploading", "processing", "ready", "failed"]),
          );
          break;
        case "drafts":
          where = and(
            base,
            eq(videos.ownerId, ctx.user.id),
            inArray(videos.status, ["draft", "uploading", "failed"]),
          );
          break;
        case "workspace":
        case "recent":
        case "popular":
          where = and(
            base,
            inArray(videos.status, ["processing", "ready"]),
            // Workspace views only show videos shared at workspace level or wider,
            // plus the caller's own.
            or(
              inArray(videos.privacy, ["workspace", "public", "password"]),
              eq(videos.ownerId, ctx.user.id),
            ),
          );
          break;
        case "archived":
          where = and(base, eq(videos.status, "archived"), eq(videos.ownerId, ctx.user.id));
          break;
        case "trash":
          where = and(base, eq(videos.status, "deleted"), eq(videos.ownerId, ctx.user.id));
          break;
        case "shared_with_me": {
          const grants = await ctx.db
            .select({ videoId: videoPermissions.videoId })
            .from(videoPermissions)
            .where(
              or(
                eq(videoPermissions.userId, ctx.user.id),
                eq(videoPermissions.email, ctx.user.email),
              ),
            );
          const ids = grants.map((g) => g.videoId);
          if (ids.length === 0) return { items: [], nextCursor: null, total: 0 };
          where = and(inArray(videos.id, ids), inArray(videos.status, ["processing", "ready"]));
          break;
        }
        case "watch_later": {
          const saved = await ctx.db
            .select({ videoId: watchLater.videoId })
            .from(watchLater)
            .where(eq(watchLater.userId, ctx.user.id));
          const ids = saved.map((s) => s.videoId);
          if (ids.length === 0) return { items: [], nextCursor: null, total: 0 };
          where = and(inArray(videos.id, ids), inArray(videos.status, ["processing", "ready"]));
          break;
        }
      }

      const orderBy =
        input.view === "popular" ? desc(videos.viewCount) : desc(videos.createdAt);

      const items = await ctx.db
        .select({
          video: videos,
          owner: { id: profiles.id, name: profiles.name, avatarUrl: profiles.avatarUrl, email: profiles.email },
        })
        .from(videos)
        .innerJoin(profiles, eq(videos.ownerId, profiles.id))
        .where(where)
        .orderBy(orderBy)
        .limit(input.limit + 1)
        .offset(input.cursor);

      const hasMore = items.length > input.limit;
      void membership;
      return {
        items: items.slice(0, input.limit),
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  // ----- Single video (authenticated owner/member view) ----------------------

  get: protectedProcedure.input(videoIdInput).query(async ({ ctx, input }) => {
    const video = await ctx.db.query.videos.findFirst({
      where: eq(videos.id, input.videoId),
      with: {
        owner: { columns: { id: true, name: true, avatarUrl: true, email: true } },
        folder: true,
        assets: true,
      },
    });
    if (!video || video.status === "deleted") {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const membership = await requireMembership(ctx, video.workspaceId);
    const isOwner = video.ownerId === ctx.user.id;
    const isPrivileged = isOwner || ADMIN_ROLES.includes(membership.role);
    if (video.privacy === "private" && !isPrivileged) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This video is private" });
    }

    const mp4Url = video.playbackUrl
      ? await createSignedUrl(BUCKETS.processed, video.playbackUrl)
      : null;
    const playbackToken = video.hlsUrl ? createPlaybackToken(video.id) : null;

    return {
      video,
      isOwner,
      canEdit: isPrivileged,
      role: membership.role,
      planId: membership.planId,
      playback: {
        mp4Url,
        hlsUrl: video.hlsUrl ? `/api/hls/${video.id}/master.m3u8?t=${playbackToken}` : null,
        captionsUrl: video.captionsUrl,
        thumbnailUrl: video.customThumbnailUrl ?? video.thumbnailUrl,
      },
    };
  }),

  // ----- Public share access --------------------------------------------------

  getByShareToken: publicProcedure
    .input(
      z.object({
        token: z.string().min(6).max(64),
        password: z.string().max(200).optional(),
        viewerEmail: z.string().email().optional(),
        embed: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Primary token on the video, else an extra share link.
      let video = await ctx.db.query.videos.findFirst({
        where: eq(videos.shareToken, input.token),
      });
      let link: typeof videoShares.$inferSelect | null = null;
      if (!video) {
        link =
          (await ctx.db.query.videoShares.findFirst({
            where: eq(videoShares.token, input.token),
          })) ?? null;
        if (link) {
          video =
            (await ctx.db.query.videos.findFirst({ where: eq(videos.id, link.videoId) })) ??
            undefined;
        }
      }
      if (!video || video.status === "deleted" || video.status === "archived") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      const share = effectiveShareSettings(video, link);
      if (share.disabled) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This link has been disabled" });
      }
      if (share.expiresAt && share.expiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This link has expired" });
      }
      if (input.embed && !share.allowEmbed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Embedding is disabled for this video" });
      }

      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, video.workspaceId),
      });
      const owner = await ctx.db.query.profiles.findFirst({
        where: eq(profiles.id, video.ownerId),
        columns: { id: true, name: true, avatarUrl: true, email: true },
      });

      const viewerIsOwner = ctx.user?.id === video.ownerId;
      const viewerEmail = ctx.user?.email ?? input.viewerEmail ?? null;

      // --- Privacy gate ---
      if (!viewerIsOwner) {
        switch (share.privacy) {
          case "private": {
            throw new TRPCError({ code: "FORBIDDEN", message: "This video is private" });
          }
          case "workspace": {
            if (!ctx.user) return { state: "auth_required" as const, title: video.title };
            await requireMembership({ db: ctx.db, user: ctx.user }, video.workspaceId);
            break;
          }
          case "specific": {
            if (!ctx.user) return { state: "auth_required" as const, title: video.title };
            const grant = await ctx.db.query.videoPermissions.findFirst({
              where: and(
                eq(videoPermissions.videoId, video.id),
                or(
                  eq(videoPermissions.userId, ctx.user.id),
                  eq(videoPermissions.email, ctx.user.email),
                ),
              ),
            });
            if (!grant) {
              // Workspace admins can always view
              try {
                await requireMembership({ db: ctx.db, user: ctx.user }, video.workspaceId, ADMIN_ROLES);
              } catch {
                throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this video" });
              }
            }
            break;
          }
          case "password": {
            if (!share.passwordHash) break;
            if (!input.password) {
              return { state: "password_required" as const, title: video.title };
            }
            const ok = await bcrypt.compare(input.password, share.passwordHash);
            if (!ok) {
              throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect password" });
            }
            break;
          }
          case "public":
            break;
        }

        // --- Viewer identity / domain restriction ---
        const needsIdentity =
          video.requireViewerIdentity ||
          workspace?.requireViewerIdentity ||
          (share.domainRestriction?.length ?? 0) > 0;
        if (needsIdentity && !viewerEmail) {
          return { state: "identity_required" as const, title: video.title };
        }
        if (share.domainRestriction?.length && viewerEmail) {
          const domain = viewerEmail.split("@")[1]?.toLowerCase();
          const allowed = share.domainRestriction.map((d) => d.toLowerCase().replace(/^@/, ""));
          if (!domain || !allowed.includes(domain)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "This video is restricted to specific email domains",
            });
          }
        }
      }

      if (video.status !== "ready") {
        return {
          state: "processing" as const,
          title: video.title,
          status: video.status,
          thumbnailUrl: video.customThumbnailUrl ?? video.thumbnailUrl,
        };
      }

      const mp4Url = video.playbackUrl
        ? await createSignedUrl(BUCKETS.processed, video.playbackUrl)
        : null;
      const downloadUrl =
        share.allowDownload && video.originalFilePath
          ? await createSignedUrl(BUCKETS.processed, video.playbackUrl ?? "", 60 * 30)
          : null;
      const playbackToken = video.hlsUrl ? createPlaybackToken(video.id) : null;

      return {
        state: "ok" as const,
        video: {
          id: video.id,
          title: video.title,
          description: video.description,
          durationMs: video.durationMs,
          width: video.width,
          height: video.height,
          createdAt: video.createdAt,
          viewCount: video.viewCount,
          chapters: video.chapters,
          cta: video.cta,
          shareToken: video.shareToken,
        },
        playback: {
          mp4Url,
          hlsUrl: video.hlsUrl ? `/api/hls/${video.id}/master.m3u8?t=${playbackToken}` : null,
          captionsUrl: share.allowTranscript ? video.captionsUrl : null,
          thumbnailUrl: video.customThumbnailUrl ?? video.thumbnailUrl,
          downloadUrl,
        },
        permissions: {
          canComment: share.allowComments,
          canReact: share.allowReactions,
          canViewTranscript: share.allowTranscript,
          canDownload: share.allowDownload,
        },
        owner: owner ? { name: owner.name, avatarUrl: owner.avatarUrl } : null,
        workspace: workspace
          ? {
              name: workspace.name,
              logoUrl: workspace.logoUrl,
              brandColor: workspace.brandColor,
              hideBranding: workspace.hideBranding,
            }
          : null,
        watermarkEmail: share.watermarkViewerEmail ? viewerEmail : null,
        shareId: share.shareId,
        viewerIsOwner,
      };
    }),

  // ----- Mutations ------------------------------------------------------------

  update: protectedProcedure
    .input(videoIdInput.merge(editableFields))
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);
      const { videoId: _videoId, ...fields } = input;

      if (fields.folderId) {
        const folder = await ctx.db.query.folders.findFirst({
          where: and(eq(folders.id, fields.folderId), eq(folders.workspaceId, video.workspaceId)),
        });
        if (!folder) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found" });
      }
      if (fields.allowDownload === false) {
        requirePlanFeature(membership, "disableDownloads", "Disabling downloads");
      }

      const [updated] = await ctx.db
        .update(videos)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(videos.id, input.videoId))
        .returning();
      return updated;
    }),

  updatePrivacy: protectedProcedure
    .input(
      videoIdInput.extend({
        privacy: z.enum(["private", "workspace", "specific", "public", "password"]),
        password: z.string().min(4).max(200).optional(),
        linkExpiresAt: z.date().nullable().optional(),
        linkDisabled: z.boolean().optional(),
        domainRestriction: z.array(z.string().max(100)).max(20).nullable().optional(),
        requireViewerIdentity: z.boolean().optional(),
        watermarkViewerEmail: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);

      if (input.privacy === "password") {
        requirePlanFeature(membership, "passwordProtection", "Password protection");
        if (!input.password && !video.passwordHash) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A password is required" });
        }
      }
      if (input.linkExpiresAt) requirePlanFeature(membership, "expiringLinks", "Expiring links");
      if (input.domainRestriction?.length)
        requirePlanFeature(membership, "domainRestriction", "Domain restrictions");
      if (input.watermarkViewerEmail)
        requirePlanFeature(membership, "watermarkViewerEmail", "Viewer email watermark");

      const passwordHash = input.password
        ? await bcrypt.hash(input.password, 10)
        : input.privacy === "password"
          ? video.passwordHash
          : null;

      const [updated] = await ctx.db
        .update(videos)
        .set({
          privacy: input.privacy,
          passwordHash,
          linkExpiresAt: input.linkExpiresAt === undefined ? video.linkExpiresAt : input.linkExpiresAt,
          linkDisabled: input.linkDisabled ?? video.linkDisabled,
          domainRestriction:
            input.domainRestriction === undefined ? video.domainRestriction : input.domainRestriction,
          requireViewerIdentity: input.requireViewerIdentity ?? video.requireViewerIdentity,
          watermarkViewerEmail: input.watermarkViewerEmail ?? video.watermarkViewerEmail,
          updatedAt: new Date(),
        })
        .where(eq(videos.id, input.videoId))
        .returning();

      await writeAuditLog(ctx.db, {
        workspaceId: video.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "video.privacy_changed",
        targetType: "video",
        targetId: video.id,
        metadata: { from: video.privacy, to: input.privacy },
        headers: ctx.headers,
      });
      return updated;
    }),

  moveToFolder: protectedProcedure
    .input(videoIdInput.extend({ folderId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { video } = await getOwnedVideo(ctx, input.videoId);
      if (input.folderId) {
        const folder = await ctx.db.query.folders.findFirst({
          where: and(eq(folders.id, input.folderId), eq(folders.workspaceId, video.workspaceId)),
        });
        if (!folder) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found" });
      }
      await ctx.db
        .update(videos)
        .set({ folderId: input.folderId, updatedAt: new Date() })
        .where(eq(videos.id, input.videoId));
      return { ok: true };
    }),

  archive: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    await ctx.db
      .update(videos)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(videos.id, video.id));
    return { ok: true };
  }),

  unarchive: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    if (video.status !== "archived") throw new TRPCError({ code: "BAD_REQUEST" });
    await ctx.db
      .update(videos)
      .set({ status: "ready", archivedAt: null, updatedAt: new Date() })
      .where(eq(videos.id, video.id));
    return { ok: true };
  }),

  delete: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    await ctx.db
      .update(videos)
      .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(videos.id, video.id));
    await writeAuditLog(ctx.db, {
      workspaceId: video.workspaceId,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "video.deleted",
      targetType: "video",
      targetId: video.id,
      metadata: { title: video.title },
      headers: ctx.headers,
    });
    return { ok: true };
  }),

  restore: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, input.videoId) });
    if (!video || video.status !== "deleted") throw new TRPCError({ code: "NOT_FOUND" });
    const membership = await requireMembership(ctx, video.workspaceId);
    if (video.ownerId !== ctx.user.id && !ADMIN_ROLES.includes(membership.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    await ctx.db
      .update(videos)
      .set({ status: "ready", deletedAt: null, updatedAt: new Date() })
      .where(eq(videos.id, video.id));
    return { ok: true };
  }),

  deleteForever: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, input.videoId) });
    if (!video) throw new TRPCError({ code: "NOT_FOUND" });
    const membership = await requireMembership(ctx, video.workspaceId);
    if (video.ownerId !== ctx.user.id && !ADMIN_ROLES.includes(membership.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    if (membership.workspace.legalHold) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This workspace is under a legal hold — content cannot be permanently deleted",
      });
    }
    const prefix = `workspaces/${video.workspaceId}/videos/${video.id}`;
    await Promise.all([
      deletePrefix(BUCKETS.raw, `${prefix}/raw`),
      deletePrefix(BUCKETS.processed, `${prefix}/processed`),
      deletePrefix(BUCKETS.thumbnails, `${prefix}/thumbs`),
      deletePrefix(BUCKETS.captions, `${prefix}/captions`),
    ]);
    await ctx.db.delete(videos).where(eq(videos.id, video.id));
    return { ok: true };
  }),

  // ----- Share links -----------------------------------------------------------

  createShareLink: protectedProcedure
    .input(
      videoIdInput.extend({
        label: z.string().max(100).optional(),
        privacyType: z.enum(["public", "password"]).default("public"),
        password: z.string().min(4).max(200).optional(),
        expiresAt: z.date().nullable().optional(),
        allowDownload: z.boolean().default(true),
        allowComments: z.boolean().default(true),
        allowReactions: z.boolean().default(true),
        allowTranscript: z.boolean().default(true),
        allowEmbed: z.boolean().default(true),
        domainRestriction: z.array(z.string().max(100)).max(20).nullable().optional(),
        watermarkViewerEmail: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);
      if (input.privacyType === "password") {
        requirePlanFeature(membership, "passwordProtection", "Password protection");
        if (!input.password) throw new TRPCError({ code: "BAD_REQUEST", message: "Password required" });
      }
      if (input.expiresAt) requirePlanFeature(membership, "expiringLinks", "Expiring links");
      if (input.domainRestriction?.length)
        requirePlanFeature(membership, "domainRestriction", "Domain restrictions");

      const [created] = await ctx.db
        .insert(videoShares)
        .values({
          videoId: video.id,
          label: input.label,
          privacyType: input.privacyType,
          passwordHash: input.password ? await bcrypt.hash(input.password, 10) : null,
          expiresAt: input.expiresAt ?? null,
          allowDownload: input.allowDownload,
          allowComments: input.allowComments,
          allowReactions: input.allowReactions,
          allowTranscript: input.allowTranscript,
          allowEmbed: input.allowEmbed,
          domainRestriction: input.domainRestriction ?? null,
          watermarkViewerEmail: input.watermarkViewerEmail,
          createdBy: ctx.user.id,
        })
        .returning();

      await writeAuditLog(ctx.db, {
        workspaceId: video.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "share_link.created",
        targetType: "video",
        targetId: video.id,
        headers: ctx.headers,
      });
      return created;
    }),

  listShareLinks: protectedProcedure.input(videoIdInput).query(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    return ctx.db.query.videoShares.findMany({
      where: and(eq(videoShares.videoId, video.id), isNull(videoShares.revokedAt)),
      orderBy: desc(videoShares.createdAt),
    });
  }),

  revokeShareLink: protectedProcedure
    .input(z.object({ shareId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.db.query.videoShares.findFirst({
        where: eq(videoShares.id, input.shareId),
      });
      if (!link) throw new TRPCError({ code: "NOT_FOUND" });
      const { video } = await getOwnedVideo(ctx, link.videoId);
      await ctx.db
        .update(videoShares)
        .set({ revokedAt: new Date() })
        .where(eq(videoShares.id, input.shareId));
      await writeAuditLog(ctx.db, {
        workspaceId: video.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "share_link.revoked",
        targetType: "video",
        targetId: video.id,
        headers: ctx.headers,
      });
      return { ok: true };
    }),

  // ----- Specific-people permissions --------------------------------------------

  addPermission: protectedProcedure
    .input(
      videoIdInput.extend({
        email: z.string().email(),
        role: z.enum(["viewer", "commenter", "editor"]).default("viewer"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { video } = await getOwnedVideo(ctx, input.videoId);
      const targetUser = await ctx.db.query.profiles.findFirst({
        where: eq(profiles.email, input.email.toLowerCase()),
      });
      const [created] = await ctx.db
        .insert(videoPermissions)
        .values({
          videoId: video.id,
          userId: targetUser?.id ?? null,
          email: input.email.toLowerCase(),
          role: input.role,
          createdBy: ctx.user.id,
        })
        .returning();
      return created;
    }),

  listPermissions: protectedProcedure.input(videoIdInput).query(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    return ctx.db.query.videoPermissions.findMany({
      where: eq(videoPermissions.videoId, video.id),
      with: { user: { columns: { id: true, name: true, avatarUrl: true, email: true } } },
    });
  }),

  removePermission: protectedProcedure
    .input(z.object({ permissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await ctx.db.query.videoPermissions.findFirst({
        where: eq(videoPermissions.id, input.permissionId),
      });
      if (!perm) throw new TRPCError({ code: "NOT_FOUND" });
      await getOwnedVideo(ctx, perm.videoId);
      await ctx.db.delete(videoPermissions).where(eq(videoPermissions.id, input.permissionId));
      return { ok: true };
    }),

  // ----- Watch later --------------------------------------------------------------

  toggleWatchLater: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db.query.watchLater.findFirst({
      where: and(eq(watchLater.userId, ctx.user.id), eq(watchLater.videoId, input.videoId)),
    });
    if (existing) {
      await ctx.db
        .delete(watchLater)
        .where(and(eq(watchLater.userId, ctx.user.id), eq(watchLater.videoId, input.videoId)));
      return { saved: false };
    }
    await ctx.db.insert(watchLater).values({ userId: ctx.user.id, videoId: input.videoId });
    return { saved: true };
  }),

  // ----- Editing operations (worker jobs) ------------------------------------------

  requestTrim: protectedProcedure
    .input(
      videoIdInput.extend({
        /** Keep-ranges in ms; everything outside is cut. Supports middle cuts. */
        keepRanges: z
          .array(z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }))
          .min(1)
          .max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);
      requirePlanFeature(membership, "trimStitch", "Trimming");
      if (video.status !== "ready") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Video must finish processing first" });
      }
      await ctx.db.update(videos).set({ status: "processing" }).where(eq(videos.id, video.id));
      await enqueueJob(ctx, {
        videoId: video.id,
        workspaceId: video.workspaceId,
        type: "trim",
        input: { keepRanges: input.keepRanges },
        priority: membership.plan.priorityProcessing ? 10 : 0,
      });
      return { ok: true };
    }),

  requestSilenceRemoval: protectedProcedure
    .input(
      videoIdInput.extend({
        /** Silence threshold in dB (negative) and minimum silence duration. */
        thresholdDb: z.number().min(-60).max(-10).default(-35),
        minSilenceMs: z.number().int().min(300).max(5000).default(900),
        paddingMs: z.number().int().min(0).max(500).default(150),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);
      requirePlanFeature(membership, "silenceRemoval", "Automatic silence removal");
      if (video.status !== "ready") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Video must finish processing first" });
      }
      await ctx.db.update(videos).set({ status: "processing" }).where(eq(videos.id, video.id));
      await enqueueJob(ctx, {
        videoId: video.id,
        workspaceId: video.workspaceId,
        type: "silence_removal",
        input: {
          thresholdDb: input.thresholdDb,
          minSilenceMs: input.minSilenceMs,
          paddingMs: input.paddingMs,
        },
        priority: membership.plan.priorityProcessing ? 10 : 0,
      });
      return { ok: true };
    }),

  requestFillerRemoval: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const { video, membership } = await getOwnedVideo(ctx, input.videoId);
    requirePlanFeature(membership, "fillerWordRemoval", "Filler word removal");
    if (video.status !== "ready") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Video must finish processing first" });
    }
    await ctx.db.update(videos).set({ status: "processing" }).where(eq(videos.id, video.id));
    await enqueueJob(ctx, {
      videoId: video.id,
      workspaceId: video.workspaceId,
      type: "filler_removal",
      priority: membership.plan.priorityProcessing ? 10 : 0,
    });
    return { ok: true };
  }),

  requestStitch: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        /** Videos to concatenate, in order. A new video is created. */
        videoIds: z.array(z.string().uuid()).min(2).max(10),
        title: z.string().min(1).max(300).default("Stitched video"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, CREATOR_ROLES);
      requirePlanFeature(membership, "trimStitch", "Stitching");
      const sources = await ctx.db.query.videos.findMany({
        where: and(inArray(videos.id, input.videoIds), eq(videos.workspaceId, input.workspaceId)),
      });
      if (sources.length !== input.videoIds.length || sources.some((v) => v.status !== "ready")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "All source videos must be ready" });
      }
      const [created] = await ctx.db
        .insert(videos)
        .values({
          workspaceId: input.workspaceId,
          ownerId: ctx.user.id,
          title: input.title,
          status: "processing",
          privacy: membership.workspace.defaultPrivacy,
        })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await enqueueJob(ctx, {
        videoId: created.id,
        workspaceId: input.workspaceId,
        type: "stitch",
        input: { sourceVideoIds: input.videoIds },
        priority: membership.plan.priorityProcessing ? 10 : 0,
      });
      return created;
    }),

  revertToOriginal: protectedProcedure.input(videoIdInput).mutation(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    const backup = await ctx.db.query.videoAssets.findFirst({
      where: and(eq(videoAssets.videoId, video.id), eq(videoAssets.type, "original_backup")),
      orderBy: desc(videoAssets.createdAt),
    });
    if (!backup) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No original backup exists for this video" });
    }
    await ctx.db.update(videos).set({ status: "processing" }).where(eq(videos.id, video.id));
    await enqueueJob(ctx, {
      videoId: video.id,
      workspaceId: video.workspaceId,
      type: "transcode",
      input: { sourceBucket: backup.storageBucket, sourcePath: backup.storagePath, revert: true },
    });
    return { ok: true };
  }),

  setCustomThumbnail: protectedProcedure
    .input(videoIdInput.extend({ storagePath: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { video, membership } = await getOwnedVideo(ctx, input.videoId);
      if (input.storagePath) requirePlanFeature(membership, "customThumbnails", "Custom thumbnails");
      const { publicUrl } = await import("@/lib/storage");
      await ctx.db
        .update(videos)
        .set({
          customThumbnailUrl: input.storagePath
            ? publicUrl(BUCKETS.thumbnails, input.storagePath)
            : null,
          updatedAt: new Date(),
        })
        .where(eq(videos.id, video.id));
      return { ok: true };
    }),

  requestDownloadUrl: protectedProcedure.input(videoIdInput).query(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    if (!video.playbackUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Not processed yet" });
    const url = await createSignedUrl(BUCKETS.processed, video.playbackUrl, 60 * 30);
    await writeAuditLog(ctx.db, {
      workspaceId: video.workspaceId,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "video.downloaded",
      targetType: "video",
      targetId: video.id,
      headers: ctx.headers,
    });
    return { url };
  }),

  /** Owner polling while the worker processes. */
  getProcessingStatus: protectedProcedure.input(videoIdInput).query(async ({ ctx, input }) => {
    const { video } = await getOwnedVideo(ctx, input.videoId);
    const jobs = await ctx.db.query.processingJobs.findMany({
      where: eq(processingJobs.videoId, video.id),
      orderBy: desc(processingJobs.createdAt),
      limit: 10,
    });
    return { status: video.status, error: video.processingError, jobs };
  }),

  /** Empty trash: permanently delete videos soft-deleted more than 30 days ago. */
  purgeOldTrash: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      if (membership.workspace.legalHold) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Workspace is under legal hold" });
      }
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const old = await ctx.db.query.videos.findMany({
        where: and(
          eq(videos.workspaceId, input.workspaceId),
          eq(videos.status, "deleted"),
          isNotNull(videos.deletedAt),
          lt(videos.deletedAt, cutoff),
        ),
        columns: { id: true, workspaceId: true },
      });
      for (const v of old) {
        const prefix = `workspaces/${v.workspaceId}/videos/${v.id}`;
        await Promise.all([
          deletePrefix(BUCKETS.raw, `${prefix}/raw`),
          deletePrefix(BUCKETS.processed, `${prefix}/processed`),
          deletePrefix(BUCKETS.thumbnails, `${prefix}/thumbs`),
          deletePrefix(BUCKETS.captions, `${prefix}/captions`),
        ]);
        await ctx.db.delete(videos).where(eq(videos.id, v.id));
      }
      return { purged: old.length };
    }),

  /** Lightweight workspace stats for the library sidebar. */
  counts: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId);
      const [row] = await ctx.db
        .select({
          mine: sql<number>`count(*) filter (where ${videos.ownerId} = ${ctx.user.id} and ${videos.status} in ('ready','processing','draft','uploading','failed'))`,
          archived: sql<number>`count(*) filter (where ${videos.ownerId} = ${ctx.user.id} and ${videos.status} = 'archived')`,
          trash: sql<number>`count(*) filter (where ${videos.ownerId} = ${ctx.user.id} and ${videos.status} = 'deleted')`,
        })
        .from(videos)
        .where(eq(videos.workspaceId, input.workspaceId));
      return row ?? { mine: 0, archived: 0, trash: 0 };
    }),
});
