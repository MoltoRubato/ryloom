"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  ClipboardList,
  FileText,
  GitBranch,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Trash2,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { UpgradeGate } from "@/components/settings/upgrade-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";

type IntegrationType =
  | "slack"
  | "jira"
  | "linear"
  | "github"
  | "notion"
  | "zapier"
  | "webhook";

type IntegrationRow = {
  id: string;
  type: IntegrationType;
  enabled: boolean;
  config: Record<string, unknown> | null;
};

type FieldDef = {
  key: string;
  label: string;
  inputType: "text" | "url" | "password";
  placeholder: string;
};

const INTEGRATION_DEFS: {
  type: IntegrationType;
  name: string;
  icon: LucideIcon;
  description: string;
  fields: FieldDef[];
}[] = [
  {
    type: "slack",
    name: "Slack",
    icon: MessageSquare,
    description:
      "Posts to a channel when a video is ready or gets a comment — payload includes the title, share link, thumbnail, and author.",
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        inputType: "url",
        placeholder: "https://hooks.slack.com/services/…",
      },
    ],
  },
  {
    type: "jira",
    name: "Jira",
    icon: ClipboardList,
    description:
      "Creates Jira issues from AI-generated bug reports — payload includes summary, repro steps, and a link back to the video.",
    fields: [
      {
        key: "siteUrl",
        label: "Site URL",
        inputType: "url",
        placeholder: "https://your-team.atlassian.net",
      },
      {
        key: "projectKey",
        label: "Project key",
        inputType: "text",
        placeholder: "ENG",
      },
      {
        key: "apiToken",
        label: "API token",
        inputType: "password",
        placeholder: "Jira API token",
      },
    ],
  },
  {
    type: "linear",
    name: "Linear",
    icon: GitBranch,
    description:
      "Creates Linear issues from videos — payload includes the AI summary, video link, and timestamped transcript highlights.",
    fields: [
      {
        key: "teamKey",
        label: "Team key",
        inputType: "text",
        placeholder: "ENG",
      },
      {
        key: "apiKey",
        label: "API key",
        inputType: "password",
        placeholder: "lin_api_…",
      },
    ],
  },
  {
    type: "github",
    name: "GitHub",
    icon: GitPullRequest,
    description:
      "Files GitHub issues and PR descriptions generated from your recordings — payload includes markdown body and the video link.",
    fields: [
      {
        key: "repo",
        label: "Repository",
        inputType: "text",
        placeholder: "owner/repo",
      },
      {
        key: "token",
        label: "Access token",
        inputType: "password",
        placeholder: "ghp_…",
      },
    ],
  },
  {
    type: "notion",
    name: "Notion",
    icon: FileText,
    description:
      "Saves AI-generated docs, SOPs, and meeting notes into a Notion page — payload includes formatted blocks and the embedded video.",
    fields: [
      {
        key: "token",
        label: "Integration token",
        inputType: "password",
        placeholder: "ntn_…",
      },
      {
        key: "parentPageId",
        label: "Parent page ID",
        inputType: "text",
        placeholder: "Page or database ID",
      },
    ],
  },
  {
    type: "zapier",
    name: "Zapier",
    icon: Zap,
    description:
      "Triggers a Zap on video events (ready, viewed, commented) — payload is JSON with video metadata for any downstream app.",
    fields: [
      {
        key: "webhookUrl",
        label: "Catch hook URL",
        inputType: "url",
        placeholder: "https://hooks.zapier.com/hooks/catch/…",
      },
    ],
  },
  {
    type: "webhook",
    name: "Webhook",
    icon: Webhook,
    description:
      "Sends signed JSON POSTs for every workspace event (video.ready, video.viewed, comment.created) to any endpoint you run.",
    fields: [
      {
        key: "url",
        label: "Endpoint URL",
        inputType: "url",
        placeholder: "https://api.example.com/ryloom",
      },
      {
        key: "secret",
        label: "Signing secret",
        inputType: "password",
        placeholder: "Used for the X-Ryloom-Signature header",
      },
    ],
  },
];

export default function IntegrationsSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const utils = api.useUtils();

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const plan = workspaceQuery.data?.plan;
  const role = workspaceQuery.data?.role;
  const integrationsAvailable = plan?.integrations ?? false;
  const canEdit = role === "owner" || role === "admin";

  const listQuery = api.admin.listIntegrations.useQuery(
    { workspaceId },
    { enabled: integrationsAvailable && canEdit, retry: false },
  );

  const [configuring, setConfiguring] = useState<IntegrationType | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const upsert = api.admin.upsertIntegration.useMutation({
    onSuccess: async () => {
      await utils.admin.listIntegrations.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = api.admin.deleteIntegration.useMutation({
    onSuccess: async () => {
      toast.success("Integration removed");
      await utils.admin.listIntegrations.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (workspaceQuery.isLoading || !plan) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    );
  }

  const rows = listQuery.data ?? [];
  const byType = new Map<IntegrationType, (typeof rows)[number]>(
    rows.map((row) => [row.type, row] as const),
  );

  const activeDef = INTEGRATION_DEFS.find((d) => d.type === configuring) ?? null;

  const openConfigure = (type: IntegrationType) => {
    const def = INTEGRATION_DEFS.find((d) => d.type === type);
    if (!def) return;
    const existing = byType.get(type);
    const initial: Record<string, string> = {};
    for (const field of def.fields) {
      const v = existing?.config?.[field.key];
      initial[field.key] = typeof v === "string" ? v : "";
    }
    setDraft(initial);
    setConfiguring(type);
  };

  const saveConfiguration = () => {
    if (!activeDef) return;
    const missing = activeDef.fields.filter((f) => !draft[f.key]?.trim());
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    const config: Record<string, string> = {};
    for (const field of activeDef.fields) {
      config[field.key] = draft[field.key]?.trim() ?? "";
    }
    upsert.mutate(
      { workspaceId, type: activeDef.type, config, enabled: true },
      {
        onSuccess: () => {
          toast.success(`${activeDef.name} connected`);
          setConfiguring(null);
        },
      },
    );
  };

  const toggleEnabled = (row: IntegrationRow, enabled: boolean) => {
    upsert.mutate(
      {
        workspaceId,
        type: row.type,
        config: row.config ?? {},
        enabled,
      },
      {
        onSuccess: () =>
          toast.success(enabled ? "Integration enabled" : "Integration paused"),
      },
    );
  };

  return (
    <UpgradeGate
      enabled={integrationsAvailable}
      feature="integrations"
      label="Integrations"
      workspaceId={workspaceId}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {INTEGRATION_DEFS.map((def) => {
          const Icon = def.icon;
          const existing = byType.get(def.type);
          return (
            <div
              key={def.type}
              className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {def.name}
                    </p>
                    {existing ? (
                      <Badge
                        variant={existing.enabled ? "default" : "secondary"}
                        className="mt-0.5"
                      >
                        {existing.enabled ? "Connected" : "Paused"}
                      </Badge>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Not connected
                      </p>
                    )}
                  </div>
                </div>
                {existing && (
                  <Switch
                    checked={existing.enabled}
                    onCheckedChange={(checked) => toggleEnabled(existing, checked)}
                    disabled={!canEdit || upsert.isPending}
                    aria-label={`Enable ${def.name}`}
                  />
                )}
              </div>
              <p className="mt-3 flex-1 text-sm text-muted-foreground">
                {def.description}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => openConfigure(def.type)}
                >
                  {existing ? "Edit configuration" : "Configure"}
                </Button>
                {existing && (
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={!canEdit}
                      >
                        <Trash2 className="size-4" />
                        Remove
                      </Button>
                    }
                    title={`Remove the ${def.name} integration?`}
                    description="Its configuration and credentials are deleted and events stop being delivered."
                    confirmLabel="Remove integration"
                    destructive
                    onConfirm={() =>
                      remove.mutateAsync({ integrationId: existing.id })
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={activeDef !== null}
        onOpenChange={(open) => {
          if (!open) setConfiguring(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {activeDef?.name}</DialogTitle>
            <DialogDescription>{activeDef?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {activeDef?.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`integration-${field.key}`}>{field.label}</Label>
                <Input
                  id={`integration-${field.key}`}
                  type={field.inputType}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={field.placeholder}
                  value={draft[field.key] ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfiguring(null)}>
              Cancel
            </Button>
            <Button onClick={saveConfiguration} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="size-4 animate-spin" />}
              Save & enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UpgradeGate>
  );
}
