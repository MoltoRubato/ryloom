"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ClockIcon,
  FolderIcon,
  HomeIcon,
  LayersIcon,
  SettingsIcon,
  Trash2Icon,
  UsersIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlan, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

import { CreateFolderDialog } from "./create-folder-dialog";
import type { WorkspaceListItem } from "./types";
import { UpgradeCard } from "./upgrade-card";
import { WorkspaceSwitcher } from "./workspace-switcher";

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar({
  workspaces,
  workspaceId,
  planId,
  onNavigate,
}: {
  workspaces: WorkspaceListItem[];
  workspaceId: string;
  planId: PlanId;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const plan = getPlan(planId);

  const basePath = `/app/w/${workspaceId}`;
  const onLibrary = pathname === basePath || pathname === `${basePath}/library`;
  const currentView = searchParams.get("view") ?? "my_videos";

  const foldersQuery = api.folder.list.useQuery(
    { workspaceId },
    { staleTime: 30_000 },
  );

  const folders = React.useMemo(() => {
    const list = foldersQuery.data ?? [];
    return [...list].sort((a, b) => {
      if (a.folder.isSpace !== b.folder.isSpace) return a.folder.isSpace ? -1 : 1;
      if (a.folder.isPinned !== b.folder.isPinned) return a.folder.isPinned ? -1 : 1;
      return a.folder.name.localeCompare(b.folder.name);
    });
  }, [foldersQuery.data]);

  const navItems: {
    label: string;
    icon: LucideIcon;
    view: string;
    href: string;
  }[] = [
    { label: "My Library", icon: HomeIcon, view: "my_videos", href: basePath },
    {
      label: "Shared with me",
      icon: UsersIcon,
      view: "shared_with_me",
      href: `${basePath}?view=shared_with_me`,
    },
    {
      label: "Watch later",
      icon: ClockIcon,
      view: "watch_later",
      href: `${basePath}?view=watch_later`,
    },
    {
      label: "Trash",
      icon: Trash2Icon,
      view: "trash",
      href: `${basePath}?view=trash`,
    },
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-col gap-4 px-3 pt-4 pb-2">
        <Link
          href="/app"
          onClick={onNavigate}
          className="flex w-fit items-center gap-2 rounded-lg px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <VideoIcon className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Ryloom
          </span>
        </Link>
        <WorkspaceSwitcher
          workspaces={workspaces}
          workspaceId={workspaceId}
          onNavigate={onNavigate}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-0.5 px-3 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.view}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={onLibrary && currentView === item.view}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="px-3 pb-2">
          <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Folders &amp; Spaces
            </span>
            <CreateFolderDialog workspaceId={workspaceId} planId={planId} />
          </div>

          {foldersQuery.isPending ? (
            <div className="flex flex-col gap-1.5 px-2.5 py-1">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ) : folders.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {plan.folders
                ? "No folders yet — create one to organize your videos."
                : "Organize your library with folders and Spaces on a paid plan."}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {folders.map(({ folder, videoCount }) => {
                const href = `${basePath}/folder/${folder.id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={folder.id}
                    href={href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {folder.emoji ? (
                      <span className="flex size-4 shrink-0 items-center justify-center text-sm leading-none">
                        {folder.emoji}
                      </span>
                    ) : folder.isSpace ? (
                      <LayersIcon
                        className="size-4 shrink-0"
                        style={folder.color ? { color: folder.color } : undefined}
                      />
                    ) : (
                      <FolderIcon
                        className="size-4 shrink-0"
                        style={folder.color ? { color: folder.color } : undefined}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {videoCount}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
        <NavLink
          href={`${basePath}/settings`}
          icon={SettingsIcon}
          label="Settings"
          active={pathname.startsWith(`${basePath}/settings`)}
          onNavigate={onNavigate}
        />
        {planId === "free" && (
          <UpgradeCard workspaceId={workspaceId} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}
