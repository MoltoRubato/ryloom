-- Non-destructive editing: trims/silence/filler edits are applied client-side
-- from this column the moment they are requested, while the worker re-renders
-- in the background and swaps playback_url. Null = no edit in flight.
alter table "public"."videos" add column if not exists "pending_edit_ranges" jsonb;
