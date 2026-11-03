-- Setup starts with the business's website: the address and the brand profile
-- written from it are kept with the setup progress until a business exists to
-- hold them.
ALTER TABLE public.grm_onboarding
 ADD COLUMN website text,
 ADD COLUMN brand_profile jsonb,
 ADD COLUMN brand_profile_source text;
ALTER TABLE public.grm_onboarding
 ADD CONSTRAINT grm_onboarding_brand_profile_source_check CHECK (brand_profile_source IS NULL OR brand_profile_source IN ('website','manual'));
ALTER TABLE public.grm_onboarding DROP CONSTRAINT grm_onboarding_step_check;
ALTER TABLE public.grm_onboarding
 ADD CONSTRAINT grm_onboarding_step_check CHECK (step = ANY (ARRAY['brand','connect','import','groups','tone','invite','done']));
ALTER TABLE public.grm_onboarding ALTER COLUMN step SET DEFAULT 'brand';
