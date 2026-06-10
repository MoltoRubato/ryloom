import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  profiles,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@ryloom/db";

import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { slugify } from "@/lib/utils";
import {
  ADMIN_ROLES,
  createTRPCRouter,
  getOrCreateProfile,
  protectedProcedure,
  requireMembership,
  requirePlanFeature,
  writeAuditLog,
} from "@/server/api/trpc";

const roleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "viewer",
  "guest",
  "billing_admin",
  "content_admin",
  "compliance_admin",
]);

export const workspaceRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const profile = await getOrCreateProfile(ctx);
      const baseSlug = slugify(input.name) || "workspace";
      const slug = `${baseSlug}-${nanoid(6).toLowerCase()}`;

      const [workspace] = await ctx.db
        .insert(workspaces)
        .values({ name: input.name, slug, createdBy: ctx.user.id })
        .returning();
      if (!workspace) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await ctx.db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: ctx.user.id,
        role: "owner",
        status: "active",
      });

      if (!profile.defaultWorkspaceId) {
        await ctx.db
          .update(profiles)
          .set({ defaultWorkspaceId: workspace.id })
          .where(eq(profiles.id, ctx.user.id));
      }
      return workspace;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    await getOrCreateProfile(ctx);
    const rows = await ctx.db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(eq(workspaceMembers.userId, ctx.user.id), eq(workspaceMembers.status, "active")),
      )
      .orderBy(workspaces.createdAt);
    return rows;
  }),

  get: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId);
      return {
        workspace: membership.workspace,
        role: membership.role,
        planId: membership.planId,
        plan: membership.plan,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        logoUrl: z.string().url().nullable().optional(),
        brandColor: z.string().max(20).optional(),
        hideBranding: z.boolean().optional(),
        defaultPrivacy: z
          .enum(["private", "workspace", "specific", "public", "password"])
          .optional(),
        allowedEmailDomains: z.array(z.string().max(100)).max(20).nullable().optional(),
        enforceSso: z.boolean().optional(),
        ssoProviderId: z.string().max(200).nullable().optional(),
        retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
        legalHold: z.boolean().optional(),
        sessionDurationHours: z.number().int().min(1).max(720).nullable().optional(),
        requireViewerIdentity: z.boolean().optional(),
        watermarkViewerEmail: z.boolean().optional(),
        disableDownloadsDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, [
        ...ADMIN_ROLES,
        "compliance_admin",
      ]);
      const { workspaceId, ...fields } = input;

      if (fields.hideBranding) requirePlanFeature(membership, "removeRyloomBranding", "Custom branding");
      if (fields.brandColor || fields.logoUrl) {
        requirePlanFeature(membership, "customBranding", "Custom branding");
      }
      if (fields.retentionDays !== undefined && fields.retentionDays !== null) {
        requirePlanFeature(membership, "retentionPolicies", "Retention policies");
      }
      if (fields.enforceSso || fields.ssoProviderId) {
        requirePlanFeature(membership, "sso", "SSO");
      }
      if (fields.watermarkViewerEmail) {
        requirePlanFeature(membership, "watermarkViewerEmail", "Viewer email watermark");
      }

      const [updated] = await ctx.db
        .update(workspaces)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId))
        .returning();

      await writeAuditLog(ctx.db, {
        workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "workspace.setting_changed",
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { changed: Object.keys(fields) },
        headers: ctx.headers,
      });
      if (fields.retentionDays !== undefined) {
        await writeAuditLog(ctx.db, {
          workspaceId,
          actorId: ctx.user.id,
          actorEmail: ctx.user.email,
          action: "retention_policy.changed",
          targetType: "workspace",
          targetId: workspaceId,
          metadata: { retentionDays: fields.retentionDays },
          headers: ctx.headers,
        });
      }
      return updated;
    }),

  // ----- Members ---------------------------------------------------------------

  listMembers: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId);
      return ctx.db
        .select({
          member: workspaceMembers,
          user: {
            id: profiles.id,
            name: profiles.name,
            email: profiles.email,
            avatarUrl: profiles.avatarUrl,
            lastSeenAt: profiles.lastSeenAt,
          },
        })
        .from(workspaceMembers)
        .innerJoin(profiles, eq(workspaceMembers.userId, profiles.id))
        .where(eq(workspaceMembers.workspaceId, input.workspaceId))
        .orderBy(workspaceMembers.joinedAt);
    }),

  inviteMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        email: z.string().email(),
        role: roleSchema.default("member"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      if (input.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use transfer ownership instead" });
      }
      if (
        ["billing_admin", "content_admin", "compliance_admin"].includes(input.role)
      ) {
        requirePlanFeature(membership, "advancedAdminRoles", "Advanced admin roles");
      }
      const email = input.email.toLowerCase();

      const allowedDomains = membership.workspace.allowedEmailDomains;
      if (allowedDomains?.length) {
        const domain = email.split("@")[1] ?? "";
        if (!allowedDomains.map((d) => d.toLowerCase().replace(/^@/, "")).includes(domain)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invites are restricted to: ${allowedDomains.join(", ")}`,
          });
        }
      }

      const existingUser = await ctx.db.query.profiles.findFirst({
        where: eq(profiles.email, email),
      });
      if (existingUser) {
        const existingMember = await ctx.db.query.workspaceMembers.findFirst({
          where: and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, existingUser.id),
          ),
        });
        if (existingMember) {
          throw new TRPCError({ code: "CONFLICT", message: "Already a member" });
        }
      }

      const token = nanoid(32);
      const [invite] = await ctx.db
        .insert(workspaceInvites)
        .values({
          workspaceId: input.workspaceId,
          email,
          role: input.role,
          token,
          invitedBy: ctx.user.id,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        })
        .returning();

      const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${token}`;
      const { sent } = await sendEmail({
        to: email,
        subject: `You've been invited to ${membership.workspace.name} on Ryloom`,
        html: `<p>You've been invited to join <strong>${membership.workspace.name}</strong> on Ryloom.</p><p><a href="${inviteUrl}">Accept the invitation</a></p>`,
      });

      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "user.invited",
        targetType: "user",
        targetId: email,
        metadata: { role: input.role },
        headers: ctx.headers,
      });
      return { invite, inviteUrl, emailSent: sent };
    }),

  listInvites: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      return ctx.db.query.workspaceInvites.findMany({
        where: and(
          eq(workspaceInvites.workspaceId, input.workspaceId),
          eq(workspaceInvites.status, "pending"),
        ),
        orderBy: desc(workspaceInvites.createdAt),
      });
    }),

  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.query.workspaceInvites.findFirst({
        where: eq(workspaceInvites.id, input.inviteId),
      });
      if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
      await requireMembership(ctx, invite.workspaceId, ADMIN_ROLES);
      await ctx.db
        .update(workspaceInvites)
        .set({ status: "revoked" })
        .where(eq(workspaceInvites.id, input.inviteId));
      return { ok: true };
    }),

  getInvite: protectedProcedure
    .input(z.object({ token: z.string().min(8) }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.db.query.workspaceInvites.findFirst({
        where: eq(workspaceInvites.token, input.token),
      });
      if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or expired" });
      }
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, invite.workspaceId),
        columns: { id: true, name: true, logoUrl: true },
      });
      return { invite: { email: invite.email, role: invite.role }, workspace };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const profile = await getOrCreateProfile(ctx);
      const invite = await ctx.db.query.workspaceInvites.findFirst({
        where: eq(workspaceInvites.token, input.token),
      });
      if (!invite || invite.status !== "pending") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }
      if (invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invite has expired" });
      }
      if (invite.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This invite was sent to ${invite.email}. Sign in with that email to accept it.`,
        });
      }

      await ctx.db
        .insert(workspaceMembers)
        .values({
          workspaceId: invite.workspaceId,
          userId: ctx.user.id,
          role: invite.role,
          status: "active",
          invitedBy: invite.invitedBy,
        })
        .onConflictDoNothing();
      await ctx.db
        .update(workspaceInvites)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(workspaceInvites.id, invite.id));
      if (!profile.defaultWorkspaceId) {
        await ctx.db
          .update(profiles)
          .set({ defaultWorkspaceId: invite.workspaceId })
          .where(eq(profiles.id, ctx.user.id));
      }
      return { workspaceId: invite.workspaceId };
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't change your own role" });
      }
      if (input.role === "owner" && membership.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can transfer ownership" });
      }
      if (["billing_admin", "content_admin", "compliance_admin"].includes(input.role)) {
        requirePlanFeature(membership, "advancedAdminRoles", "Advanced admin roles");
      }

      const target = await ctx.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (target.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner's role can't be changed here" });
      }

      // Ownership transfer demotes the current owner to admin.
      if (input.role === "owner") {
        await ctx.db
          .update(workspaceMembers)
          .set({ role: "admin" })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, ctx.user.id),
            ),
          );
      }

      await ctx.db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );

      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "role.changed",
        targetType: "user",
        targetId: input.userId,
        metadata: { from: target.role, to: input.role },
        headers: ctx.headers,
      });
      return { ok: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId, ADMIN_ROLES);
      const target = await ctx.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (target.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner can't be removed" });
      }
      await ctx.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );
      await writeAuditLog(ctx.db, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "user.removed",
        targetType: "user",
        targetId: input.userId,
        headers: ctx.headers,
      });
      return { ok: true };
    }),

  leave: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireMembership(ctx, input.workspaceId);
      if (membership.role === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Transfer ownership before leaving the workspace",
        });
      }
      await ctx.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, ctx.user.id),
          ),
        );
      return { ok: true };
    }),
});
