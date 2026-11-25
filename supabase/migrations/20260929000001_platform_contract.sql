-- Split fix: enum ADD VALUEs must be in their own transaction.
-- No use of new enum values in this file.
do $$ begin
  alter type public.app_role add value if not exists 'reader';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.app_role add value if not exists 'reporter';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.app_role add value if not exists 'editor';
exception when duplicate_object then null; end $$;
