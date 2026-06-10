import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/api/root";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** One row from `video.list` — `{ video, owner }`. */
export type VideoListItem = RouterOutputs["video"]["list"]["items"][number];

/** One row from `folder.list` — `{ folder, videoCount }`. */
export type FolderListItem = RouterOutputs["folder"]["list"][number];

/** The `video.list` views the library UI exposes as tabs. */
export type LibraryView =
  | "my_videos"
  | "workspace"
  | "shared_with_me"
  | "watch_later"
  | "drafts"
  | "archived"
  | "trash";

export const LIBRARY_VIEWS: readonly LibraryView[] = [
  "my_videos",
  "workspace",
  "shared_with_me",
  "watch_later",
  "drafts",
  "archived",
  "trash",
];

export const LIBRARY_PAGE_SIZE = 24;
