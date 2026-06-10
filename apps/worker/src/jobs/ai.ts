import { createHash } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  aiOutputs,
  notifications,
  transcriptSegments,
  transcripts,
  videos,
  workspaceUsage,
  type VideoChapter,
} from "@ryloom/db";

import { db } from "../db";
import { env } from "../env";
import { chatJson, chatText } from "../providers/llm";
import { type ClaimedJob } from "../queue";
import { getVideoOrThrow } from "./_shared";

const aiInput = z.object({
  aiOutputId: z.string().uuid(),
  outputType: z.string().min(1),
});

const TRANSCRIPT_CHAR_LIMIT = 24_000;
const SEGMENT_MAP_MAX_LINES = 100;

type AiOutputType = (typeof aiOutputs.$inferSelect)["type"];

type PromptDef = {
  instruction: string;
  json: boolean;
  /** Include the timestamped segment map in the user message. */
  segmentMap?: boolean;
};

const SYSTEM_PROMPT =
  "You are the Ryloom AI assistant. You are given the transcript of a screen recording (an async video message — e.g. a product walkthrough, bug demo, code review, or update). " +
  "Complete the requested task using only information supported by the transcript. Never invent names, numbers, or events that are not in it. " +
  "When asked for JSON, respond with a single valid JSON object and nothing else.";

const PROMPTS: Record<AiOutputType, PromptDef> = {
  title: {
    json: false,
    instruction:
      "Write a concise, descriptive title for this recording. At most 8 words. Plain text only — no surrounding quotes, no trailing punctuation, no markdown.",
  },
  summary: {
    json: false,
    instruction:
      "Summarize this recording: 2-3 sentences capturing its purpose and outcome, followed by a short markdown bullet list of the key points.",
  },
  long_summary: {
    json: false,
    instruction:
      "Write a detailed, multi-paragraph markdown summary of this recording. Cover everything discussed or demonstrated, in order, with headings where natural.",
  },
  chapters: {
    json: true,
    segmentMap: true,
    instruction:
      'Split this recording into 3-12 chapters. Use the timestamped segment map to pick accurate start times. Respond with JSON: {"chapters":[{"title":"Short chapter title","startMs":0}]} — startMs is an integer in milliseconds, chapters are in chronological order, and the first chapter starts at 0.',
  },
  action_items: {
    json: true,
    instruction:
      'Extract every action item, task, commitment, or follow-up mentioned in the recording. Respond with JSON: {"items":[{"text":"The action item phrased as a clear task"}]}. Return {"items":[]} if there are none.',
  },
  bug_report: {
    json: false,
    instruction:
      "Write a bug report in markdown based on this recording, with the sections: ## Summary, ## Steps to Reproduce (numbered list), ## Expected Behavior, ## Actual Behavior, ## Additional Context.",
  },
  sop: {
    json: false,
    instruction:
      "Turn this recording into a standard operating procedure (SOP): a markdown document with a one-line purpose statement followed by precise numbered steps someone can follow to reproduce the process shown.",
  },
  email_draft: {
    json: false,
    instruction:
      "Draft a professional email summarizing this recording for someone who has not watched it. Put the subject on the first line as 'Subject: ...', then the body. Keep it concise and actionable.",
  },
  slack_message: {
    json: false,
    instruction:
      "Write a short, friendly Slack message summarizing this recording — a sentence or two of context plus a compact bullet list of takeaways. Casual tone, emoji welcome but sparing.",
  },
  pr_description: {
    json: false,
    instruction:
      "Write a pull request description in markdown based on this recording, with the sections: ## What changed, ## Why, ## How to test.",
  },
  jira_issue: {
    json: true,
    instruction:
      'Create a Jira issue from this recording. Respond with JSON: {"summary":"One-line issue summary","description":"Detailed description in plain text with newlines","priority":"Highest|High|Medium|Low|Lowest"}.',
  },
  linear_issue: {
    json: true,
    instruction:
      'Create a Linear issue from this recording. Respond with JSON: {"title":"One-line issue title","description":"Detailed markdown description","priority":"Urgent|High|Medium|Low|No priority"}.',
  },
  faq: {
    json: false,
    instruction:
      "Write an FAQ in markdown covering what this recording explains: 5-10 question-and-answer pairs, each question as a ### heading followed by a concise answer.",
  },
  meeting_notes: {
    json: false,
    instruction:
      "Write meeting notes in markdown for this recording: participants (if identifiable), ## Discussion points, ## Decisions, ## Next steps.",
  },
  recap_email: {
    json: false,
    instruction:
      "Write a recap email for the people involved in this recording. Put the subject on the first line as 'Subject: ...', then a brief recap of what was covered, decisions made, and next steps with owners where mentioned.",
  },
  doc: {
    json: false,
    instruction:
      "Turn this recording into a well-structured markdown document suitable for a knowledge base: a title heading, an intro paragraph, and organized sections with headings covering everything shown or explained.",
  },
};

const chaptersSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        startMs: z.coerce.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
});

const actionItemsSchema = z.object({
  items: z.array(z.object({ text: z.string().min(1) }).passthrough()),
});

function humanizeType(type: string): string {
  return type.replace(/_/g, " ");
}

export async function runAiGenerateJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  const input = aiInput.parse(job.inputJson);

  const output = await db.query.aiOutputs.findFirst({
    where: eq(aiOutputs.id, input.aiOutputId),
  });
  if (!output) throw new Error(`ai_outputs row ${input.aiOutputId} not found`);

  const video = await getVideoOrThrow(output.videoId);

  const markFailed = async (message: string) => {
    await db
      .update(aiOutputs)
      .set({ status: "failed", errorMessage: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(aiOutputs.id, output.id));
  };

  if (!env.llmProvider) {
    await markFailed(
      "No OPENAI_API_KEY or GEMINI_API_KEY configured — AI generation is disabled",
    );
    return { aiOutputId: output.id, status: "failed", reason: "no_ai_key" };
  }

  const def = PROMPTS[output.type];

  const transcript = await db.query.transcripts.findFirst({
    where: and(eq(transcripts.videoId, video.id), eq(transcripts.status, "ready")),
    orderBy: desc(transcripts.createdAt),
  });
  if (!transcript?.fullText) {
    await markFailed("No transcript is available for this video yet");
    return { aiOutputId: output.id, status: "failed", reason: "no_transcript" };
  }

  await db
    .update(aiOutputs)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(eq(aiOutputs.id, output.id));

  try {
    const transcriptText = transcript.fullText.slice(0, TRANSCRIPT_CHAR_LIMIT);

    // Sampled "segment map" — timestamped first-words lines so the model can
    // anchor chapters to real playhead positions.
    let segmentMap = "";
    if (def.segmentMap) {
      const segs = await db.query.transcriptSegments.findMany({
        where: eq(transcriptSegments.transcriptId, transcript.id),
        orderBy: asc(transcriptSegments.idx),
      });
      const step = Math.max(1, Math.ceil(segs.length / SEGMENT_MAP_MAX_LINES));
      const lines = segs
        .filter((_, i) => i % step === 0)
        .map((s) => `[${s.startMs}ms] ${s.text.split(/\s+/).slice(0, 10).join(" ")}`);
      segmentMap = `\n\nTimestamped segment map (start time + first words of each segment):\n${lines.join("\n")}`;
    }

    const userMessage = [
      def.instruction,
      `\nVideo title: ${video.title}`,
      video.durationMs ? `Duration: ${Math.round(video.durationMs / 1000)}s` : "",
      `\nTranscript:\n"""\n${transcriptText}\n"""`,
      segmentMap,
    ]
      .filter(Boolean)
      .join("\n");

    let contentText: string | null = null;
    let contentJson: Record<string, unknown> | null = null;
    let chapters: VideoChapter[] | null = null;

    if (def.json) {
      const parsed = await chatJson({ system: SYSTEM_PROMPT, user: userMessage });
      if (output.type === "chapters") {
        const validated = chaptersSchema.parse(parsed);
        const maxMs = video.durationMs ?? Number.MAX_SAFE_INTEGER;
        chapters = validated.chapters
          .map((c) => ({ title: c.title.trim(), startMs: Math.min(c.startMs, maxMs) }))
          .sort((a, b) => a.startMs - b.startMs);
        const first = chapters[0];
        if (first) first.startMs = 0;
        contentJson = { chapters };
      } else if (output.type === "action_items") {
        const validated = actionItemsSchema.parse(parsed);
        contentJson = { items: validated.items };
      } else {
        contentJson = parsed;
      }
    } else {
      const content = await chatText({ system: SYSTEM_PROMPT, user: userMessage });
      // Strip wrapping quotes/code fences models occasionally add.
      contentText = content
        .replace(/^```[a-z]*\n?/i, "")
        .replace(/\n?```$/, "")
        .replace(/^"(.*)"$/s, "$1")
        .trim();
    }

    await db
      .update(aiOutputs)
      .set({
        status: "ready",
        model: env.AI_MODEL,
        contentText,
        contentJson,
        inputTranscriptHash: createHash("sha256").update(transcriptText).digest("hex"),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(aiOutputs.id, output.id));

    // Side effects on the videos row.
    if (output.type === "title" && contentText && video.title.startsWith("Recording —")) {
      await db
        .update(videos)
        .set({ title: contentText.slice(0, 300), updatedAt: new Date() })
        .where(eq(videos.id, video.id));
    }
    if (output.type === "chapters" && chapters) {
      await db
        .update(videos)
        .set({ chapters, updatedAt: new Date() })
        .where(eq(videos.id, video.id));
    }

    await db.insert(notifications).values({
      userId: video.ownerId,
      type: "ai_ready",
      workspaceId: video.workspaceId,
      videoId: video.id,
      title: `AI ${humanizeType(output.type)} is ready`,
      body: video.title,
      data: { aiOutputId: output.id, outputType: output.type },
    });

    // Usage rollup — auto-generated outputs are enqueued by the worker, so the
    // worker owns the aiGenerations counter.
    const period = new Date().toISOString().slice(0, 7);
    await db
      .insert(workspaceUsage)
      .values({ workspaceId: video.workspaceId, period, aiGenerations: 1 })
      .onConflictDoUpdate({
        target: [workspaceUsage.workspaceId, workspaceUsage.period],
        set: {
          aiGenerations: sql`${workspaceUsage.aiGenerations} + 1`,
          updatedAt: new Date(),
        },
      });

    return { aiOutputId: output.id, outputType: output.type, status: "ready" };
  } catch (error) {
    // Record the failure on the output row, then rethrow so the queue can
    // retry (the handler flips the row back to processing on the next run).
    await markFailed(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
