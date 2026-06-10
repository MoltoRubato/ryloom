"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Play, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { ColorSwatchPicker } from "@/components/settings/color-swatch-picker";
import { SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import { UpgradeGate } from "@/components/settings/upgrade-gate";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

const DEFAULT_BRAND_COLOR = "#625DF5";

function SharePreview({
  workspaceName,
  logoUrl,
  brandColor,
  hideBranding,
}: {
  workspaceName: string;
  logoUrl: string | null;
  brandColor: string;
  hideBranding: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ backgroundColor: brandColor }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${workspaceName} logo`}
              className="size-6 shrink-0 rounded bg-white/90 object-contain p-0.5"
            />
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-white/20 text-[10px] font-bold text-white">
              {getInitials(workspaceName)}
            </span>
          )}
          <span className="truncate text-sm font-semibold text-white">
            {workspaceName}
          </span>
        </div>
        <span className="rounded-md bg-white/20 px-2.5 py-1 text-xs font-medium text-white">
          Share
        </span>
      </div>
      <div className="relative flex aspect-video items-center justify-center bg-muted">
        <span
          className="flex size-12 items-center justify-center rounded-full shadow-lg"
          style={{ backgroundColor: brandColor }}
        >
          <Play className="ml-0.5 size-5 fill-white text-white" />
        </span>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10">
          <div
            className="h-full w-1/3"
            style={{ backgroundColor: brandColor }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium text-foreground">
          How to use the new dashboard
        </span>
        {!hideBranding && (
          <span className="text-[10px] text-muted-foreground">
            Powered by <span className="font-semibold">Ryloom</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function BrandingSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const utils = api.useUtils();

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const data = workspaceQuery.data;

  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [hideBranding, setHideBranding] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (data && !hydrated) {
      setBrandColor(data.workspace.brandColor ?? DEFAULT_BRAND_COLOR);
      setHideBranding(data.workspace.hideBranding);
      setHydrated(true);
    }
  }, [data, hydrated]);

  const updateWorkspace = api.workspace.update.useMutation({
    onSuccess: async () => {
      await utils.workspace.get.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (workspaceQuery.isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const { workspace, role, plan } = data;
  const canEdit = role === "owner" || role === "admin";
  const canCustomBrand = plan.customBranding;
  const canRemoveBranding = plan.removeRyloomBranding;

  const dirty =
    brandColor !== (workspace.brandColor ?? DEFAULT_BRAND_COLOR) ||
    hideBranding !== workspace.hideBranding;

  const handleLogoFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    setUploadingLogo(true);
    try {
      const supabase = createClient();
      const path = `workspaces/${workspaceId}/logo-${Date.now()}.png`;
      const { error } = await supabase.storage
        .from("workspace-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message);
      const { data: pub } = supabase.storage
        .from("workspace-assets")
        .getPublicUrl(path);
      await updateWorkspace.mutateAsync({
        workspaceId,
        logoUrl: pub.publicUrl,
      });
      toast.success("Logo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    updateWorkspace.mutate(
      { workspaceId, logoUrl: null },
      { onSuccess: () => toast.success("Logo removed") },
    );
  };

  const save = () => {
    updateWorkspace.mutate(
      {
        workspaceId,
        ...(canCustomBrand ? { brandColor } : {}),
        ...(canRemoveBranding ? { hideBranding } : {}),
      },
      { onSuccess: () => toast.success("Branding saved") },
    );
  };

  return (
    <div className="space-y-6">
      <UpgradeGate
        enabled={canCustomBrand}
        feature="customBranding"
        label="Custom branding"
        workspaceId={workspaceId}
      >
        <SettingsSection
          title="Brand identity"
          description="Your logo and color appear on share pages and embeds."
          footer={
            <Button
              onClick={save}
              disabled={!canEdit || !dirty || updateWorkspace.isPending}
            >
              {updateWorkspace.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save branding
            </Button>
          }
        >
          <div className="divide-y divide-border">
            <SettingsRow
              label="Logo"
              description="Square PNG or SVG works best, up to 2MB."
            >
              <div className="flex items-center gap-3">
                {workspace.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={workspace.logoUrl}
                    alt="Workspace logo"
                    className="size-10 rounded-lg border border-border bg-background object-contain p-1"
                  />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-lg border border-dashed border-border text-xs font-semibold text-muted-foreground">
                    {getInitials(workspace.name)}
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogoFile(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || uploadingLogo}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingLogo ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {uploadingLogo ? "Uploading…" : "Upload logo"}
                </Button>
                {workspace.logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={!canEdit || updateWorkspace.isPending}
                    onClick={removeLogo}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
            </SettingsRow>

            <SettingsRow
              label="Brand color"
              description="Used for the share-page header, player accent, and buttons."
            >
              <ColorSwatchPicker
                value={brandColor}
                onChange={setBrandColor}
                disabled={!canEdit}
              />
            </SettingsRow>
          </div>
        </SettingsSection>
      </UpgradeGate>

      <UpgradeGate
        enabled={canRemoveBranding}
        feature="removeRyloomBranding"
        label="Remove Ryloom branding"
        workspaceId={workspaceId}
      >
        <SettingsSection
          title="Ryloom branding"
          description='Hide the "Powered by Ryloom" footer on share pages and embeds.'
          footer={
            <Button
              onClick={save}
              disabled={!canEdit || !dirty || updateWorkspace.isPending}
            >
              {updateWorkspace.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save branding
            </Button>
          }
        >
          <SettingsRow
            label='Hide "Powered by Ryloom"'
            description="Share pages will show only your brand."
          >
            <Switch
              checked={hideBranding}
              onCheckedChange={setHideBranding}
              disabled={!canEdit}
              aria-label='Hide "Powered by Ryloom"'
            />
          </SettingsRow>
        </SettingsSection>
      </UpgradeGate>

      <SettingsSection
        title="Preview"
        description="A live preview of how viewers see your share pages."
      >
        <div className="mx-auto max-w-md">
          <SharePreview
            workspaceName={workspace.name}
            logoUrl={workspace.logoUrl}
            brandColor={canCustomBrand ? brandColor : DEFAULT_BRAND_COLOR}
            hideBranding={canRemoveBranding ? hideBranding : false}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
