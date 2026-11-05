-- Prepared fallback drafts must not be presented as AI-generated or written by a person.
ALTER TYPE public.grm_reply_source ADD VALUE IF NOT EXISTS 'template';
