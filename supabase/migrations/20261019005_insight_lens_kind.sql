-- Allow insight_lens knowledge rows (structured lens in metadata jsonb).

alter table public.grm_ai_knowledge
  drop constraint if exists grm_ai_knowledge_kind_check;

alter table public.grm_ai_knowledge
  add constraint grm_ai_knowledge_kind_check
  check (kind in ('instruction', 'faq', 'response_rule', 'approved_example', 'insight_lens'));

comment on table public.grm_ai_knowledge is
  'Structured tenant knowledge: instructions, FAQs, response rules, approved examples, and insight lenses.';
