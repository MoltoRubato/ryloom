"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PlanId } from "@/lib/plans";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { Me, WorkspaceListItem } from "./types";

export function AppShell({
  me,
  workspaces,
  defaultWorkspaceId,
  children,
}: {
  me: Me;
  workspaces: WorkspaceListItem[];
  defaultWorkspaceId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const workspaceId = React.useMemo(() => {
    const match = /^\/app\/w\/([^/?]+)/.exec(pathname);
    return match?.[1] ?? defaultWorkspaceId;
  }, [pathname, defaultWorkspaceId]);

  const activeWorkspace = workspaces.find(
    (entry) => entry.workspace.id === workspaceId,
  );
  const planId: PlanId = activeWorkspace?.workspace.plan ?? "free";

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:block">
        <Sidebar
          workspaces={workspaces}
          workspaceId={workspaceId}
          planId={planId}
        />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-card p-0 sm:max-w-72">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>
              Browse your library, folders, and workspace settings.
            </SheetDescription>
          </SheetHeader>
          <Sidebar
            workspaces={workspaces}
            workspaceId={workspaceId}
            planId={planId}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          me={me}
          workspaceId={workspaceId}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto bg-background">{children}</main>
      </div>
    </div>
  );
}
