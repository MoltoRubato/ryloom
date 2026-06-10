"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { Download, Loader2, ScrollText, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlan, minimumPlanFor } from "@/lib/plans";
import { api } from "@/trpc/react";

const AUDIT_ACTIONS = [
  "user.invited",
  "user.removed",
  "role.changed",
  "video.deleted",
  "video.privacy_changed",
  "video.downloaded",
  "video.ownership_transferred",
  "share_link.created",
  "share_link.revoked",
  "workspace.setting_changed",
  "workspace.plan_changed",
  "retention_policy.changed",
  "scim.token_created",
  "scim.token_revoked",
] as const;

function actionBadgeVariant(
  action: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("deleted") || action.includes("removed") || action.includes("revoked")) {
    return "destructive";
  }
  if (action.includes("created") || action.includes("invited")) return "default";
  return "secondary";
}

function compactMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return "—";
  const json = JSON.stringify(metadata);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

export default function AuditLogPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const membersQuery = api.workspace.listMembers.useQuery({ workspaceId });

  const plan = workspaceQuery.data?.plan;
  const role = workspaceQuery.data?.role;
  const auditEnabled = plan?.auditLogs ?? false;
  const canView =
    role === "owner" || role === "admin" || role === "compliance_admin";

  const [actionFilter, setActionFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");

  const exportCsvMutation = api.admin.exportAuditLogsCsv.useMutation();

  const logsQuery = api.admin.getAuditLogs.useInfiniteQuery(
    {
      workspaceId,
      limit: 50,
      ...(actionFilter !== "all" ? { action: actionFilter } : {}),
      ...(actorFilter !== "all" ? { actorId: actorFilter } : {}),
    },
    {
      enabled: auditEnabled && canView,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = logsQuery;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (workspaceQuery.isLoading || !plan) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (!auditEnabled) {
    const requiredPlan = getPlan(minimumPlanFor("auditLogs"));
    return (
      <SettingsSection
        title="Audit log"
        description="A tamper-evident record of everything that happens in this workspace."
      >
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ScrollText className="size-6" />
          </div>
          <div className="max-w-md space-y-1">
            <div className="flex items-center justify-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                Audit logs are an {requiredPlan.name} feature
              </p>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="size-3" />
                {requiredPlan.name}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Track member changes, privacy updates, downloads, share links, and
              policy changes — with actor, target, and timestamp — and export
              everything to CSV for your compliance team.
            </p>
          </div>
          <Button asChild>
            <Link href={`/app/w/${workspaceId}/settings/billing`}>View plans</Link>
          </Button>
        </div>
      </SettingsSection>
    );
  }

  if (!canView) {
    return (
      <SettingsSection title="Audit log">
        <p className="py-8 text-center text-sm text-muted-foreground">
          Only owners, admins, and compliance admins can view the audit log.
        </p>
      </SettingsSection>
    );
  }

  const rows = (logsQuery.data?.pages ?? []).flatMap((p) => p.items);
  const members = membersQuery.data ?? [];

  const exportCsv = async () => {
    try {
      const csv = await exportCsvMutation.mutateAsync({ workspaceId });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Audit log exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <SettingsSection
      title="Audit log"
      description="Who did what, and when — across the whole workspace."
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="sm:w-56" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {AUDIT_ACTIONS.map((action) => (
              <SelectItem key={action} value={action}>
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actorFilter} onValueChange={setActorFilter}>
          <SelectTrigger className="sm:w-56" aria-label="Filter by actor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All members</SelectItem>
            {members.map(({ user }) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name ?? user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={exportCsvMutation.isPending}
          >
            {exportCsvMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {logsQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No audit events match these filters yet.
        </p>
      ) : (
        <div className="-mx-6 overflow-x-auto px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ log, actor }) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {format(new Date(log.createdAt), "d MMM yyyy, HH:mm")}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">
                    {actor?.email ?? log.actorEmail ?? "System"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionBadgeVariant(log.action)}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-44 truncate text-muted-foreground">
                    {log.targetType ? (
                      <>
                        <span className="text-foreground">{log.targetType}</span>
                        {log.targetId ? (
                          <span className="ml-1 font-mono text-xs">
                            {log.targetId.length > 12
                              ? `${log.targetId.slice(0, 12)}…`
                              : log.targetId}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell
                    className="max-w-64 truncate font-mono text-xs text-muted-foreground"
                    title={
                      log.metadata ? JSON.stringify(log.metadata, null, 2) : undefined
                    }
                  >
                    {compactMetadata(log.metadata)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div ref={sentinelRef} className="h-px" />
      {logsQuery.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={logsQuery.isFetchingNextPage}
            onClick={() => void logsQuery.fetchNextPage()}
          >
            {logsQuery.isFetchingNextPage && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Load more
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
