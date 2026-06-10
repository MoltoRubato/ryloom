"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/trpc/react";

export function CreateFolderButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const utils = api.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [name, setName] = useState("");

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });

  const createFolder = api.folder.create.useMutation({
    onSuccess: async (created) => {
      toast.success("Folder created");
      setCreateOpen(false);
      setName("");
      await utils.folder.list.invalidate();
      router.push(`/app/w/${workspaceId}/folder/${created.id}`);
    },
    onError: (err) => {
      if (err.message.toLowerCase().includes("upgrade")) {
        setCreateOpen(false);
        setUpgradeOpen(true);
      } else {
        toast.error(err.message);
      }
    },
  });

  function handleClick() {
    const plan = workspaceQuery.data?.plan;
    if (plan && !plan.folders) {
      setUpgradeOpen(true);
      return;
    }
    setCreateOpen(true);
  }

  return (
    <>
      <Button variant="outline" onClick={handleClick}>
        <FolderPlus className="h-4 w-4" />
        New folder
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Folders keep your library organized. Videos can be moved between folders at any
              time.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed || createFolder.isPending) return;
              createFolder.mutate({ workspaceId, name: trimmed });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Product demos"
                autoFocus
                maxLength={100}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || createFolder.isPending}>
                {createFolder.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create folder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Organize with folders</DialogTitle>
            <DialogDescription>
              Folders are available on the Pro plan and above. Upgrade to keep your library tidy
              with folders and team spaces.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpgradeOpen(false)}>
              Maybe later
            </Button>
            <Button asChild>
              <Link href={`/app/w/${workspaceId}/settings/billing`}>Upgrade plan</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
