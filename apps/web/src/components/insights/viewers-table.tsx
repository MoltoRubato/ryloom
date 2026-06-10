"use client";

import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Minus, UserRound, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInitials } from "@/lib/utils";
import { FeatureGate } from "@/components/edit/feature-gate";
import { type ViewerInsight } from "@/components/insights/normalize";

type ViewersTableProps = {
  viewers: ViewerInsight[];
  gated: boolean;
  workspaceId: string;
};

export function ViewersTable({ viewers, gated, workspaceId }: ViewersTableProps) {
  const rows = useMemo(() => {
    let anonymousCount = 0;
    return viewers.map((viewer, index) => ({
      ...viewer,
      key: index,
      displayName: viewer.anonymous
        ? `Anonymous viewer #${++anonymousCount}`
        : (viewer.name ?? viewer.email ?? "Viewer"),
    }));
  }, [viewers]);

  return (
    <FeatureGate
      enabled={!gated}
      feature="viewerInsights"
      label="Viewer insights"
      workspaceId={workspaceId}
    >
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" />
            Viewers
          </CardTitle>
          <CardDescription>Who watched, and how much they saw.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No viewer sessions recorded yet.
            </p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Viewer</TableHead>
                    <TableHead>Watched</TableHead>
                    <TableHead className="text-center">Completed</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Last viewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            {row.avatarUrl && (
                              <AvatarImage src={row.avatarUrl} alt={row.displayName} />
                            )}
                            <AvatarFallback className="text-xs">
                              {row.anonymous ? (
                                <UserRound className="size-4 text-muted-foreground" />
                              ) : (
                                getInitials(row.name, row.email)
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{row.displayName}</p>
                            {!row.anonymous && row.name && row.email && (
                              <p className="truncate text-xs text-muted-foreground">
                                {row.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, row.watchPct)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {Math.round(row.watchPct)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {row.completed ? (
                          <Check
                            className="mx-auto size-4 text-primary"
                            aria-label="Completed"
                          />
                        ) : (
                          <Minus
                            className="mx-auto size-4 text-muted-foreground/50"
                            aria-label="Not completed"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {row.sessionCount}
                      </TableCell>
                      <TableCell className="text-right text-sm whitespace-nowrap text-muted-foreground">
                        {row.lastViewedAt
                          ? formatDistanceToNow(row.lastViewedAt, { addSuffix: true })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </FeatureGate>
  );
}
