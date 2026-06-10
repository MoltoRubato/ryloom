-- Ryloom runs as an internal tool: every workspace gets full access.
-- The plan column is kept for schema compatibility but always reads as
-- full-access in the application layer.

alter table public.workspaces alter column plan set default 'enterprise';
update public.workspaces set plan = 'enterprise';
