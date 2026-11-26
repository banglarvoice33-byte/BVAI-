-- Split from 20260929000001_platform_contract.sql.
-- PG12+ forbids USING an enum value in the same transaction it was added
-- (SQLSTATE 55P04). All ADD VALUE statements live here so they commit
-- before 20260929000001 runs and uses them.
alter type public.app_role add value if not exists 'reader';
alter type public.app_role add value if not exists 'reporter';
alter type public.app_role add value if not exists 'editor';
