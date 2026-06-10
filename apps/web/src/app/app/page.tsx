import { redirect } from "next/navigation";

import { api } from "@/trpc/server";

export default async function AppIndexPage() {
  const me = await api.user.me();
  const memberships = await api.workspace.list();

  const memberWorkspaceIds = new Set(memberships.map((row) => row.workspace.id));
  const workspaceId =
    me.defaultWorkspaceId && memberWorkspaceIds.has(me.defaultWorkspaceId)
      ? me.defaultWorkspaceId
      : memberships[0]?.workspace.id;

  if (!workspaceId) redirect("/onboarding");
  redirect(`/app/w/${workspaceId}`);
}
