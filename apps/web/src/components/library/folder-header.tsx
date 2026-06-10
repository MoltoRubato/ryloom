"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Folder, Loader2, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/trpc/react";

export function FolderHeader({
  workspaceId,
  folderId,
}: {
  workspaceId: string;
  folderId: string;
}) {
  const router = useRouter();
  const utils = api.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState("");

  const foldersQuery = api.folder.list.useQuery({ workspaceId });
  const row = foldersQuery.data?.find((entry) => entry.folder.id === folderId);

  const updateFolder = api.folder.update.useMutation({
    onSuccess: async () => {
      toast.success("Folder renamed");
      await utils.folder.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteFolder = api.folder.delete.useMutation({
    onSuccess: async () => {
      toast.success("Folder deleted — its videos moved back to the library");
      await Promise.all([utils.folder.list.invalidate(), utils.video.list.invalidate()]);
      router.push(`/app/w/${workspaceId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  function startEditing() {
    if (!row) return;
    setDraftName(row.folder.name);
    setIsEditing(true);
  }

  function commitRename() {
    setIsEditing(false);
    if (!row) return;
    const next = draftName.trim();
    if (!next || next === row.folder.name) return;
    updateFolder.mutate({ folderId, name: next });
  }

  if (foldersQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-3">
        <Link
          href={`/app/w/${workspaceId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to library
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Folder not found</h1>
        <p className="text-sm text-muted-foreground">
          This folder may have been deleted or you no longer have access to it.
        </p>
      </div>
    );
  }

  const videoCount = Number(row.videoCount);

  return (
    <div className="space-y-3">
      <Link
        href={`/app/w/${workspaceId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to library
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            {row.folder.emoji ? (
              <span className="text-xl leading-none">{row.folder.emoji}</span>
            ) : row.folder.isSpace ? (
              <Users className="h-5 w-5 text-primary" />
            ) : (
              <Folder className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            {isEditing ? (
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") setIsEditing(false);
                }}
                autoFocus
                maxLength={100}
                className="h-9 max-w-xs text-lg font-semibold"
                aria-label="Folder name"
              />
            ) : (
              <div className="flex items-center gap-2">
                <h1
                  className="truncate text-2xl font-semibold tracking-tight text-foreground"
                  onDoubleClick={startEditing}
                  title={row.folder.name}
                >
                  {row.folder.name}
                </h1>
                {row.folder.isSpace && <Badge variant="secondary">Space</Badge>}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  onClick={startEditing}
                  aria-label="Rename folder"
                >
                  {updateFolder.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Pencil className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {videoCount} {videoCount === 1 ? "video" : "videos"}
            </p>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteFolder.isPending}
            >
              {deleteFolder.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete folder
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{row.folder.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The folder will be deleted and any videos inside it will move back to the
                library. The videos themselves are not deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteFolder.mutate({ folderId })}
              >
                Delete folder
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
