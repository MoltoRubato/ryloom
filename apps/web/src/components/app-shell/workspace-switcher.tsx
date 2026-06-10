"use client";

import { useRouter } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPlan } from "@/lib/plans";
import { cn } from "@/lib/utils";

import type { WorkspaceListItem } from "./types";

function WorkspaceLogo({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-7 rounded-md", className)}>
      <AvatarImage src={logoUrl ?? undefined} alt={name} className="rounded-md" />
      <AvatarFallback className="rounded-md bg-primary/10 text-xs font-semibold text-primary">
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function WorkspaceSwitcher({
  workspaces,
  workspaceId,
  onNavigate,
}: {
  workspaces: WorkspaceListItem[];
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const active =
    workspaces.find((entry) => entry.workspace.id === workspaceId) ?? workspaces[0];

  if (!active) return null;

  const planName = getPlan(active.workspace.plan).name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left shadow-xs transition-colors outline-none hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <WorkspaceLogo
            name={active.workspace.name}
            logoUrl={active.workspace.logoUrl}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {active.workspace.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {planName} plan
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[232px]">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {workspaces.map((entry) => {
          const isActive = entry.workspace.id === active.workspace.id;
          return (
            <DropdownMenuItem
              key={entry.workspace.id}
              className="gap-2.5"
              onSelect={() => {
                if (!isActive) {
                  router.push(`/app/w/${entry.workspace.id}`);
                  onNavigate?.();
                }
              }}
            >
              <WorkspaceLogo
                name={entry.workspace.name}
                logoUrl={entry.workspace.logoUrl}
                className="size-6"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{entry.workspace.name}</span>
                <span className="block truncate text-xs text-muted-foreground capitalize">
                  {entry.role.replace(/_/g, " ")}
                </span>
              </span>
              {isActive && <CheckIcon className="size-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
