-- Keep public.profiles in sync with auth.users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute procedure public.handle_user_email_updated();

-- Deleting an auth user cascades to all owned rows.
alter table public.profiles
  drop constraint if exists profiles_id_fkey,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;

-- Notify the worker when a job is enqueued (it also polls as a fallback).
create or replace function public.notify_job_inserted()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify('ryloom_jobs', new.id::text);
  return new;
end;
$$;

drop trigger if exists on_processing_job_inserted on public.processing_jobs;
create trigger on_processing_job_inserted
  after insert on public.processing_jobs
  for each row execute procedure public.notify_job_inserted();
