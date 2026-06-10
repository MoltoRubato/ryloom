import OpenAI from "openai";

import { env } from "../env";

/**
 * Provider-agnostic chat helpers. Both providers are driven through the
 * `openai` SDK — Gemini exposes an OpenAI-compatible Chat Completions
 * endpoint, so the only difference is the baseURL + API key.
 */

const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

export type ChatOpts = {
  system: string;
  user: string;
  /** Overrides env.AI_MODEL for this call. */
  model?: string;
};

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  if (env.llmProvider === "openai") {
    cachedClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  } else if (env.llmProvider === "gemini") {
    cachedClient = new OpenAI({
      apiKey: env.GEMINI_API_KEY,
      baseURL: GEMINI_OPENAI_BASE_URL,
    });
  } else {
    throw new Error(
      "No AI provider configured — set OPENAI_API_KEY or GEMINI_API_KEY",
    );
  }
  return cachedClient;
}

async function chat(opts: ChatOpts, json: boolean): Promise<string> {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: opts.model ?? env.AI_MODEL,
    temperature: 0.4,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    ...(json ? { response_format: { type: "json_object" as const } } : {}),
  });
  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("AI model returned an empty response");
  return content;
}

/** Plain-text completion (system + user message). */
export async function chatText(opts: ChatOpts): Promise<string> {
  return chat(opts, false);
}

/**
 * JSON completion: requests response_format json_object and parses the reply
 * tolerantly (markdown fences and surrounding prose are stripped).
 */
export async function chatJson(opts: ChatOpts): Promise<Record<string, unknown>> {
  const content = await chat(opts, true);
  return parseJsonObject(content);
}

/**
 * Tolerant JSON-object parsing for model output: strips ```json fences and any
 * leading/trailing prose around the outermost {...} before JSON.parse. Throws
 * a clear error (with a 200-char excerpt of the raw reply) on failure.
 */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();

  // Prefer the contents of a fenced code block if one exists anywhere.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  // Strip leading/trailing prose around the outermost JSON value.
  const first = text.search(/[{[]/);
  if (first > 0) text = text.slice(first);
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last !== -1 && last < text.length - 1) text = text.slice(0, last + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `AI model returned unparseable JSON. Reply began with: ${raw.slice(0, 200)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `AI model returned JSON that is not an object. Reply began with: ${raw.slice(0, 200)}`,
    );
  }
  return parsed as Record<string, unknown>;
}
