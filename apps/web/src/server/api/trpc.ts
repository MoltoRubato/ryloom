import { initTRPC, TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import superjson from "superjson";
import { ZodError } from "zod";
import { createHash } from "crypto";

import {
  auditLogs,
  profiles,
  workspaceMembers,
  workspaces,
  type Database,
} from "@ryloom/db";

import { env } from "@/env";
import { getPlan, type PlanId, type PlanLimits } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type AuthUser = {
  id: string;
  email: string;
};

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const supabase = await createClient();

  // Desktop/extension clients authenticate with a Supabase access token in the
  // Authorization header; browser clients use the SSR cookie session.
  const bearer = opts.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const {
    data: { user },
  } = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();

  return {
    db,
    supabase,
    headers: opts.headers,
    user: user ? ({ id: user.id, email: user.email ?? "" } satisfies AuthUser) : null,
  };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export const publicProcedure = t.procedure;

/**
 * Internal-tool access control: accounts must belong to the allowed email
 * domain (NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN). Set the env var to "*" to allow
 * any domain. Public share/embed viewing is intentionally not restricted.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  const domain = env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;
  if (!domain || domain === "*") return true;
  return !!email && email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!isAllowedEmail(ctx.user.email)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Ryloom is restricted to @${env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN} accounts.`,
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "guest"
  | "billing_admin"
  | "content_admin"
  | "compliance_admin";

/** Roles that can manage workspace settings / members. */
export const ADMIN_ROLES: WorkspaceRole[] = ["owner", "admin"];
/** Roles that can create content. */
export const CREATOR_ROLES: WorkspaceRole[] = [
  "owner",
  "admin",
  "member",
  "content_admin",
];

export type Membership = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: "active" | "invited" | "suspended";
  workspace: typeof workspaces.$inferSelect;
  plan: PlanLimits;
  planId: PlanId;
};

/**
 * Asserts the current user is an active member of the workspace
 * (optionally with one of the given roles) and returns membership + plan.
 */
export async function requireMembership(
  ctx: { db: Database; user: AuthUser },
  workspaceId: string,
  roles?: WorkspaceRole[],
): Promise<Membership> {
  const rows = await ctx.db
    .select({ member: workspaceMembers, workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, ctx.user.id),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.member.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
  }
  const role = row.member.role as WorkspaceRole;
  if (roles && !roles.includes(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to do that in this workspace",
    });
  }
  // Internal tool: every workspace runs with full access regardless of the
  // stored plan column (kept for schema compatibility).
  const planId: PlanId = "enterprise";
  return {
    workspaceId,
    userId: ctx.user.id,
    role,
    status: row.member.status as Membership["status"],
    workspace: row.workspace,
    plan: getPlan(planId),
    planId,
  };
}

/** Throws PAYMENT_REQUIRED-style error when a plan feature is missing. */
export function requirePlanFeature(
  membership: Membership,
  feature: keyof PlanLimits,
  label?: string,
) {
  const value = membership.plan[feature];
  const enabled = value === true || value === null;
  if (!enabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${label ?? String(feature)} requires a plan upgrade (current plan: ${membership.plan.name})`,
    });
  }
}

/** Fetches the caller's profile row, creating it if the trigger hasn't run. */
export async function getOrCreateProfile(ctx: { db: Database; user: AuthUser }) {
  const existing = await ctx.db.query.profiles.findFirst({
    where: eq(profiles.id, ctx.user.id),
  });
  if (existing) return existing;
  const inserted = await ctx.db
    .insert(profiles)
    .values({ id: ctx.user.id, email: ctx.user.email })
    .onConflictDoNothing()
    .returning();
  const profile =
    inserted[0] ??
    (await ctx.db.query.profiles.findFirst({ where: eq(profiles.id, ctx.user.id) }));
  if (!profile) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  return profile;
}

// ---------------------------------------------------------------------------
// Audit + privacy helpers
// ---------------------------------------------------------------------------

export async function writeAuditLog(
  database: Database,
  entry: {
    workspaceId: string;
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    headers?: Headers;
  },
) {
  await database.insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    actorId: entry.actorId ?? null,
    actorEmail: entry.actorEmail ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
    ipHash: entry.headers ? hashIp(getClientIp(entry.headers)) : null,
  });
}

export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

/** One-way salted hash — raw IPs are never stored. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${env.IP_HASH_SALT}:${ip}`).digest("hex").slice(0, 32);
}
