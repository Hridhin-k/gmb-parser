-- The reply object Google returns. Null until a publish is confirmed.

alter table public.grm_review_replies
  add column if not exists publish_result jsonb;

comment on column public.grm_review_replies.publish_result is
  'The reply object returned by Google Business Profile. Null until Google confirms a publish.';
