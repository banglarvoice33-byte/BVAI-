-- Presentation experiments only. Draft by default; no public telemetry write access.
BEGIN;
CREATE TABLE IF NOT EXISTS public.video_experiments(
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9_-]{1,80}$'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','stopped')),
 variants jsonb NOT NULL CHECK(jsonb_typeof(variants)='array' AND jsonb_array_length(variants) BETWEEN 2 AND 8),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES auth.users(id)
);
CREATE TABLE IF NOT EXISTS public.video_experiment_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES public.video_experiments(id),
 video_id uuid NOT NULL REFERENCES public.videos(id),
 subject_hash text NOT NULL CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
 variant text NOT NULL CHECK(variant ~ '^[a-z0-9_-]{1,40}$'),
 event text NOT NULL CHECK(event IN ('exposure','click','complete')),
 event_key text UNIQUE NOT NULL CHECK(event_key ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(experiment_id,video_id,subject_hash,event)
);
CREATE INDEX IF NOT EXISTS video_experiment_events_aggregate_idx ON public.video_experiment_events(experiment_id,variant,event);
CREATE OR REPLACE FUNCTION public.validate_video_experiment()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v jsonb; total integer:=0; ids text[]:=ARRAY[]::text[];
BEGIN
 FOR v IN SELECT value FROM jsonb_array_elements(NEW.variants) LOOP
  IF COALESCE(v->>'id','') !~ '^[a-z0-9_-]{1,40}$' OR COALESCE(v->>'weight','') !~ '^[0-9]{1,5}$'
    OR (v->>'weight')::integer<1 OR (v->>'weight')::integer>10000 OR v->>'id'=ANY(ids) THEN RAISE EXCEPTION 'experiment_definition_invalid'; END IF;
  ids:=array_append(ids,v->>'id');total:=total+(v->>'weight')::integer;
 END LOOP;
 IF total<>10000 THEN RAISE EXCEPTION 'experiment_weights_must_total_10000'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.variants IS DISTINCT FROM OLD.variants)
   AND EXISTS(SELECT 1 FROM public.video_experiment_events WHERE experiment_id=OLD.id) THEN RAISE EXCEPTION 'exposed_experiment_definition_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_video_experiment ON public.video_experiments;
CREATE TRIGGER validate_video_experiment BEFORE INSERT OR UPDATE ON public.video_experiments FOR EACH ROW EXECUTE FUNCTION public.validate_video_experiment();
ALTER TABLE public.video_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_experiment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_experiments,public.video_experiment_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.video_experiments,public.video_experiment_events TO authenticated,service_role;
GRANT INSERT,UPDATE ON public.video_experiments TO service_role;
DROP POLICY IF EXISTS editor_read_video_experiments ON public.video_experiments;
CREATE POLICY editor_read_video_experiments ON public.video_experiments FOR SELECT TO authenticated USING(public.current_app_role()::text IN ('desk_editor','chief_editor','admin'));
DROP POLICY IF EXISTS editor_read_experiment_events ON public.video_experiment_events;
CREATE POLICY editor_read_experiment_events ON public.video_experiment_events FOR SELECT TO authenticated USING(public.current_app_role()::text IN ('desk_editor','chief_editor','admin'));
CREATE OR REPLACE FUNCTION public.record_video_experiment_event(p_experiment_id text,p_subject_hash text,p_video_id uuid,p_variant text,p_event text,p_event_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition public.video_experiments%ROWTYPE;
BEGIN
 SELECT * INTO definition FROM public.video_experiments WHERE id=p_experiment_id FOR SHARE;
 IF NOT FOUND OR definition.status<>'running' THEN RAISE EXCEPTION 'experiment_not_running'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition.variants) v WHERE v->>'id'=p_variant)
 OR NOT EXISTS(SELECT 1 FROM public.videos WHERE id=p_video_id AND status='published') THEN RAISE EXCEPTION 'experiment_variant_or_video_invalid'; END IF;
 -- Serialize subject/video events so click-before-exposure cannot race another writer.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_experiment_id||':'||p_subject_hash||':'||p_video_id::text,0));
 IF p_event IN ('click','complete') AND NOT EXISTS(SELECT 1 FROM public.video_experiment_events WHERE experiment_id=p_experiment_id AND subject_hash=p_subject_hash AND video_id=p_video_id AND variant=p_variant AND event='exposure') THEN RAISE EXCEPTION 'experiment_exposure_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.video_experiment_events WHERE experiment_id=p_experiment_id AND subject_hash=p_subject_hash AND video_id=p_video_id AND variant<>p_variant) THEN RAISE EXCEPTION 'experiment_assignment_changed'; END IF;
 INSERT INTO public.video_experiment_events(experiment_id,subject_hash,video_id,variant,event,event_key)
 VALUES(p_experiment_id,p_subject_hash,p_video_id,p_variant,p_event,p_event_key) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.record_video_experiment_event(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_experiment_event(text,text,uuid,text,text,text) TO service_role;
-- Retention: operators can run this explicitly; it does not silently schedule a job.
CREATE OR REPLACE FUNCTION public.purge_video_experiment_events()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n bigint; BEGIN DELETE FROM public.video_experiment_events WHERE created_at<now()-interval '90 days'; GET DIAGNOSTICS n=ROW_COUNT; RETURN n; END $$;
REVOKE ALL ON FUNCTION public.purge_video_experiment_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_video_experiment_events() TO service_role;
COMMIT;
