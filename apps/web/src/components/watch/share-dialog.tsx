"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Code2,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Plus,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { minimumPlanFor, PLANS, type PlanLimits } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Privacy = "private" | "workspace" | "specific" | "public" | "password";

export type ShareDialogVideo = {
  id: string;
  workspaceId: string;
  shareToken: string;
  privacy: Privacy;
  linkExpiresAt: Date | null;
  domainRestriction: string[] | null;
  requireViewerIdentity: boolean;
  watermarkViewerEmail: boolean;
  allowDownload: boolean;
  allowComments: boolean;
  allowReactions: boolean;
  allowTranscript: boolean;
  allowEmbed: boolean;
};

const PRIVACY_OPTIONS: {
  value: Privacy;
  label: string;
  description: string;
  icon: LucideIcon;
  gate?: keyof PlanLimits;
}[] = [
  { value: "private", label: "Private", description: "Only you can watch", icon: Lock },
  {
    value: "workspace",
    label: "Workspace",
    description: "Anyone in your workspace",
    icon: Building2,
  },
  {
    value: "specific",
    label: "Specific people",
    description: "Only people you invite",
    icon: UserPlus,
  },
  {
    value: "public",
    label: "Public",
    description: "Anyone with the link",
    icon: Globe,
  },
  {
    value: "password",
    label: "Password",
    description: "Link plus a password",
    icon: KeyRound,
    gate: "passwordProtection",
  },
];

function UpgradeHint({ feature }: { feature: keyof PlanLimits }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="cursor-default gap-1 text-[10px]">
          <Lock className="h-2.5 w-2.5" /> Upgrade
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Requires the {PLANS[minimumPlanFor(feature)].name} plan
      </TooltipContent>
    </Tooltip>
  );
}

function copy(text: string, label = "Link copied") {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("Couldn't copy"),
  );
}

export function ShareDialog({
  video,
  open,
  onOpenChange,
}: {
  video: ShareDialogVideo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = api.useUtils();
  const workspaceQuery = api.workspace.get.useQuery(
    { workspaceId: video.workspaceId },
    { enabled: open },
  );
  const plan = workspaceQuery.data?.plan;
  const hasFeature = (feature: keyof PlanLimits) => plan?.[feature] === true;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const shareUrl = `${origin}/share/${video.shareToken}`;
  const embedSnippet = `<iframe src="${origin}/embed/${video.shareToken}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  // ----- Privacy --------------------------------------------------------------

  const [selectedPrivacy, setSelectedPrivacy] = useState<Privacy>(video.privacy);
  const [password, setPassword] = useState("");
  useEffect(() => setSelectedPrivacy(video.privacy), [video.privacy, open]);

  const invalidateVideo = () => utils.video.get.invalidate({ videoId: video.id });

  const updatePrivacy = api.video.updatePrivacy.useMutation({
    onSuccess: () => {
      void invalidateVideo();
      toast.success("Sharing settings updated");
    },
    onError: (error) => {
      toast.error(error.message || "Couldn't update sharing");
      setSelectedPrivacy(video.privacy);
    },
  });
  const updateVideo = api.video.update.useMutation({
    onSuccess: () => void invalidateVideo(),
    onError: (error) => toast.error(error.message || "Couldn't update settings"),
  });

  const choosePrivacy = (value: Privacy) => {
    const option = PRIVACY_OPTIONS.find((o) => o.value === value);
    if (option?.gate && !hasFeature(option.gate)) {
      toast.error(
        `${option.label} links require the ${PLANS[minimumPlanFor(option.gate)].name} plan`,
      );
      return;
    }
    setSelectedPrivacy(value);
    // Password needs a password before it can be applied.
    if (value !== "password") {
      updatePrivacy.mutate({ videoId: video.id, privacy: value });
    } else if (video.privacy === "password") {
      // Already password-protected; nothing to save until a new password is set.
    }
  };

  const savePassword = () => {
    if (password.length < 4) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    updatePrivacy.mutate(
      { videoId: video.id, privacy: "password", password },
      { onSuccess: () => setPassword("") },
    );
  };

  // ----- Specific people --------------------------------------------------------

  const permissionsQuery = api.video.listPermissions.useQuery(
    { videoId: video.id },
    { enabled: open && selectedPrivacy === "specific" },
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const addPermission = api.video.addPermission.useMutation({
    onSuccess: () => {
      setInviteEmail("");
      void utils.video.listPermissions.invalidate({ videoId: video.id });
    },
    onError: (error) => toast.error(error.message || "Couldn't add person"),
  });
  const removePermission = api.video.removePermission.useMutation({
    onSuccess: () => void utils.video.listPermissions.invalidate({ videoId: video.id }),
    onError: (error) => toast.error(error.message || "Couldn't remove person"),
  });

  // ----- Advanced ------------------------------------------------------------------

  const [domainInput, setDomainInput] = useState("");
  const domains = video.domainRestriction ?? [];

  const saveDomains = (next: string[]) => {
    updatePrivacy.mutate({
      videoId: video.id,
      privacy: video.privacy,
      domainRestriction: next.length > 0 ? next : null,
    });
  };

  const addDomain = () => {
    const domain = domainInput.trim().toLowerCase().replace(/^@/, "");
    if (!domain || !domain.includes(".")) {
      toast.error("Enter a valid domain like acme.com");
      return;
    }
    if (domains.includes(domain)) {
      setDomainInput("");
      return;
    }
    setDomainInput("");
    saveDomains([...domains, domain]);
  };

  // ----- Extra share links -----------------------------------------------------------

  const linksQuery = api.video.listShareLinks.useQuery(
    { videoId: video.id },
    { enabled: open },
  );
  const [newLinkOpen, setNewLinkOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newExpiry, setNewExpiry] = useState("");

  const createShareLink = api.video.createShareLink.useMutation({
    onSuccess: () => {
      void utils.video.listShareLinks.invalidate({ videoId: video.id });
      setNewLinkOpen(false);
      setNewLabel("");
      setNewPassword("");
      setNewExpiry("");
      toast.success("Share link created");
    },
    onError: (error) => toast.error(error.message || "Couldn't create link"),
  });
  const revokeShareLink = api.video.revokeShareLink.useMutation({
    onSuccess: () => {
      void utils.video.listShareLinks.invalidate({ videoId: video.id });
      toast.success("Link revoked");
    },
    onError: (error) => toast.error(error.message || "Couldn't revoke link"),
  });

  const featureToggles: {
    key: "allowComments" | "allowReactions" | "allowTranscript" | "allowEmbed";
    label: string;
  }[] = [
    { key: "allowComments", label: "Allow comments" },
    { key: "allowReactions", label: "Allow emoji reactions" },
    { key: "allowTranscript", label: "Show transcript & captions" },
    { key: "allowEmbed", label: "Allow embedding" },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Share video</DialogTitle>
            <DialogDescription>
              Control who can watch and what viewers can do.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {/* Privacy radio cards */}
            <div role="radiogroup" aria-label="Who can watch" className="grid gap-2 sm:grid-cols-2">
              {PRIVACY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = selectedPrivacy === option.value;
                const gated = option.gate !== undefined && !hasFeature(option.gate);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choosePrivacy(option.value)}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-accent/60 ring-1 ring-primary"
                        : "border-border hover:bg-accent/40",
                      gated && "opacity-70",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        selected ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">{option.label}</p>
                        {gated && option.gate && <UpgradeHint feature={option.gate} />}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {option.description}
                      </p>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>

            {/* Password setter */}
            {selectedPrivacy === "password" && hasFeature("passwordProtection") && (
              <div className="flex items-end gap-2 rounded-xl border border-border p-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="share-password" className="text-xs">
                    {video.privacy === "password"
                      ? "Change password"
                      : "Set a password"}
                  </Label>
                  <Input
                    id="share-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 4 characters"
                    className="h-8"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={savePassword}
                  disabled={updatePrivacy.isPending || password.length === 0}
                >
                  {updatePrivacy.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            )}

            {/* Specific people manager */}
            {selectedPrivacy === "specific" && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (inviteEmail.trim()) {
                      addPermission.mutate({
                        videoId: video.id,
                        email: inviteEmail.trim(),
                      });
                    }
                  }}
                  className="flex gap-2"
                >
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="person@company.com"
                    aria-label="Invite by email"
                    className="h-8"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={addPermission.isPending || !inviteEmail.trim()}
                  >
                    {addPermission.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add
                  </Button>
                </form>
                {permissionsQuery.isLoading ? (
                  <p className="py-1 text-xs text-muted-foreground">Loading people…</p>
                ) : (permissionsQuery.data?.length ?? 0) === 0 ? (
                  <p className="py-1 text-xs text-muted-foreground">
                    No one has been invited yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {permissionsQuery.data?.map((permission) => (
                      <li
                        key={permission.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm"
                      >
                        <span className="truncate">
                          {permission.user?.name ??
                            permission.email ??
                            permission.user?.email ??
                            "Unknown"}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove access"
                          onClick={() =>
                            removePermission.mutate({ permissionId: permission.id })
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Separator />

            {/* Primary link */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Share link</Label>
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} className="h-9 font-mono text-xs" />
                <Button variant="outline" size="sm" className="h-9" onClick={() => copy(shareUrl)}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
            </div>

            {/* Extra share links */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Extra links</Label>
                <Button variant="ghost" size="sm" onClick={() => setNewLinkOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New link
                </Button>
              </div>
              {(linksQuery.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Create extra links to track different audiences or set separate
                  passwords and expiry dates.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {linksQuery.data?.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{link.label ?? "Untitled link"}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          /share/{link.token}
                          {link.expiresAt
                            ? ` · expires ${format(link.expiresAt, "MMM d, yyyy")}`
                            : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Copy link"
                        onClick={() => copy(`${origin}/share/${link.token}`)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Revoke link"
                        onClick={() => revokeShareLink.mutate({ shareId: link.id })}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Embed snippet */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Code2 className="h-3.5 w-3.5" /> Embed
              </Label>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted p-2.5 font-mono text-[11px] leading-relaxed">
                  {embedSnippet}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(embedSnippet, "Embed code copied")}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
            </div>

            <Separator />

            {/* Advanced */}
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 gap-1.5">
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                  Advanced settings
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3">
                {/* Link expiry */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="link-expiry" className="text-sm font-normal">
                      Link expiry date
                    </Label>
                    {!hasFeature("expiringLinks") && <UpgradeHint feature="expiringLinks" />}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="link-expiry"
                      type="date"
                      disabled={!hasFeature("expiringLinks")}
                      value={
                        video.linkExpiresAt
                          ? format(video.linkExpiresAt, "yyyy-MM-dd")
                          : ""
                      }
                      onChange={(e) =>
                        updatePrivacy.mutate({
                          videoId: video.id,
                          privacy: video.privacy,
                          linkExpiresAt: e.target.value
                            ? new Date(`${e.target.value}T23:59:59`)
                            : null,
                        })
                      }
                      className="h-8 w-40"
                    />
                    {video.linkExpiresAt && (
                      <button
                        type="button"
                        aria-label="Clear expiry"
                        onClick={() =>
                          updatePrivacy.mutate({
                            videoId: video.id,
                            privacy: video.privacy,
                            linkExpiresAt: null,
                          })
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Domain restriction */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="domain-input" className="text-sm font-normal">
                      Restrict to email domains
                    </Label>
                    {!hasFeature("domainRestriction") && (
                      <UpgradeHint feature="domainRestriction" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {domains.map((domain) => (
                      <Badge key={domain} variant="secondary" className="gap-1 font-mono">
                        @{domain}
                        <button
                          type="button"
                          aria-label={`Remove ${domain}`}
                          onClick={() => saveDomains(domains.filter((d) => d !== domain))}
                          className="hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    <Input
                      id="domain-input"
                      value={domainInput}
                      disabled={!hasFeature("domainRestriction")}
                      onChange={(e) => setDomainInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addDomain();
                        }
                      }}
                      placeholder="acme.com — press Enter"
                      className="h-8 w-44"
                    />
                  </div>
                </div>

                {/* Identity + watermark */}
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="require-identity" className="text-sm font-normal">
                    Require viewer email to watch
                  </Label>
                  <Switch
                    id="require-identity"
                    checked={video.requireViewerIdentity}
                    onCheckedChange={(checked) =>
                      updatePrivacy.mutate({
                        videoId: video.id,
                        privacy: video.privacy,
                        requireViewerIdentity: checked,
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="watermark" className="text-sm font-normal">
                      Watermark viewer email on video
                    </Label>
                    {!hasFeature("watermarkViewerEmail") && (
                      <UpgradeHint feature="watermarkViewerEmail" />
                    )}
                  </div>
                  <Switch
                    id="watermark"
                    disabled={!hasFeature("watermarkViewerEmail")}
                    checked={video.watermarkViewerEmail}
                    onCheckedChange={(checked) =>
                      updatePrivacy.mutate({
                        videoId: video.id,
                        privacy: video.privacy,
                        watermarkViewerEmail: checked,
                      })
                    }
                  />
                </div>

                {/* Downloads (disabling is plan-gated) */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="allow-download" className="text-sm font-normal">
                      Allow downloads
                    </Label>
                    {!hasFeature("disableDownloads") && video.allowDownload && (
                      <UpgradeHint feature="disableDownloads" />
                    )}
                  </div>
                  <Switch
                    id="allow-download"
                    disabled={
                      updateVideo.isPending ||
                      (video.allowDownload && !hasFeature("disableDownloads"))
                    }
                    checked={video.allowDownload}
                    onCheckedChange={(checked) =>
                      updateVideo.mutate({ videoId: video.id, allowDownload: checked })
                    }
                  />
                </div>

                {featureToggles.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3">
                    <Label htmlFor={row.key} className="text-sm font-normal">
                      {row.label}
                    </Label>
                    <Switch
                      id={row.key}
                      disabled={updateVideo.isPending}
                      checked={video[row.key]}
                      onCheckedChange={(checked) =>
                        updateVideo.mutate({ videoId: video.id, [row.key]: checked })
                      }
                    />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        </DialogContent>
      </Dialog>

      {/* New extra link dialog */}
      <Dialog open={newLinkOpen} onOpenChange={setNewLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New share link</DialogTitle>
            <DialogDescription>
              An extra link with its own label, password and expiry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-link-label">Label</Label>
              <Input
                id="new-link-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Customer review"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="new-link-password">Password (optional)</Label>
                {!hasFeature("passwordProtection") && (
                  <UpgradeHint feature="passwordProtection" />
                )}
              </div>
              <Input
                id="new-link-password"
                type="password"
                value={newPassword}
                disabled={!hasFeature("passwordProtection")}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 4 characters"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="new-link-expiry">Expiry date (optional)</Label>
                {!hasFeature("expiringLinks") && <UpgradeHint feature="expiringLinks" />}
              </div>
              <Input
                id="new-link-expiry"
                type="date"
                value={newExpiry}
                disabled={!hasFeature("expiringLinks")}
                onChange={(e) => setNewExpiry(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewLinkOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createShareLink.isPending}
              onClick={() =>
                createShareLink.mutate({
                  videoId: video.id,
                  label: newLabel.trim() || undefined,
                  privacyType: newPassword ? "password" : "public",
                  password: newPassword || undefined,
                  expiresAt: newExpiry ? new Date(`${newExpiry}T23:59:59`) : undefined,
                })
              }
            >
              {createShareLink.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
