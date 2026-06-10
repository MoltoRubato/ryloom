import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/api/root";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** The signed-in user's profile row, as returned by `user.me`. */
export type Me = RouterOutputs["user"]["me"];

/** One entry of `workspace.list` — the workspace row plus the caller's role. */
export type WorkspaceListItem = RouterOutputs["workspace"]["list"][number];
