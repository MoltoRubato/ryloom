"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/trpc/react";

type DetailsCardProps = {
  videoId: string;
  title: string;
  description: string | null;
};

export function DetailsCard({ videoId, title, description }: DetailsCardProps) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const [descriptionValue, setDescriptionValue] = useState(description ?? "");

  useEffect(() => {
    if (dirty) return;
    setTitleValue(title);
    setDescriptionValue(description ?? "");
  }, [title, description, dirty]);

  const update = api.video.update.useMutation({
    onSuccess: () => {
      toast.success("Details saved");
      setDirty(false);
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function handleSave() {
    const trimmedTitle = titleValue.trim();
    if (!trimmedTitle) {
      toast.error("A title is required");
      return;
    }
    const trimmedDescription = descriptionValue.trim();
    update.mutate({
      videoId,
      title: trimmedTitle,
      description: trimmedDescription.length > 0 ? trimmedDescription : null,
    });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PenLine className="size-4 text-primary" />
          Details
        </CardTitle>
        <CardDescription>Title and description shown to viewers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`details-title-${videoId}`}>Title</Label>
          <Input
            id={`details-title-${videoId}`}
            value={titleValue}
            maxLength={300}
            onChange={(e) => {
              setDirty(true);
              setTitleValue(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`details-description-${videoId}`}>Description</Label>
          <Textarea
            id={`details-description-${videoId}`}
            value={descriptionValue}
            maxLength={5000}
            rows={4}
            placeholder="What is this video about?"
            onChange={(e) => {
              setDirty(true);
              setDescriptionValue(e.target.value);
            }}
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={update.isPending || !dirty}
          onClick={handleSave}
        >
          {update.isPending && <Loader2 className="size-4 animate-spin" />}
          Save details
        </Button>
      </CardFooter>
    </Card>
  );
}
