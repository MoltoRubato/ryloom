import { redirect } from "next/navigation";

import { SearchResults } from "@/components/library/search-results";
import { api } from "@/trpc/server";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const initialQuery = typeof sp.q === "string" ? sp.q : "";

  try {
    await api.workspace.get({ workspaceId });
  } catch {
    redirect("/app");
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <SearchResults workspaceId={workspaceId} initialQuery={initialQuery} />
    </main>
  );
}
