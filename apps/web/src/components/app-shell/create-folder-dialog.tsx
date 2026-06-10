"use client";

import * as React from "react";
import Link from "next/link";
import { FolderPlusIcon, Loader2Icon, PlusIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPlan, type PlanId } from "@/lib/plans";
import { api } from "@/trpc/react";

export function CreateFolderDialog({
  workspaceId,
  planId,
}: {
  workspaceId: string;
  planId: PlanId;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [isSpace, setIsSpace] = React.useState(false);

  const plan = getPlan(planId);
  const utils = api.useUtils();

  const createFolder = api.folder.create.useMutation({
    onSuccess: async () => {
      await utils.folder.list.invalidate({ workspaceId });
      toast.success(isSpace ? "Space created" : "Folder created");
      setOpen(false);
      setName("");
      setIsSpace(false);
    },
    onError: (error) => {
      toast.error(error.message || "Could not create the folder");
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createFolder.isPending) return;
    createFolder.mutate({ workspaceId, name: trimmed, isSpace });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setName("");
          setIsSpace(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <PlusIcon className="size-4" />
          <span className="sr-only">Create folder</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {plan.folders ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderPlusIcon className="size-5 text-primary" />
                Create a folder
              </DialogTitle>
              <DialogDescription>
                Folders keep your library organized. Spaces are shared team libraries
                everyone in the workspace can browse.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="create-folder-name">Name</Label>
                <Input
                  id="create-folder-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Product demos"
                  maxLength={100}
                  autoFocus
                />
              </div>
              {plan.teamSpaces && (
                <div className="flex items-start gap-2.5 rounded-lg border border-border p-3">
                  <Checkbox
                    id="create-folder-space"
                    checked={isSpace}
                    onCheckedChange={(checked) => setIsSpace(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1">
                    <Label htmlFor="create-folder-space">Make this a team Space</Label>
                    <p className="text-xs text-muted-foreground">
                      Spaces appear at the top of everyone&apos;s sidebar as a shared
                      library for the whole team.
                    </p>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={createFolder.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createFolder.isPending || name.trim().length === 0}
                >
                  {createFolder.isPending && (
                    <Loader2Icon className="size-4 animate-spin" />
                  )}
                  Create {isSpace ? "Space" : "folder"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SparklesIcon className="size-5 text-primary" />
                Folders are a Pro feature
              </DialogTitle>
              <DialogDescription>
                Upgrade your workspace to organize videos into folders and shared team
                Spaces, record without time limits, and unlock engagement insights.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Maybe later
              </Button>
              <Button asChild>
                <Link
                  href={`/app/w/${workspaceId}/settings/billing`}
                  onClick={() => setOpen(false)}
                >
                  Upgrade plan
                </Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
