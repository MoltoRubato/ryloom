"use client";

import type { ReactNode } from "react";
import { Check, Folder, Library, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

export function MoveToFolderDialog({
  open,
  onOpenChange,
  videoId,
  workspaceId,
  currentFolderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  workspaceId: string;
  currentFolderId: string | null;
}) {
  const utils = api.useUtils();
  const foldersQuery = api.folder.list.useQuery({ workspaceId }, { enabled: open });

  const move = api.video.moveToFolder.useMutation({
    onSuccess: async (_data, vars) => {
      toast.success(vars.folderId ? "Video moved to folder" : "Video moved to your library");
      await Promise.all([utils.video.list.invalidate(), utils.folder.list.invalidate()]);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = foldersQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to folder</DialogTitle>
          <DialogDescription>Choose where this video should live.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          <DestinationRow
            icon={<Library className="h-4 w-4 text-muted-foreground" />}
            name="Library"
            detail="No folder"
            isCurrent={currentFolderId === null}
            disabled={move.isPending}
            onSelect={() => move.mutate({ videoId, folderId: null })}
          />
          {foldersQuery.isLoading ? (
            <div className="space-y-2 py-1">
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ) : (
            rows.map((row) => (
              <DestinationRow
                key={row.folder.id}
                icon={
                  row.folder.emoji ? (
                    <span className="text-base leading-none">{row.folder.emoji}</span>
                  ) : row.folder.isSpace ? (
                    <Users className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Folder className="h-4 w-4 text-muted-foreground" />
                  )
                }
                name={row.folder.name}
                detail={`${row.videoCount} ${Number(row.videoCount) === 1 ? "video" : "videos"}`}
                isCurrent={currentFolderId === row.folder.id}
                disabled={move.isPending}
                onSelect={() => move.mutate({ videoId, folderId: row.folder.id })}
              />
            ))
          )}
          {!foldersQuery.isLoading && rows.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No folders in this workspace yet.
            </p>
          )}
        </div>
        {move.isPending && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Moving…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DestinationRow({
  icon,
  name,
  detail,
  isCurrent,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  isCurrent: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || isCurrent}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed",
        isCurrent ? "bg-accent" : "hover:bg-accent/60",
        disabled && !isCurrent && "opacity-60",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
      {isCurrent && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}
