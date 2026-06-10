"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { ChipsInput } from "@/components/settings/chips-input";
import { SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { getPlan, minimumPlanFor, type PlanLimits } from "@/lib/plans";
import { api } from "@/trpc/react";

const PRIVACY_OPTIONS = [
  {
    value: "private",
    label: "Private",
    hint: "Only the creator can watch",
  },
  {
    value: "workspace",
    label: "Workspace",
    hint: "Anyone in this workspace can watch",
  },
  {
    value: "public",
    label: "Public link",
    hint: "Anyone with the link can watch",
  },
] as const;

type PrivacyValue = (typeof PRIVACY_OPTIONS)[number]["value"];

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

function PlanLockBadge({
  feature,
  workspaceId,
}: {
  feature: keyof PlanLimits;
  workspaceId: string;
}) {
  const planName = getPlan(minimumPlanFor(feature)).name;
  return (
    <Link href={`/app/w/${workspaceId}/settings/billing`}>
      <Badge variant="secondary" className="gap-1">
        <Lock className="size-3" />
        {planName}
      </Badge>
    </Link>
  );
}

export default function GeneralSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const utils = api.useUtils();

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const data = workspaceQuery.data;

  const [name, setName] = useState("");
  const [defaultPrivacy, setDefaultPrivacy] = useState<PrivacyValue>("workspace");
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [requireViewerIdentity, setRequireViewerIdentity] = useState(false);
  const [watermarkViewerEmail, setWatermarkViewerEmail] = useState(false);
  const [disableDownloadsDefault, setDisableDownloadsDefault] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (data && !hydrated) {
      const ws = data.workspace;
      setName(ws.name);
      setDefaultPrivacy(
        (PRIVACY_OPTIONS.some((o) => o.value === ws.defaultPrivacy)
          ? ws.defaultPrivacy
          : "workspace") as PrivacyValue,
      );
      setAllowedDomains(ws.allowedEmailDomains ?? []);
      setRequireViewerIdentity(ws.requireViewerIdentity);
      setWatermarkViewerEmail(ws.watermarkViewerEmail);
      setDisableDownloadsDefault(ws.disableDownloadsDefault);
      setHydrated(true);
    }
  }, [data, hydrated]);

  const updateWorkspace = api.workspace.update.useMutation({
    onSuccess: async () => {
      toast.success("Workspace settings saved");
      await utils.workspace.get.invalidate({ workspaceId });
      await utils.workspace.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (workspaceQuery.isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  const { workspace, role, plan } = data;
  const canEdit = role === "owner" || role === "admin" || role === "compliance_admin";

  const canWatermark = plan.watermarkViewerEmail;
  const canDisableDownloads = plan.disableDownloads;

  const dirty =
    name !== workspace.name ||
    defaultPrivacy !== workspace.defaultPrivacy ||
    JSON.stringify(allowedDomains) !==
      JSON.stringify(workspace.allowedEmailDomains ?? []) ||
    requireViewerIdentity !== workspace.requireViewerIdentity ||
    watermarkViewerEmail !== workspace.watermarkViewerEmail ||
    disableDownloadsDefault !== workspace.disableDownloadsDefault;

  const save = () => {
    updateWorkspace.mutate({
      workspaceId,
      name: name.trim() || workspace.name,
      defaultPrivacy,
      allowedEmailDomains: allowedDomains.length > 0 ? allowedDomains : null,
      requireViewerIdentity,
      ...(canWatermark ? { watermarkViewerEmail } : {}),
      ...(canDisableDownloads ? { disableDownloadsDefault } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title="General"
        description="Workspace identity and default sharing behaviour."
        footer={
          <>
            {!canEdit && (
              <span className="mr-auto text-sm text-muted-foreground">
                Only workspace admins can change these settings.
              </span>
            )}
            <Button
              onClick={save}
              disabled={!canEdit || !dirty || updateWorkspace.isPending}
            >
              {updateWorkspace.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save changes
            </Button>
          </>
        }
      >
        <div className="divide-y divide-border">
          <SettingsRow label="Workspace name" htmlFor="workspace-name">
            <Input
              id="workspace-name"
              value={name}
              disabled={!canEdit}
              onChange={(e) => setName(e.target.value)}
              className="sm:w-72"
            />
          </SettingsRow>

          <SettingsRow
            label="Default video privacy"
            description="Applied to new recordings. Creators can change it per video."
          >
            <Select
              value={defaultPrivacy}
              onValueChange={(v) => setDefaultPrivacy(v as PrivacyValue)}
              disabled={!canEdit}
            >
              <SelectTrigger className="sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIVACY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="font-medium">{option.label}</span>
                    <span className="ml-2 text-muted-foreground">
                      {option.hint}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label="Allowed email domains"
            description="Restrict invitations to these domains. Leave empty to allow any email."
          >
            <ChipsInput
              value={allowedDomains}
              onChange={setAllowedDomains}
              disabled={!canEdit}
              placeholder="acme.com, example.org"
              normalize={(chip) => chip.toLowerCase().replace(/^@/, "")}
              validate={(chip) => {
                const ok = DOMAIN_RE.test(chip);
                if (!ok) toast.error(`"${chip}" doesn't look like a domain`);
                return ok;
              }}
              className="sm:w-72"
              aria-label="Allowed email domains"
            />
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Viewer controls"
        description="Defaults that protect content shared from this workspace."
        footer={
          <Button
            onClick={save}
            disabled={!canEdit || !dirty || updateWorkspace.isPending}
          >
            {updateWorkspace.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        }
      >
        <div className="divide-y divide-border">
          <SettingsRow
            label="Require viewer identity"
            description="Viewers must enter their email before watching shared videos."
          >
            <Switch
              checked={requireViewerIdentity}
              onCheckedChange={setRequireViewerIdentity}
              disabled={!canEdit}
              aria-label="Require viewer identity"
            />
          </SettingsRow>

          <SettingsRow
            label="Watermark viewer email"
            description="Overlay the viewer's email on playback to deter screen captures."
          >
            <div className="flex items-center gap-2">
              {!canWatermark && (
                <PlanLockBadge
                  feature="watermarkViewerEmail"
                  workspaceId={workspaceId}
                />
              )}
              <Switch
                checked={canWatermark ? watermarkViewerEmail : false}
                onCheckedChange={setWatermarkViewerEmail}
                disabled={!canEdit || !canWatermark}
                aria-label="Watermark viewer email"
              />
            </div>
          </SettingsRow>

          <SettingsRow
            label="Disable downloads by default"
            description="New videos are created with downloads turned off."
          >
            <div className="flex items-center gap-2">
              {!canDisableDownloads && (
                <PlanLockBadge feature="disableDownloads" workspaceId={workspaceId} />
              )}
              <Switch
                checked={canDisableDownloads ? disableDownloadsDefault : false}
                onCheckedChange={setDisableDownloadsDefault}
                disabled={!canEdit || !canDisableDownloads}
                aria-label="Disable downloads by default"
              />
            </div>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
