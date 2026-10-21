-- Review extraction payload and taxonomy-v2.
-- Additive. taxonomy-v1 rows stay. Reverse drops the new indexes, columns, and taxonomy-v2 rows.

alter table public.grm_review_intelligence
  add column if not exists extraction jsonb not null default '{}'::jsonb;

alter table public.grm_review_intelligence
  drop constraint if exists grm_review_intelligence_extraction_object;

alter table public.grm_review_intelligence
  add constraint grm_review_intelligence_extraction_object
  check (jsonb_typeof(extraction) = 'object');

comment on column public.grm_review_intelligence.extraction is
  'Validated extract-v1 document. Facts are quotations from grm_reviews.comment. Interpretation is stored separately and is not evidence.';

alter table public.grm_review_topic_assignments
  add column if not exists assignment_rank text not null default 'secondary'
    check (assignment_rank in ('primary', 'secondary')),
  add column if not exists confidence numeric(4,3) not null default 1
    check (confidence >= 0 and confidence <= 1),
  add column if not exists uncertain boolean not null default false,
  add column if not exists basis text not null default 'quotation'
    check (basis in ('quotation', 'rating'));

alter table public.grm_review_topic_assignments
  drop constraint if exists grm_review_topic_assignments_intelligence_id_topic_id_key;

create unique index if not exists grm_review_topic_assignments_aspect
  on public.grm_review_topic_assignments (intelligence_id, topic_id, polarity);

-- taxonomy-v2. Parents first, then leaves, then aliases and issue rows.
insert into public.grm_topics (workspace_id, code, label, kind, taxonomy_version, description)
select null, code, label, 'topic', 'taxonomy-v2', description
from (
  values
    ('staff_service', 'Staff and service', 'How people in the store treated the customer.'),
    ('product_collection', 'Product and collection', 'What was for sale and its condition.'),
    ('store_environment', 'Store environment', 'The physical shop.'),
    ('waiting_operations', 'Waiting and operations', 'Time spent waiting for service.'),
    ('price', 'Price', 'Whether the price felt fair.'),
    ('exchange', 'Exchange policy', 'Returns, exchanges, or refunds.'),
    ('parking', 'Parking', 'Parking at the location.'),
    ('other', 'Other', 'A supported point that matches none of the other codes.')
) as seed(code, label, description)
where not exists (
  select 1 from public.grm_topics t
  where t.workspace_id is null and t.taxonomy_version = 'taxonomy-v2' and t.kind = 'topic' and t.code = seed.code
);

insert into public.grm_topics (workspace_id, parent_id, code, label, kind, taxonomy_version, description)
select null, parent.id, seed.code, seed.label, 'topic', 'taxonomy-v2', seed.description
from (
  values
    ('staff_service', 'staff_politeness', 'Staff politeness', 'Courtesy, rudeness, or tone of staff.'),
    ('staff_service', 'staff_knowledge', 'Staff knowledge', 'Whether staff could explain the product or the policy.'),
    ('staff_service', 'staff_availability', 'Staff availability', 'Whether anyone was available to help.'),
    ('product_collection', 'product_variety', 'Product variety', 'Range or selection.'),
    ('product_collection', 'product_quality', 'Product quality', 'Defects, damage, or quality of the goods.'),
    ('product_collection', 'product_availability', 'Product availability', 'Whether the item was in stock.'),
    ('store_environment', 'cleanliness', 'Cleanliness', 'Hygiene and cleanliness.'),
    ('store_environment', 'fitting_room', 'Fitting-room experience', 'Trial room or changing room.'),
    ('store_environment', 'layout_access', 'Layout and accessibility', 'Layout, crowding, or step-free access.'),
    ('waiting_operations', 'queue_time', 'Queue time', 'Waiting in a line.'),
    ('waiting_operations', 'billing_delay', 'Billing delays', 'Checkout or billing queue.'),
    ('waiting_operations', 'service_delay', 'Service delays', 'A slow service that is not a queue or a bill.')
) as seed(parent_code, code, label, description)
join public.grm_topics parent
  on parent.workspace_id is null
 and parent.taxonomy_version = 'taxonomy-v2'
 and parent.kind = 'topic'
 and parent.code = seed.parent_code
where not exists (
  select 1 from public.grm_topics t
  where t.workspace_id is null and t.taxonomy_version = 'taxonomy-v2' and t.kind = 'topic' and t.code = seed.code
);

insert into public.grm_topics (workspace_id, parent_id, code, label, kind, taxonomy_version, description)
select null, topic.parent_id, topic.code, topic.label, 'issue', 'taxonomy-v2', topic.description
from public.grm_topics topic
where topic.workspace_id is null
  and topic.taxonomy_version = 'taxonomy-v2'
  and topic.kind = 'topic'
  and topic.code in (
    'staff_politeness', 'staff_knowledge', 'staff_availability',
    'product_variety', 'product_quality', 'product_availability',
    'cleanliness', 'fitting_room', 'layout_access',
    'queue_time', 'billing_delay', 'service_delay',
    'price', 'exchange', 'parking'
  )
  and not exists (
    select 1 from public.grm_topics issue
    where issue.workspace_id is null
      and issue.taxonomy_version = 'taxonomy-v2'
      and issue.kind = 'issue'
      and issue.code = topic.code
  );

insert into public.grm_topic_aliases (topic_id, workspace_id, alias)
select t.id, null, seed.alias
from (
  values
    ('staff_politeness', 'polite'),
    ('staff_politeness', 'rude'),
    ('staff_politeness', 'staff behaviour'),
    ('staff_politeness', 'staff behavior'),
    ('staff_knowledge', 'knowledgeable'),
    ('staff_availability', 'short staffed'),
    ('product_variety', 'selection'),
    ('product_quality', 'quality'),
    ('product_quality', 'defect'),
    ('product_availability', 'out of stock'),
    ('cleanliness', 'hygiene'),
    ('cleanliness', 'dirty'),
    ('fitting_room', 'trial room'),
    ('fitting_room', 'changing room'),
    ('layout_access', 'crowded'),
    ('queue_time', 'wait'),
    ('queue_time', 'queue'),
    ('billing_delay', 'billing queue'),
    ('billing_delay', 'checkout'),
    ('service_delay', 'slow service'),
    ('price', 'expensive'),
    ('exchange', 'exchange policy'),
    ('exchange', 'refund'),
    ('parking', 'car park')
) as seed(code, alias)
join public.grm_topics t
  on t.workspace_id is null
 and t.taxonomy_version = 'taxonomy-v2'
 and t.kind = 'topic'
 and t.code = seed.code
where not exists (
  select 1 from public.grm_topic_aliases a
  where a.topic_id = t.id and lower(a.alias) = lower(seed.alias)
);
