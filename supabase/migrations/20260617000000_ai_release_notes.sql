-- New AI workflow type: "release_notes" turns a recording into changelog-ready
-- release notes. Added before "doc" to match the enum ordering in schema.ts.
alter type "public"."ai_output_type" add value if not exists 'release_notes' before 'doc';
