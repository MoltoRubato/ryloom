"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Camera,
  Download,
  Laptop,
  Loader2,
  Moon,
  Sun,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { createClient } from "@/lib/supabase/client";
import { cn, getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: Laptop },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export default function PersonalSettingsPage() {
  const utils = api.useUtils();
  const meQuery = api.user.me.useQuery();
  const me = meQuery.data;

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [hydratedFromServer, setHydratedFromServer] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (me && !hydratedFromServer) {
      setName(me.name ?? "");
      setTimezone(me.timezone ?? "UTC");
      setHydratedFromServer(true);
    }
  }, [me, hydratedFromServer]);

  const timezones = useMemo<string[]>(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);

  const updateUser = api.user.update.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteAccount = api.user.deleteAccount.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const dirty =
    me !== undefined &&
    me !== null &&
    (name !== (me.name ?? "") || timezone !== (me.timezone ?? "UTC"));

  const saveProfile = () => {
    updateUser.mutate(
      { name: name.trim() || undefined, timezone },
      { onSuccess: () => toast.success("Profile updated") },
    );
  };

  const handleAvatarFile = async (file: File) => {
    if (!me) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Avatar must be under 5MB");
      return;
    }
    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const path = `users/${me.id}/avatar-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      await updateUser.mutateAsync({ avatarUrl: data.publicUrl });
      toast.success("Avatar updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Avatar upload failed");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const data = await utils.user.exportData.fetch();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ryloom-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Your data export has been downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    await deleteAccount.mutateAsync();
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Your account has been deleted");
    window.location.href = "/";
  };

  if (meQuery.isLoading || !me) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Personal settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, preferences, and account controls.
        </p>
      </div>

      <SettingsSection
        title="Profile"
        description="How you appear across your workspaces."
        footer={
          <Button
            onClick={saveProfile}
            disabled={!dirty || updateUser.isPending}
          >
            {updateUser.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        }
      >
        <div className="divide-y divide-border">
          <SettingsRow
            label="Avatar"
            description="JPG or PNG, up to 5MB."
          >
            <div className="flex items-center gap-4">
              <Avatar className="size-14">
                <AvatarImage src={me.avatarUrl ?? undefined} alt={me.name ?? me.email} />
                <AvatarFallback>{getInitials(me.name, me.email)}</AvatarFallback>
              </Avatar>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAvatarFile(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingAvatar ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
                {uploadingAvatar ? "Uploading…" : "Change avatar"}
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow label="Name" htmlFor="profile-name">
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="sm:w-72"
            />
          </SettingsRow>

          <SettingsRow
            label="Email"
            description="Your sign-in email can't be changed here."
          >
            <Input value={me.email} readOnly disabled className="sm:w-72" />
          </SettingsRow>

          <SettingsRow
            label="Timezone"
            description="Used for dates and your viewing activity."
          >
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="sm:w-72">
                <SelectValue placeholder="Select a timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Appearance"
        description="Choose how Ryloom looks on this device."
      >
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mounted && theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border border-border bg-background px-3 py-4 text-sm font-medium transition-colors hover:bg-accent",
                  selected &&
                    "border-primary bg-primary/5 text-primary ring-1 ring-primary",
                )}
              >
                <Icon className="size-5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Danger zone"
        description="Export everything you own, or permanently delete your account."
        className="border-destructive/40"
      >
        <div className="divide-y divide-border">
          <SettingsRow
            label="Export my data"
            description="Download a JSON file with your profile, videos, and comments metadata."
          >
            <Button
              variant="outline"
              onClick={() => void handleExportData()}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Export my data
            </Button>
          </SettingsRow>

          <SettingsRow
            label="Delete account"
            description="Permanently deletes your account, videos, and comments. This cannot be undone."
          >
            <ConfirmDialog
              trigger={
                <Button variant="destructive">
                  <Trash2 className="size-4" />
                  Delete account
                </Button>
              }
              title="Delete your account?"
              description="This permanently removes your account and all content you own across workspaces. There is no way to recover it."
              confirmLabel="Delete my account"
              destructive
              typeToConfirm="DELETE"
              onConfirm={handleDeleteAccount}
            />
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
