ALTER TABLE public.grm_reviews
  ADD COLUMN IF NOT EXISTS review_media_items jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(review_media_items) = 'array');
COMMENT ON COLUMN public.grm_reviews.review_media_items IS
  'Photos/videos returned by Google Review.reviewMediaItems; never inferred from location media.';
