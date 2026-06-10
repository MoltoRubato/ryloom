"use client";

import { useState } from "react";
import {
  AlignLeft,
  Bug,
  Check,
  ClipboardList,
  Copy,
  GitPullRequest,
  Hash,
  HelpCircle,
  Layers,
  ListChecks,
  ListVideo,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  NotebookPen,
  Pencil,
  RefreshCw,
  Sparkles,
  Type,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/trpc/react";
import { cn, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeAiOutputs, type WatchAiOutput } from "@/components/watch/types";

/** Mirrors the `ai_output_type` enum values used by `ai.generate`. */
type AiOutputType =
  | "title"
  | "summary"
  | "long_summary"
  | "chapters"
  | "action_items"
  | "bug_report"
  | "sop"
  | "email_draft"
  | "slack_message"
  | "pr_description"
  | "jira_issue"
  | "linear_issue"
  | "faq"
  | "meeting_notes"
  | "recap_email"
  | "doc";

type AiTypeDef = {
  type: AiOutputType;
  label: string;
  description: string;
  icon: LucideIcon;
};

const CORE_TYPES: AiTypeDef[] = [
  { type: "summary", label: "Summary", description: "A concise overview of the video", icon: AlignLeft },
  { type: "chapters", label: "Chapters", description: "Timestamped sections for the player", icon: ListVideo },
  { type: "action_items", label: "Action items", description: "Tasks and follow-ups mentioned", icon: ListChecks },
  { type: "title", label: "Title", description: "A better title suggestion", icon: Type },
];

const WORKFLOW_TYPES: AiTypeDef[] = [
  { type: "bug_report", label: "Bug report", description: "Repro steps and expected behavior", icon: Bug },
  { type: "sop", label: "SOP", description: "A step-by-step standard procedure", icon: ClipboardList },
  { type: "email_draft", label: "Email draft", description: "An email based on the video", icon: Mail },
  { type: "slack_message", label: "Slack message", description: "A short update for your team", icon: Hash },
  { type: "pr_description", label: "PR description", description: "A pull-request writeup", icon: GitPullRequest },
  { type: "jira_issue", label: "Jira issue", description: "A ready-to-file Jira ticket", icon: Layers },
  { type: "linear_issue", label: "Linear issue", description: "A ready-to-file Linear issue", icon: Layers },
  { type: "faq", label: "FAQ", description: "Questions and answers covered", icon: HelpCircle },
  { type: "meeting_notes", label: "Meeting notes", description: "Structured notes and decisions", icon: NotebookPen },
  { type: "recap_email", label: "Recap email", description: "A recap to send to attendees", icon: MailCheck },
];

function extractChapters(output: WatchAiOutput): { title: string; startMs: number }[] {
  const raw = output.contentJson?.chapters ?? output.contentJson?.items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title : null;
    const startMs = typeof row.startMs === "number" ? row.startMs : null;
    return title !== null && startMs !== null ? [{ title, startMs }] : [];
  });
}

function extractActionItems(output: WatchAiOutput): string[] {
  const raw =
    output.contentJson?.items ??
    output.contentJson?.actionItems ??
    output.contentJson?.action_items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (typeof entry === "object" && entry !== null) {
      const row = entry as Record<string, unknown>;
      const text = row.text ?? row.title ?? row.item;
      if (typeof text === "string") return [text];
    }
    return [];
  });
}

function copyText(output: WatchAiOutput) {
  const text =
    output.contentText ??
    (output.contentJson ? JSON.stringify(output.contentJson, null, 2) : "");
  void navigator.clipboard.writeText(text).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Couldn't copy"),
  );
}

export function AiPanel({
  videoId,
  workspaceId,
  className,
}: {
  videoId: string;
  workspaceId: string;
  className?: string;
}) {
  const utils = api.useUtils();
  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const workflowsUnlocked = workspaceQuery.data?.plan.aiWorkflows === true;

  const listQuery = api.ai.list.useQuery(
    { videoId },
    {
      refetchInterval: (query) => {
        const outputs = normalizeAiOutputs(query.state.data);
        return outputs.some((o) => o.status === "pending" || o.status === "processing")
          ? 3000
          : false;
      },
    },
  );
  const outputs = normalizeAiOutputs(listQuery.data);

  // Latest output per type.
  const latestByType = new Map<string, WatchAiOutput>();
  for (const output of [...outputs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    latestByType.set(output.type, output);
  }

  const generate = api.ai.generate.useMutation({
    onSuccess: () => void utils.ai.list.invalidate({ videoId }),
    onError: (error) => toast.error(error.message || "Couldn't start generation"),
  });
  const updateContent = api.ai.updateContent.useMutation({
    onSuccess: () => {
      void utils.ai.list.invalidate({ videoId });
      toast.success("Saved");
    },
    onError: (error) => toast.error(error.message || "Couldn't save"),
  });
  const applyChapters = api.ai.applyChaptersToVideo.useMutation({
    onSuccess: () => {
      void utils.video.get.invalidate({ videoId });
      toast.success("Chapters applied to the player");
    },
    onError: (error) => toast.error(error.message || "Couldn't apply chapters"),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const renderCard = (def: AiTypeDef, locked: boolean) => {
    const output = latestByType.get(def.type);
    const isGenerating =
      output?.status === "pending" ||
      output?.status === "processing" ||
      (generate.isPending && generate.variables?.type === def.type);
    const Icon = def.icon;

    const card = (
      <Card
        key={def.type}
        className={cn("flex flex-col gap-0 py-0", locked && "opacity-60")}
      >
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            {locked ? (
              <Lock className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Icon className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{def.label}</p>
            <p className="truncate text-xs text-muted-foreground">{def.description}</p>
          </div>
          {output?.editedByUser && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Edited
            </Badge>
          )}
          <Button
            variant={output?.status === "ready" ? "ghost" : "outline"}
            size="sm"
            className="shrink-0"
            disabled={locked || isGenerating}
            onClick={() => generate.mutate({ videoId, type: def.type })}
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : output ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isGenerating ? "Generating…" : output ? "Regenerate" : "Generate"}
          </Button>
        </CardHeader>

        {output && !locked && (
          <CardContent className="border-t border-border px-4 py-3">
            {isGenerating ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Working on it — this usually takes a few seconds…
              </div>
            ) : output.status === "failed" ? (
              <p className="py-2 text-sm text-destructive">
                {output.errorMessage ?? "Generation failed. Try again."}
              </p>
            ) : editingId === output.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={8}
                  autoFocus
                  className="font-mono text-xs"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={updateContent.isPending}
                    onClick={() =>
                      updateContent.mutate(
                        { aiOutputId: output.id, contentText: editText },
                        { onSuccess: () => setEditingId(null) },
                      )
                    }
                  >
                    {updateContent.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <OutputBody output={output} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyText(output)}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingId(output.id);
                      setEditText(
                        output.contentText ??
                          (output.contentJson
                            ? JSON.stringify(output.contentJson, null, 2)
                            : ""),
                      );
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {def.type === "chapters" && extractChapters(output).length > 0 && (
                    <Button
                      size="sm"
                      disabled={applyChapters.isPending}
                      onClick={() => applyChapters.mutate({ aiOutputId: output.id })}
                    >
                      {applyChapters.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ListVideo className="h-3.5 w-3.5" />
                      )}
                      Apply to player
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        )}
      </Card>
    );

    if (!locked) return card;
    return (
      <Tooltip key={def.type}>
        <TooltipTrigger asChild>
          <div>{card}</div>
        </TooltipTrigger>
        <TooltipContent>
          AI workflows require the Business + AI plan. Upgrade to unlock.
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn("space-y-6", className)}>
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            AI insights
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {CORE_TYPES.map((def) => renderCard(def, false))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-primary" />
              AI workflows
            </h3>
            {!workflowsUnlocked && (
              <Badge variant="secondary" className="text-[10px]">
                Business + AI
              </Badge>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {WORKFLOW_TYPES.map((def) => renderCard(def, !workflowsUnlocked))}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}

function OutputBody({ output }: { output: WatchAiOutput }) {
  if (output.type === "chapters") {
    const chapters = extractChapters(output);
    if (chapters.length > 0) {
      return (
        <ul className="space-y-1">
          {chapters.map((chapter, i) => (
            <li key={i} className="flex items-baseline gap-3 text-sm">
              <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDuration(chapter.startMs)}
              </span>
              <span>{chapter.title}</span>
            </li>
          ))}
        </ul>
      );
    }
  }
  if (output.type === "action_items") {
    const items = extractActionItems(output);
    if (items.length > 0) {
      return (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
  }
  return (
    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
      {output.contentText ??
        (output.contentJson ? JSON.stringify(output.contentJson, null, 2) : "")}
    </pre>
  );
}
