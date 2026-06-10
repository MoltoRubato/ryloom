import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  requireMembership,
} from "@/server/api/trpc";

/**
 * Raw row shape returned by the FTS query below. The `fts` tsvector columns
 * exist only in the database (supabase/migrations/20260610000500_fts.sql),
 * not in the Drizzle schema, so this router speaks raw SQL.
 */
type SearchRow = {
  id: string;
  title: string;
  description: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
  custom_thumbnail_url: string | null;
  status: string;
  privacy: string;
  view_count: number;
  comment_count: number;
  share_token: string;
  folder_id: string | null;
  created_at: Date;
  owner_id: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  owner_email: string;
  matched_in: "title" | "transcript" | "summary" | "comment";
  snippet: string | null;
  rank: number;
};

const HEADLINE_OPTS = "MaxWords=18, MinWords=6, ShortWord=2";

export const searchRouter = createTRPCRouter({
  /**
   * Workspace-wide full-text search over video titles/descriptions/tags,
   * transcripts, AI summaries and comments. One row per video, preferring
   * title matches, ranked by relevance.
   */
  videos: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx, input.workspaceId);
      const query = input.query.trim();
      if (!query) return [];

      const rows = await ctx.db.execute<SearchRow>(sql`
        with q as (
          select websearch_to_tsquery('english', ${query}) as tsq
        ),
        matches as (
          select v.id as video_id,
                 'title'::text as matched_in,
                 ts_rank(v.fts, q.tsq) as rank,
                 ts_headline('english',
                             coalesce(v.title, '') || '. ' || coalesce(v.description, ''),
                             q.tsq, ${HEADLINE_OPTS}) as snippet,
                 1 as priority
            from videos v
           cross join q
           where v.workspace_id = ${input.workspaceId}
             and v.fts @@ q.tsq

          union all

          select t.video_id,
                 'transcript'::text,
                 ts_rank(t.fts, q.tsq),
                 ts_headline('english', coalesce(t.full_text, ''), q.tsq, ${HEADLINE_OPTS}),
                 2
            from transcripts t
            join videos v on v.id = t.video_id
           cross join q
           where v.workspace_id = ${input.workspaceId}
             and t.fts @@ q.tsq

          union all

          select a.video_id,
                 'summary'::text,
                 ts_rank(a.fts, q.tsq),
                 ts_headline('english', coalesce(a.content_text, ''), q.tsq, ${HEADLINE_OPTS}),
                 3
            from ai_outputs a
            join videos v on v.id = a.video_id
           cross join q
           where v.workspace_id = ${input.workspaceId}
             and a.type in ('summary', 'long_summary')
             and a.fts @@ q.tsq

          union all

          select c.video_id,
                 'comment'::text,
                 ts_rank(c.fts, q.tsq),
                 ts_headline('english', c.body, q.tsq, ${HEADLINE_OPTS}),
                 4
            from comments c
            join videos v on v.id = c.video_id
           cross join q
           where v.workspace_id = ${input.workspaceId}
             and c.status <> 'deleted'
             and c.fts @@ q.tsq
        ),
        best as (
          select distinct on (video_id) video_id, matched_in, rank, snippet
            from matches
           order by video_id, priority asc, rank desc
        )
        select v.id, v.title, v.description, v.duration_ms, v.thumbnail_url,
               v.custom_thumbnail_url, v.status, v.privacy, v.view_count,
               v.comment_count, v.share_token, v.folder_id, v.created_at,
               v.owner_id,
               p.name as owner_name, p.avatar_url as owner_avatar_url,
               p.email as owner_email,
               b.matched_in, b.snippet, b.rank
          from best b
          join videos v on v.id = b.video_id
          join profiles p on p.id = v.owner_id
         where v.workspace_id = ${input.workspaceId}
           and v.status in ('ready', 'processing')
           and (
             v.privacy in ('workspace', 'public', 'password')
             or v.owner_id = ${ctx.user.id}
           )
         order by b.rank desc, v.created_at desc
         limit ${input.limit}
      `);

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        durationMs: row.duration_ms,
        thumbnailUrl: row.custom_thumbnail_url ?? row.thumbnail_url,
        status: row.status,
        privacy: row.privacy,
        viewCount: row.view_count,
        commentCount: row.comment_count,
        shareToken: row.share_token,
        folderId: row.folder_id,
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
        owner: {
          id: row.owner_id,
          name: row.owner_name,
          avatarUrl: row.owner_avatar_url,
          email: row.owner_email,
        },
        matchedIn: row.matched_in,
        snippet: row.snippet,
        rank: Number(row.rank),
      }));
    }),
});
