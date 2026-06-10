import { and, eq, isNotNull, lt } from "drizzle-orm";

import { auditLogs, videos, workspaces } from "@ryloom/db";

import { db } from "../db";
import { type ClaimedJob } from "../queue";

/**
 * Retention sweep: for every workspace with a retention policy (and no legal
 * hold), archive ready videos older than retentionDays and write one audit
 * log entry per affected workspace.
 */
export async function runRetentionSweepJob(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  void job;
  const candidates = await db.query.workspaces.findMany({
    where: and(isNotNull(workspaces.retentionDays), eq(workspaces.legalHold, false)),
    columns: { id: true, retentionDays: true },
  });

  let workspacesAffected = 0;
  let videosArchived = 0;

  for (const workspace of candidates) {
    const days = workspace.retentionDays;
    if (!days || days <= 0) continue;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const archived = await db
      .update(videos)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(videos.workspaceId, workspace.id),
          eq(videos.status, "ready"),
          lt(videos.createdAt, cutoff),
        ),
      )
      .returning({ id: videos.id });

    if (archived.length > 0) {
      workspacesAffected += 1;
      videosArchived += archived.length;
      await db.insert(auditLogs).values({
        workspaceId: workspace.id,
        actorId: null,
        actorEmail: "system",
        action: "retention.videos_archived",
        targetType: "workspace",
        targetId: workspace.id,
        metadata: {
          count: archived.length,
          retentionDays: days,
          cutoff: cutoff.toISOString(),
        },
      });
    }
  }

  return {
    workspacesScanned: candidates.length,
    workspacesAffected,
    videosArchived,
  };
}
