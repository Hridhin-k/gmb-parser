-- Brand profile: what a business does, written by the LLM from its website and
-- edited by the user. Review analysis reads it so themes fit the business.
ALTER TABLE public.grm_clients
 ADD COLUMN brand_profile jsonb,
 ADD COLUMN brand_profile_source text,
 ADD COLUMN brand_profile_updated_at timestamp with time zone;
ALTER TABLE public.grm_clients
 ADD CONSTRAINT grm_clients_brand_profile_source_check CHECK (brand_profile_source IS NULL OR brand_profile_source IN ('website','manual'));
