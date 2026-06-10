-- Storage buckets. Names must stay in sync with apps/web/src/lib/storage.ts.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('raw-recordings',   'raw-recordings',   false, 10737418240), -- 10 GB
  ('processed-videos', 'processed-videos', false, 10737418240),
  ('thumbnails',       'thumbnails',       true,  20971520),
  ('captions',         'captions',         true,  20971520),
  ('avatars',          'avatars',          true,  10485760),
  ('workspace-assets', 'workspace-assets', true,  20971520),
  ('exports',          'exports',          false, 1073741824)
on conflict (id) do nothing;

-- Helper: is the current auth user an active member of the workspace that owns
-- an object path shaped like  workspaces/{workspaceId}/...  ?
create or replace function public.is_workspace_member_of_path(object_name text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.workspace_id::text = (storage.foldername(object_name))[2]
  );
$$;

-- raw-recordings: workspace members upload recordings directly (TUS).
-- TUS upserts need insert + update + select.
drop policy if exists "raw upload insert" on storage.objects;
create policy "raw upload insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'raw-recordings'
    and (storage.foldername(name))[1] = 'workspaces'
    and public.is_workspace_member_of_path(name)
  );

drop policy if exists "raw upload update" on storage.objects;
create policy "raw upload update" on storage.objects
  for update to authenticated
  using (bucket_id = 'raw-recordings' and public.is_workspace_member_of_path(name))
  with check (bucket_id = 'raw-recordings' and public.is_workspace_member_of_path(name));

drop policy if exists "raw upload select" on storage.objects;
create policy "raw upload select" on storage.objects
  for select to authenticated
  using (bucket_id = 'raw-recordings' and public.is_workspace_member_of_path(name));

-- thumbnails: members may upload custom thumbnails under their workspace prefix.
drop policy if exists "thumbnails member write" on storage.objects;
create policy "thumbnails member write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = 'workspaces'
    and public.is_workspace_member_of_path(name)
  );

drop policy if exists "thumbnails member update" on storage.objects;
create policy "thumbnails member update" on storage.objects
  for update to authenticated
  using (bucket_id = 'thumbnails' and public.is_workspace_member_of_path(name))
  with check (bucket_id = 'thumbnails' and public.is_workspace_member_of_path(name));

-- avatars: users manage their own avatar under users/{uid}/...
drop policy if exists "avatars own write" on storage.objects;
create policy "avatars own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- workspace-assets: members upload branding (server enforces admin-only UI).
drop policy if exists "workspace assets member write" on storage.objects;
create policy "workspace assets member write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'workspace-assets'
    and (storage.foldername(name))[1] = 'workspaces'
    and public.is_workspace_member_of_path(name)
  );

drop policy if exists "workspace assets member update" on storage.objects;
create policy "workspace assets member update" on storage.objects
  for update to authenticated
  using (bucket_id = 'workspace-assets' and public.is_workspace_member_of_path(name))
  with check (bucket_id = 'workspace-assets' and public.is_workspace_member_of_path(name));

-- processed-videos, captions (writes), exports: service-role only (no policies).
