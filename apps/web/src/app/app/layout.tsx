import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/trpc/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await api.user.me();
  const workspaces = await api.workspace.list();

  if (!me.onboardingCompleted || workspaces.length === 0) {
    redirect("/onboarding");
  }

  const defaultWorkspaceId =
    workspaces.find((entry) => entry.workspace.id === me.defaultWorkspaceId)
      ?.workspace.id ?? workspaces[0]?.workspace.id;

  if (!defaultWorkspaceId) {
    redirect("/onboarding");
  }

  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AppShell
        me={me}
        workspaces={workspaces}
        defaultWorkspaceId={defaultWorkspaceId}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}

function AppShellSkeleton() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <div className="hidden w-64 shrink-0 flex-col gap-4 border-r border-border bg-card px-3 pt-4 md:flex">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-12 w-full" />
        <div className="flex flex-col gap-1.5 pt-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
          <Skeleton className="hidden h-9 w-full max-w-md sm:block" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>
        <div className="flex-1" />
      </div>
    </div>
  );
}
