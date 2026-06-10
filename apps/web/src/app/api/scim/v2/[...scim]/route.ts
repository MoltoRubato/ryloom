import { createHash } from "crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { apiTokens, profiles, workspaceMembers } from "@ryloom/db";

import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/server/api/trpc";
import { db } from "@/server/db";

/**
 * SCIM 2.0 Users subset for enterprise directory sync (Okta, Entra, …).
 *
 * Auth: `Authorization: Bearer ryl_scim_…` — the sha256 of the presented token
 * must match an unrevoked `api_tokens` row of type "scim"; that row scopes the
 * request to a single workspace.
 *
 * Supported:
 *   GET    /api/scim/v2/Users            (filter userName eq "…", startIndex, count)
 *   GET    /api/scim/v2/Users/{id}
 *   POST   /api/scim/v2/Users            (provision: creates auth user + membership)
 *   PATCH  /api/scim/v2/Users/{id}       (Operations toggling `active`)
 *   PUT    /api/scim/v2/Users/{id}       (replace — only `active` is honored)
 *   DELETE /api/scim/v2/Users/{id}       (removes the workspace membership)
 */

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

type ScimRouteContext = { params: Promise<{ scim: string[] }> };
type ScimAuth = { workspaceId: string; tokenId: string };

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/scim+json" },
  });
}

function scimError(status: number, detail: string, scimType?: string): Response {
  return scimJson(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
    status,
  );
}

function toScimUser(member: {
  userId: string;
  status: string;
  email: string;
  name: string | null;
}) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: member.userId,
    userName: member.email,
    name: { formatted: member.name ?? member.email },
    active: member.status === "active",
    emails: [{ value: member.email, primary: true }],
    meta: { resourceType: "User" },
  };
}

// ---------------------------------------------------------------------------
// Auth + lookups
// ---------------------------------------------------------------------------

async function authenticate(req: Request): Promise<ScimAuth | null> {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await db.query.apiTokens.findFirst({
    where: and(
      eq(apiTokens.tokenHash, tokenHash),
      eq(apiTokens.type, "scim"),
      isNull(apiTokens.revokedAt),
    ),
    columns: { id: true, workspaceId: true },
  });
  if (!row) return null;

  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return { workspaceId: row.workspaceId, tokenId: row.id };
}

async function findMember(workspaceId: string, userId: string) {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      status: workspaceMembers.status,
      role: workspaceMembers.role,
      email: profiles.email,
      name: profiles.name,
    })
    .from(workspaceMembers)
    .innerJoin(profiles, eq(workspaceMembers.userId, profiles.id))
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function scimAudit(
  auth: ScimAuth,
  req: Request,
  action: string,
  userId: string,
  metadata: Record<string, unknown> = {},
) {
  await writeAuditLog(db, {
    workspaceId: auth.workspaceId,
    actorId: null,
    actorEmail: "scim",
    action,
    targetType: "user",
    targetId: userId,
    metadata: { ...metadata, via: "scim", tokenId: auth.tokenId },
    headers: req.headers,
  });
}

function coerceBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

/** Shared gate: master switch + bearer auth + path shape. Returns a Response on failure. */
async function gate(
  req: Request,
  context: ScimRouteContext,
): Promise<
  | { ok: true; auth: ScimAuth; resourceId: string | null }
  | { ok: false; response: Response }
> {
  if (!env.SCIM_ENABLED) {
    return {
      ok: false,
      response: scimError(
        403,
        "SCIM provisioning is disabled on this instance. Set SCIM_ENABLED=true to enable the SCIM API.",
      ),
    };
  }
  const auth = await authenticate(req);
  if (!auth) {
    return { ok: false, response: scimError(401, "Invalid or missing bearer token") };
  }
  const { scim } = await context.params;
  const [resource, resourceId, ...rest] = scim;
  if (resource !== "Users" || rest.length > 0) {
    return { ok: false, response: scimError(404, "Resource not found") };
  }
  if (resourceId !== undefined && !uuidSchema.safeParse(resourceId).success) {
    return { ok: false, response: scimError(404, "User not found") };
  }
  return { ok: true, auth, resourceId: resourceId ?? null };
}

// ---------------------------------------------------------------------------
// GET /Users + /Users/{id}
// ---------------------------------------------------------------------------

export async function GET(req: Request, context: ScimRouteContext): Promise<Response> {
  const gated = await gate(req, context);
  if (!gated.ok) return gated.response;
  const { auth, resourceId } = gated;

  if (resourceId) {
    const member = await findMember(auth.workspaceId, resourceId);
    if (!member) return scimError(404, "User not found");
    return scimJson(toScimUser(member));
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter");
  let filterEmail: string | null = null;
  if (filter) {
    const match = /^\s*userName\s+eq\s+"([^"]+)"\s*$/i.exec(filter);
    if (!match?.[1]) {
      return scimError(400, 'Unsupported filter — only `userName eq "value"` is supported', "invalidFilter");
    }
    filterEmail = match[1].toLowerCase();
  }
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? "1") || 1);
  const count = Math.min(200, Math.max(0, Number(url.searchParams.get("count") ?? "100") || 0));

  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      status: workspaceMembers.status,
      role: workspaceMembers.role,
      email: profiles.email,
      name: profiles.name,
    })
    .from(workspaceMembers)
    .innerJoin(profiles, eq(workspaceMembers.userId, profiles.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, auth.workspaceId),
        inArray(workspaceMembers.status, ["active", "suspended"]),
      ),
    )
    .orderBy(workspaceMembers.joinedAt);

  const filtered = filterEmail
    ? rows.filter((r) => r.email.toLowerCase() === filterEmail)
    : rows;
  const page = filtered.slice(startIndex - 1, startIndex - 1 + count);

  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: filtered.length,
    startIndex,
    itemsPerPage: page.length,
    Resources: page.map(toScimUser),
  });
}

// ---------------------------------------------------------------------------
// POST /Users — provision
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  userName: z.string().email().optional(),
  name: z
    .object({
      formatted: z.string().optional(),
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    })
    .optional(),
  emails: z
    .array(z.object({ value: z.string().email(), primary: z.boolean().optional() }))
    .optional(),
  active: z.boolean().optional(),
});

export async function POST(req: Request, context: ScimRouteContext): Promise<Response> {
  const gated = await gate(req, context);
  if (!gated.ok) return gated.response;
  const { auth, resourceId } = gated;
  if (resourceId) return scimError(404, "Resource not found");

  const body: unknown = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(400, "Invalid SCIM user payload", "invalidValue");
  }
  const primaryEmail =
    parsed.data.userName ??
    parsed.data.emails?.find((e) => e.primary)?.value ??
    parsed.data.emails?.[0]?.value;
  if (!primaryEmail) {
    return scimError(400, "userName (email) is required", "invalidValue");
  }
  const email = primaryEmail.toLowerCase();
  const formattedName =
    parsed.data.name?.formatted ??
    [parsed.data.name?.givenName, parsed.data.name?.familyName].filter(Boolean).join(" ").trim();

  // Resolve or create the underlying auth user + profile.
  let profile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) });
  if (!profile) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) {
      // The auth user may exist without a profile row (e.g. trigger race) —
      // re-check before failing.
      profile = await db.query.profiles.findFirst({ where: eq(profiles.email, email) });
      if (!profile) {
        return scimError(500, `Could not provision user: ${error?.message ?? "unknown error"}`);
      }
    } else {
      await db
        .insert(profiles)
        .values({ id: data.user.id, email, name: formattedName || null })
        .onConflictDoNothing();
      profile = await db.query.profiles.findFirst({ where: eq(profiles.id, data.user.id) });
      if (!profile) return scimError(500, "Could not create the user profile");
    }
  }

  const existingMember = await findMember(auth.workspaceId, profile.id);
  if (existingMember) {
    return scimError(409, "User is already a member of this workspace", "uniqueness");
  }

  const status = parsed.data.active === false ? ("suspended" as const) : ("active" as const);
  await db.insert(workspaceMembers).values({
    workspaceId: auth.workspaceId,
    userId: profile.id,
    role: "member",
    status,
  });

  await scimAudit(auth, req, "scim.user_provisioned", profile.id, { email });

  return scimJson(
    toScimUser({ userId: profile.id, status, email: profile.email, name: profile.name }),
    201,
  );
}

// ---------------------------------------------------------------------------
// PATCH / PUT /Users/{id} — activate / deactivate
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});

async function setMemberActive(
  auth: ScimAuth,
  req: Request,
  userId: string,
  active: boolean,
): Promise<Response> {
  const member = await findMember(auth.workspaceId, userId);
  if (!member) return scimError(404, "User not found");
  if (member.role === "owner" && !active) {
    return scimError(403, "The workspace owner cannot be deactivated via SCIM");
  }

  const status = active ? ("active" as const) : ("suspended" as const);
  if (member.status !== status) {
    await db
      .update(workspaceMembers)
      .set({ status })
      .where(
        and(
          eq(workspaceMembers.workspaceId, auth.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
    await scimAudit(
      auth,
      req,
      active ? "scim.user_reactivated" : "scim.user_deprovisioned",
      userId,
      { email: member.email },
    );
  }

  return scimJson(toScimUser({ ...member, status }));
}

export async function PATCH(req: Request, context: ScimRouteContext): Promise<Response> {
  const gated = await gate(req, context);
  if (!gated.ok) return gated.response;
  const { auth, resourceId } = gated;
  if (!resourceId) return scimError(404, "User not found");

  const body: unknown = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(400, "Invalid SCIM PatchOp payload", "invalidValue");
  }

  let active: boolean | null = null;
  for (const op of parsed.data.Operations) {
    const opName = op.op.toLowerCase();
    if (opName !== "replace" && opName !== "add") continue;
    if (op.path?.toLowerCase() === "active") {
      active = coerceBool(op.value) ?? active;
    } else if (!op.path && typeof op.value === "object" && op.value !== null) {
      const candidate = (op.value as Record<string, unknown>).active;
      active = coerceBool(candidate) ?? active;
    }
  }
  if (active === null) {
    return scimError(400, "Only the `active` attribute is supported via PATCH", "invalidPath");
  }

  return setMemberActive(auth, req, resourceId, active);
}

export async function PUT(req: Request, context: ScimRouteContext): Promise<Response> {
  const gated = await gate(req, context);
  if (!gated.ok) return gated.response;
  const { auth, resourceId } = gated;
  if (!resourceId) return scimError(404, "User not found");

  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return scimError(400, "Invalid SCIM user payload", "invalidValue");
  }
  const active = coerceBool((body as Record<string, unknown>).active) ?? true;

  return setMemberActive(auth, req, resourceId, active);
}

// ---------------------------------------------------------------------------
// DELETE /Users/{id} — deprovision
// ---------------------------------------------------------------------------

export async function DELETE(req: Request, context: ScimRouteContext): Promise<Response> {
  const gated = await gate(req, context);
  if (!gated.ok) return gated.response;
  const { auth, resourceId } = gated;
  if (!resourceId) return scimError(404, "User not found");

  const member = await findMember(auth.workspaceId, resourceId);
  if (!member) return scimError(404, "User not found");
  if (member.role === "owner") {
    return scimError(403, "The workspace owner cannot be removed via SCIM");
  }

  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, auth.workspaceId),
        eq(workspaceMembers.userId, resourceId),
      ),
    );

  await scimAudit(auth, req, "scim.user_deprovisioned", resourceId, {
    email: member.email,
    removed: true,
  });

  return new Response(null, { status: 204 });
}
