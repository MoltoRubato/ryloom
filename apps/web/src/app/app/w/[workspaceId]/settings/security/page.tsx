"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  Check,
  Copy,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsRow, SettingsSection } from "@/components/settings/settings-section";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/trpc/react";

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
        className="font-mono text-xs"
        aria-label={label}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(`${label} copied`);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Couldn't access the clipboard");
          }
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        Copy
      </Button>
    </div>
  );
}

export default function SecuritySettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const utils = api.useUtils();

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const data = workspaceQuery.data;

  // --- form state ----------------------------------------------------------
  const [enforceSso, setEnforceSso] = useState(false);
  const [ssoProviderId, setSsoProviderId] = useState("");
  const [sessionHours, setSessionHours] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [legalHold, setLegalHold] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // SCIM token state
  const [newTokenName, setNewTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  useEffect(() => {
    if (data && !hydrated) {
      const ws = data.workspace;
      setEnforceSso(ws.enforceSso);
      setSsoProviderId(ws.ssoProviderId ?? "");
      setSessionHours(
        ws.sessionDurationHours !== null ? String(ws.sessionDurationHours) : "",
      );
      setRetentionDays(ws.retentionDays !== null ? String(ws.retentionDays) : "");
      setLegalHold(ws.legalHold);
      setHydrated(true);
    }
  }, [data, hydrated]);

  const plan = data?.plan;
  const role = data?.role;
  const canEdit =
    role === "owner" || role === "admin" || role === "compliance_admin";
  const isAdmin = role === "owner" || role === "admin";
  const scimAvailable = plan?.scim ?? false;

  const tokensQuery = api.admin.listApiTokens.useQuery(
    { workspaceId },
    { enabled: scimAvailable && isAdmin, retry: false },
  );

  const updateWorkspace = api.workspace.update.useMutation({
    onSuccess: async () => {
      await utils.workspace.get.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const createScimToken = api.admin.createScimToken.useMutation({
    onSuccess: async (result) => {
      setCreatedToken(result.token);
      setNewTokenName("");
      await utils.admin.listApiTokens.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeScimToken = api.admin.revokeScimToken.useMutation({
    onSuccess: async () => {
      toast.success("Token revoked");
      await utils.admin.listApiTokens.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (workspaceQuery.isLoading || !data || !plan) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const workspace = data.workspace;

  const tokens = (tokensQuery.data ?? []).filter((t) => !t.revokedAt);

  const ssoDirty =
    enforceSso !== workspace.enforceSso ||
    ssoProviderId !== (workspace.ssoProviderId ?? "");
  const sessionDirty =
    sessionHours !==
    (workspace.sessionDurationHours !== null
      ? String(workspace.sessionDurationHours)
      : "");
  const retentionDirty =
    retentionDays !==
      (workspace.retentionDays !== null ? String(workspace.retentionDays) : "") ||
    legalHold !== workspace.legalHold;

  const saveSso = () => {
    updateWorkspace.mutate(
      {
        workspaceId,
        enforceSso,
        ssoProviderId: ssoProviderId.trim() || null,
      },
      { onSuccess: () => toast.success("SSO settings saved") },
    );
  };

  const saveSession = () => {
    const parsed = sessionHours.trim() === "" ? null : Number(sessionHours);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 720)) {
      toast.error("Session duration must be between 1 and 720 hours");
      return;
    }
    updateWorkspace.mutate(
      { workspaceId, sessionDurationHours: parsed },
      { onSuccess: () => toast.success("Session policy saved") },
    );
  };

  const saveRetention = () => {
    const parsed = retentionDays.trim() === "" ? null : Number(retentionDays);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650)) {
      toast.error("Retention must be between 1 and 3650 days");
      return;
    }
    updateWorkspace.mutate(
      { workspaceId, retentionDays: parsed, legalHold },
      { onSuccess: () => toast.success("Retention policy saved") },
    );
  };

  return (
    <div className="space-y-6">
      <UpgradeGate
        enabled={plan.sso}
        feature="sso"
        label="Single sign-on"
        workspaceId={workspaceId}
      >
        <SettingsSection
          title="Single sign-on (SSO)"
          description="Require members to sign in through your identity provider."
          footer={
            <Button
              onClick={saveSso}
              disabled={!canEdit || !ssoDirty || updateWorkspace.isPending}
            >
              {updateWorkspace.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save SSO settings
            </Button>
          }
        >
          <div className="divide-y divide-border">
            <SettingsRow
              label="Enforce SSO"
              description="Members must authenticate via SAML — email/password sign-in is blocked."
            >
              <Switch
                checked={enforceSso}
                onCheckedChange={setEnforceSso}
                disabled={!canEdit}
                aria-label="Enforce SSO"
              />
            </SettingsRow>
            <SettingsRow
              label="SSO provider ID"
              description="The Supabase SAML provider UUID for your identity provider."
              htmlFor="sso-provider-id"
            >
              <Input
                id="sso-provider-id"
                value={ssoProviderId}
                onChange={(e) => setSsoProviderId(e.target.value)}
                disabled={!canEdit}
                placeholder="e.g. 9f1c6f3a-…"
                className="font-mono text-xs sm:w-72"
              />
            </SettingsRow>
          </div>
          <p className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Register your IdP with the Supabase CLI:{" "}
            <code className="rounded bg-muted px-1 font-mono">
              supabase sso add --type saml --metadata-url …
            </code>{" "}
            then paste the returned provider ID above. See the Supabase SAML SSO
            docs for the full walkthrough.
          </p>
        </SettingsSection>
      </UpgradeGate>

      <UpgradeGate
        enabled={plan.sso}
        feature="sso"
        label="Session policies"
        workspaceId={workspaceId}
      >
        <SettingsSection
          title="Session policy"
          description="Limit how long members stay signed in before re-authenticating."
          footer={
            <Button
              onClick={saveSession}
              disabled={!canEdit || !sessionDirty || updateWorkspace.isPending}
            >
              {updateWorkspace.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save session policy
            </Button>
          }
        >
          <SettingsRow
            label="Session duration (hours)"
            description="Leave empty for the default (no forced re-authentication)."
            htmlFor="session-duration"
          >
            <Input
              id="session-duration"
              type="number"
              min={1}
              max={720}
              value={sessionHours}
              onChange={(e) => setSessionHours(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g. 24"
              className="sm:w-40"
            />
          </SettingsRow>
        </SettingsSection>
      </UpgradeGate>

      <UpgradeGate
        enabled={scimAvailable}
        feature="scim"
        label="SCIM provisioning"
        workspaceId={workspaceId}
      >
        <SettingsSection
          title="SCIM provisioning"
          description="Automatically provision and deprovision members from your IdP."
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">SCIM endpoint</p>
              <CopyField
                value={`${origin}/api/scim/v2`}
                label="SCIM endpoint"
              />
              <p className="text-xs text-muted-foreground">
                Configure your IdP with this base URL and a bearer token created
                below.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Bearer tokens</p>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newTokenName.trim();
                  if (!name) return;
                  createScimToken.mutate({ workspaceId, name });
                }}
              >
                <Input
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="Token name (e.g. Okta production)"
                  disabled={!isAdmin}
                  className="flex-1"
                  aria-label="New token name"
                />
                <Button
                  type="submit"
                  disabled={
                    !isAdmin || !newTokenName.trim() || createScimToken.isPending
                  }
                >
                  {createScimToken.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <KeyRound className="size-4" />
                  )}
                  Create token
                </Button>
              </form>

              {tokens.length > 0 ? (
                <div className="-mx-6 overflow-x-auto px-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Last used</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tokens.map((token) => (
                        <TableRow key={token.id}>
                          <TableCell className="font-medium">
                            {token.name}
                            {token.type === "scim" && (
                              <Badge variant="outline" className="ml-2">
                                SCIM
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {token.tokenPrefix}…
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(token.createdAt), "d MMM yyyy")}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {token.lastUsedAt
                              ? formatDistanceToNow(new Date(token.lastUsedAt), {
                                  addSuffix: true,
                                })
                              : "Never"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <ConfirmDialog
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    disabled={!isAdmin}
                                  >
                                    <Trash2 className="size-4" />
                                    Revoke
                                  </Button>
                                }
                                title={`Revoke "${token.name}"?`}
                                description="Provisioning requests using this token will immediately start failing."
                                confirmLabel="Revoke token"
                                destructive
                                onConfirm={() =>
                                  revokeScimToken.mutateAsync({
                                    tokenId: token.id,
                                  })
                                }
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No active tokens. Create one to connect your identity provider.
                </p>
              )}
            </div>
          </div>
        </SettingsSection>
      </UpgradeGate>

      <UpgradeGate
        enabled={plan.retentionPolicies}
        feature="retentionPolicies"
        label="Data retention"
        workspaceId={workspaceId}
      >
        <SettingsSection
          title="Data retention"
          description="Automatically archive old content to meet compliance requirements."
          footer={
            <Button
              onClick={saveRetention}
              disabled={!canEdit || !retentionDirty || updateWorkspace.isPending}
            >
              {updateWorkspace.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save retention policy
            </Button>
          }
        >
          <div className="divide-y divide-border">
            <SettingsRow
              label="Retention period (days)"
              description="A background worker archives videos older than this. Leave empty to keep videos forever."
              htmlFor="retention-days"
            >
              <Input
                id="retention-days"
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                disabled={!canEdit}
                placeholder="e.g. 365"
                className="sm:w-40"
              />
            </SettingsRow>
            <SettingsRow
              label="Legal hold"
              description="Suspends retention sweeps and blocks permanent deletion while active."
            >
              <div className="flex items-center gap-2">
                {legalHold && (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="size-3" />
                    Active
                  </Badge>
                )}
                <Switch
                  checked={legalHold}
                  onCheckedChange={setLegalHold}
                  disabled={!canEdit}
                  aria-label="Legal hold"
                />
              </div>
            </SettingsRow>
          </div>
        </SettingsSection>
      </UpgradeGate>

      <SettingsSection
        title="Multi-factor authentication"
        description="MFA is managed per user by Supabase Auth."
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Fingerprint className="size-4" />
          </div>
          <p className="text-sm text-muted-foreground">
            Each member can enroll a TOTP authenticator app on their own account.
            To require MFA for everyone, enable enforcement in your Supabase
            project&apos;s authentication settings — Ryloom honours the resulting{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">aal2</code>{" "}
            session level automatically.
          </p>
        </div>
      </SettingsSection>

      <Dialog
        open={createdToken !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SCIM token created</DialogTitle>
            <DialogDescription>
              Copy this token now — for security it will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <CopyField value={createdToken ?? ""} label="SCIM token" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedToken(null)}>
              I&apos;ve copied it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
