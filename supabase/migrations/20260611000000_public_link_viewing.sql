-- Viewing is open by link: anyone with a share URL can watch.
-- Recording/creation stays restricted to workspace members (signup is
-- domain-gated), but the share link itself is the access credential —
-- the unguessable token in the URL.

alter table public.workspaces alter column default_privacy set default 'public';
alter table public.videos alter column privacy set default 'public';

-- Existing workspaces and videos that were only "workspace"-visible become
-- link-visible. Explicit choices (private / password / specific) are kept.
update public.workspaces set default_privacy = 'public' where default_privacy = 'workspace';
update public.videos set privacy = 'public' where privacy = 'workspace';
