-- Row Level Security.
--
-- The Next.js app and the worker connect as the table owner (postgres role)
-- and enforce authorization in application code. RLS here locks down the
-- PostgREST surface (anon / authenticated roles): everything is deny-by-default,
-- with narrow read policies only where direct client reads are safe.

alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.workspace_invites   enable row level security;
alter table public.folders             enable row level security;
alter table public.videos              enable row level security;
alter table public.video_assets        enable row level security;
alter table public.video_permissions   enable row level security;
alter table public.video_shares        enable row level security;
alter table public.watch_later         enable row level security;
alter table public.recording_sessions  enable row level security;
alter table public.processing_jobs     enable row level security;
alter table public.transcripts         enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.ai_outputs          enable row level security;
alter table public.comments            enable row level security;
alter table public.reactions           enable row level security;
alter table public.view_sessions       enable row level security;
alter table public.view_events         enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.workspace_usage     enable row level security;
alter table public.integrations       enable row level security;
alter table public.api_tokens          enable row level security;

-- Users may read/update their own profile directly (used by supabase-js).
create policy "profiles self read" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Members may read their own membership rows and their workspaces.
create policy "members self read" on public.workspace_members
  for select to authenticated using (user_id = auth.uid());
create policy "workspaces member read" on public.workspaces
  for select to authenticated using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = id and wm.user_id = auth.uid() and wm.status = 'active'
    )
  );

-- Users may read their own notifications (enables supabase realtime later).
create policy "notifications self read" on public.notifications
  for select to authenticated using (user_id = auth.uid());

-- Everything else: no policies — API server (table owner) only.
