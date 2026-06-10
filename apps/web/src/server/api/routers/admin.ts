import { createHash } from "crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  apiTokens,
  auditLogs,
  integrations,
  profiles,
  videos,
  workspaceMembers,
  workspaceUsage,
} from "@ryloom/db";

import {
  ADMIN_ROLES,
  createTRPCRouter,
  protectedProcedure,
  requireMembership,
  requirePlanFeature,
  writeAuditLog,
  type WorkspaceRole,
} from "@/server/api/trpc";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Roles that can read/export the audit log. */
const AUDIT_ROLES: WorkspaceRole[] = ["owner", "admin", "compliance_admin"];
/** Roles that can view usage & billing rollups. */
const USAGE_ROLES: WorkspaceRole[] = ["owner", "admin", "billing_admin"];

const INTEGRATION_TYPES = [
  "slack",
  "jira",
  "linear",
  "github",
  "notion",
  "zapier",
  "webhook",
] as const;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminRouter = createTRPCRouter({
  // ----- Audit log ------------------------------------------------------------

  getAuditLogs: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        cursor: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(100).default(50),
        action: z.string().max(100).optional(),
        actorId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, AUDIT_ROLES);
      requirePlanFeature(membership, "auditLogs", "Audit logs");

      const rows = await ctx.db
        .select({
          log: auditLogs,
          actor: {
            id: profiles.id,
            name: profiles.name,
            email: profiles.email,
            avatarUrl: profiles.avatarUrl,
          },
        })
        .from(auditLogs)
        .leftJoin(profiles, eq(auditLogs.actorId, profiles.id))
        .where(
          and(
            eq(auditLogs.workspaceId, input.workspaceId),
            input.action ? eq(auditLogs.action, input.action) : undefined,
            input.actorId ? eq(auditLogs.actorId, input.actorId) : undefined,
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(input.limit + 1)
        .offset(input.cursor);

      const hasMore = rows.length > input.limit;
      return {
        items: rows.slice(0, input.limit),
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  exportAuditLogsCsv: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, AUDIT_ROLES);
      requirePlanFeature(membership, "auditLogs", "Audit logs");

      const rows = await ctx.db.query.auditLogs.findMany({
        where: eq(auditLogs.workspaceId, input.workspaceId),
        orderBy: desc(auditLogs.createdAt),
        limit: 10000,
      });

      const header = [
        "created_at",
        "action",
        "actor_email",
        "target_type",
        "target_id",
        "metadata",
        "ip_hash",
      ].join(",");
      const lines = rows.map((r) =>
        [
          r.createdAt.toISOString(),
          r.action,
          r.actorEmail,
          r.targetType,
          r.targetId,
          JSON.stringify(r.metadata ?? {}),
          r.ipHash,
        ]
          .map(csvEscape)
          .join(","),
      );
      return [header, ...lines].join("\n");
    }),

  // ----- Content administration --------------------------------------------------

  transferVideoOwnership: protectedProcedure
    .input(z.object({ videoId: z.string().uuid(), newOwnerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const video = await ctx.db.query.videos.findFirst({ where: eq(videos.id, input.videoId) });
      if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      await requireMembership(ctx, video.workspaceId, ADMIN_ROLES);

      const target = await ctx.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, video.workspaceId),
          eq(workspaceMembers.userId, input.newOwnerId),
        ),
      });
      if (!target || target.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The new owner must be an active member of this workspace",
        });
      }

      const [updated] = await ctx.db
        .update(videos)
        .set({ ownerId: input.newOwnerId, updatedAt: new Date() })
        .where(eq(videos.id, video.id))
        .returning();

      await writeAuditLog(ctx.db, {
        workspaceId: video.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "video.ownership_transferred",
        targetType: "video",
        targetId: video.id,
        metadata: { from: video.ownerId, to: input.newOwnerId, title: video.title },
        headers: ctx.headers,
      });
      return updated;
    }),

  transferAllContent: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        fromUserId: z.string().uuid(),
        toUserId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.fromUserId === input.toUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source and target users are the same" });
      }
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);

      const target = await ctx.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.toUserId),
        ),
      });
      if (!target || target.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The receiving user must be an active member of this workspace",
        });
      }

      const transferred = await ctx.db
        .update(videos)
        .set({ ownerId: input.toUserId, updatedAt: new Date() })
        .where(
          and(eq(videos.workspaceId, input.workspaceId), eq(videos.ownerId, input.fromUserId)),
        )
        .returning({ id: videos.id });

      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "video.ownership_transferred",
        targetType: "user",
        targetId: input.fromUserId,
        metadata: {
          from: input.fromUserId,
          to: input.toUserId,
          videoCount: transferred.length,
          bulk: true,
        },
        headers: ctx.headers,
      });
      return { transferred: transferred.length };
    }),

  listAllVideos: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        cursor: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);

      const rows = await ctx.db
        .select({
          video: videos,
          owner: {
            id: profiles.id,
            name: profiles.name,
            email: profiles.email,
            avatarUrl: profiles.avatarUrl,
          },
        })
        .from(videos)
        .innerJoin(profiles, eq(videos.ownerId, profiles.id))
        .where(eq(videos.workspaceId, input.workspaceId))
        .orderBy(desc(videos.createdAt))
        .limit(input.limit + 1)
        .offset(input.cursor);

      const hasMore = rows.length > input.limit;
      return {
        items: rows.slice(0, input.limit),
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  // ----- SCIM / API tokens ----------------------------------------------------------

  createScimToken: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      requirePlanFeature(membership, "scim", "SCIM provisioning");

      const token = `ryl_scim_${nanoid(40)}`;
      const [created] = await ctx.db
        .insert(apiTokens)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          type: "scim",
          tokenHash: sha256Hex(token),
          tokenPrefix: token.slice(0, 12),
          createdBy: ctx.user.id,
        })
        .returning({
          id: apiTokens.id,
          name: apiTokens.name,
          tokenPrefix: apiTokens.tokenPrefix,
          createdAt: apiTokens.createdAt,
        });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "scim.token_created",
        targetType: "api_token",
        targetId: created.id,
        metadata: { name: input.name, tokenPrefix: created.tokenPrefix },
        headers: ctx.headers,
      });

      // The full token is returned exactly once — only its hash is stored.
      return { ...created, token };
    }),

  revokeScimToken: protectedProcedure
    .input(z.object({ tokenId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const token = await ctx.db.query.apiTokens.findFirst({
        where: eq(apiTokens.id, input.tokenId),
        columns: { id: true, workspaceId: true, name: true, revokedAt: true },
      });
      if (!token) throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
      await requireMembership(ctx, token.workspaceId, ADMIN_ROLES);
      if (token.revokedAt) return { ok: true };

      await ctx.db
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(apiTokens.id, token.id));

      await writeAuditLog(ctx.db, {
        workspaceId: token.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "scim.token_revoked",
        targetType: "api_token",
        targetId: token.id,
        metadata: { name: token.name },
        headers: ctx.headers,
      });
      return { ok: true };
    }),

  listApiTokens: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      return ctx.db.query.apiTokens.findMany({
        where: eq(apiTokens.workspaceId, input.workspaceId),
        orderBy: desc(apiTokens.createdAt),
        columns: { tokenHash: false },
      });
    }),

  // ----- Usage ---------------------------------------------------------------------

  getUsage: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, USAGE_ROLES);

      const usage = await ctx.db.query.workspaceUsage.findMany({
        where: eq(workspaceUsage.workspaceId, input.workspaceId),
        orderBy: desc(workspaceUsage.period),
        limit: 12,
      });

      const [videoStats] = await ctx.db
        .select({
          videoCount: sql<number>`count(*)::int`,
          storageBytes: sql<string>`coalesce(sum(${videos.sizeBytes}), 0)`,
        })
        .from(videos)
        .where(
          and(eq(videos.workspaceId, input.workspaceId), notInArray(videos.status, ["deleted"])),
        );

      const [memberStats] = await ctx.db
        .select({ memberCount: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.status, "active"),
          ),
        );

      return {
        usage,
        currentPeriod: new Date().toISOString().slice(0, 7),
        videoCount: videoStats?.videoCount ?? 0,
        storageBytes: Number(videoStats?.storageBytes ?? 0),
        memberCount: memberStats?.memberCount ?? 0,
        planId: membership.planId,
        plan: membership.plan,
      };
    }),

  // ----- Integrations ----------------------------------------------------------------

  listIntegrations: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      return ctx.db.query.integrations.findMany({
        where: eq(integrations.workspaceId, input.workspaceId),
        orderBy: desc(integrations.createdAt),
      });
    }),

  upsertIntegration: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        type: z.enum(INTEGRATION_TYPES),
        config: z.record(z.unknown()),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      requirePlanFeature(membership, "integrations", "Integrations");

      const existing = await ctx.db.query.integrations.findFirst({
        where: and(
          eq(integrations.workspaceId, input.workspaceId),
          eq(integrations.type, input.type),
        ),
      });

      let row: typeof integrations.$inferSelect | undefined;
      if (existing) {
        [row] = await ctx.db
          .update(integrations)
          .set({ config: input.config, enabled: input.enabled, updatedAt: new Date() })
          .where(eq(integrations.id, existing.id))
          .returning();
      } else {
        [row] = await ctx.db
          .insert(integrations)
          .values({
            workspaceId: input.workspaceId,
            type: input.type,
            config: input.config,
            enabled: input.enabled,
            createdBy: ctx.user.id,
          })
          .returning();
      }
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "workspace.setting_changed",
        targetType: "integration",
        targetId: row.id,
        metadata: { type: input.type, enabled: input.enabled },
        headers: ctx.headers,
      });
      return row;
    }),

  deleteIntegration: protectedProcedure
    .input(z.object({ integrationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await ctx.db.query.integrations.findFirst({
        where: eq(integrations.id, input.integrationId),
      });
      if (!integration) throw new TRPCError({ code: "NOT_FOUND", message: "Integration not found" });
      await requireMembership(ctx, integration.workspaceId, ADMIN_ROLES);

      await ctx.db.delete(integrations).where(eq(integrations.id, integration.id));

      await writeAuditLog(ctx.db, {
        workspaceId: integration.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "workspace.setting_changed",
        targetType: "integration",
        targetId: integration.id,
        metadata: { type: integration.type, deleted: true },
        headers: ctx.headers,
      });
      return { ok: true };
    }),
});
