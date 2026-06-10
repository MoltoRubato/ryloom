import Link from "next/link";
import {
  Archive,
  Clock,
  FileVideo,
  FolderOpen,
  Share2,
  Trash2,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

import type { LibraryView } from "@/components/library/types";
import { Button } from "@/components/ui/button";

type EmptyCopy = {
  icon: LucideIcon;
  title: string;
  description: string;
  cta?: "record" | "team";
};

const EMPTY_COPY: Record<LibraryView, EmptyCopy> = {
  my_videos: {
    icon: Video,
    title: "No videos yet",
    description: "Record your first video and it will show up here, ready to share with a link.",
    cta: "record",
  },
  workspace: {
    icon: Users,
    title: "The team library is empty",
    description: "Videos shared with the whole workspace will appear here for everyone.",
    cta: "record",
  },
  shared_with_me: {
    icon: Share2,
    title: "Nothing shared with you yet",
    description: "When someone shares a video directly with you, it will appear here.",
  },
  watch_later: {
    icon: Clock,
    title: "No videos saved for later",
    description: "Save videos to Watch later and pick them up when you have time.",
    cta: "team",
  },
  drafts: {
    icon: FileVideo,
    title: "No drafts",
    description: "Unfinished uploads and failed recordings will appear here.",
  },
  archived: {
    icon: Archive,
    title: "No archived videos",
    description: "Archive videos to tidy up your library without deleting them.",
  },
  trash: {
    icon: Trash2,
    title: "Trash is empty",
    description: "Deleted videos stay here for 30 days before being removed forever.",
  },
};

const FOLDER_COPY: EmptyCopy = {
  icon: FolderOpen,
  title: "This folder is empty",
  description: "Move videos into this folder or record a new one to get started.",
  cta: "record",
};

export function LibraryEmptyState({
  view,
  workspaceId,
  isFolder = false,
}: {
  view: LibraryView;
  workspaceId: string;
  isFolder?: boolean;
}) {
  const copy = isFolder ? FOLDER_COPY : EMPTY_COPY[view];
  const Icon = copy.icon;

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{copy.title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{copy.description}</p>
      {copy.cta === "record" && (
        <Button asChild className="mt-2">
          <Link href={`/record?workspaceId=${workspaceId}`}>
            <Video className="h-4 w-4" />
            Record a video
          </Link>
        </Button>
      )}
      {copy.cta === "team" && (
        <Button asChild variant="outline" className="mt-2">
          <Link href={`/app/w/${workspaceId}?view=workspace`}>Browse the team library</Link>
        </Button>
      )}
    </div>
  );
}
