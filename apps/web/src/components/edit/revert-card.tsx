"use client";

import { History, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/trpc/react";

type RevertCardProps = {
  videoId: string;
  disabled: boolean;
  onJobStarted: () => void;
};

/** Shown only when an original_backup asset exists for the video. */
export function RevertCard({ videoId, disabled, onJobStarted }: RevertCardProps) {
  const mutation = api.video.revertToOriginal.useMutation({
    onSuccess: () => {
      toast.info("Restoring the original recording…");
      onJobStarted();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card className="border-dashed shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" />
          Revert to original
        </CardTitle>
        <CardDescription>
          This video has been edited. A backup of the original recording is stored — you
          can restore it at any time.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full" disabled={disabled || mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <History className="size-4" />
              )}
              Revert to original
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revert to the original recording?</AlertDialogTitle>
              <AlertDialogDescription>
                Your edited version will be replaced by the original backup. Trims,
                silence removal and filler-word edits applied to this video will be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => mutation.mutate({ videoId })}>
                Revert
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
