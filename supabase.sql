-- =====================================================================
-- Wallboard — Supabase setup (run once in the SQL editor of your
-- existing Capcus project). Everything is prefixed wb_ so it never
-- touches Capcus tables.
--
-- Access rule: only emails listed in wb_members can read or write
-- wallboard data — other Capcus users can't see any of it.
-- =====================================================================

-- 1. Household members ------------------------------------------------
create table if not exists public.wb_members (
  email        text primary key,
  display_name text not null
);

-- Household logins (existing Capcus logins). Add your wife with:
--   insert into public.wb_members values ('her@email.com','Her name');
insert into public.wb_members (email, display_name) values
  ('you@example.com', 'Dad')
on conflict (email) do update set display_name = excluded.display_name;

create or replace function public.wb_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wb_members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2. Recipes ----------------------------------------------------------
create table if not exists public.wb_recipes (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  category        text,
  cook_time       text,
  serves          text,
  ingredients     text[] not null default '{}',
  steps           text[] not null default '{}',
  notes           text,
  source_url      text,
  photo_path      text,
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 3. Family photos ----------------------------------------------------
create table if not exists public.wb_photos (
  id               uuid primary key default gen_random_uuid(),
  path             text not null,
  uploaded_by      uuid default auth.uid(),
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);

-- 4. Shared state ("cook this tonight") -------------------------------
create table if not exists public.wb_state (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

-- 5. Row-level security: household members only ------------------------
alter table public.wb_members enable row level security;
alter table public.wb_recipes enable row level security;
alter table public.wb_photos  enable row level security;
alter table public.wb_state   enable row level security;

drop policy if exists wb_members_read on public.wb_members;
create policy wb_members_read on public.wb_members
  for select to authenticated using (public.wb_is_member());

drop policy if exists wb_recipes_all on public.wb_recipes;
create policy wb_recipes_all on public.wb_recipes
  for all to authenticated using (public.wb_is_member()) with check (public.wb_is_member());

drop policy if exists wb_photos_all on public.wb_photos;
create policy wb_photos_all on public.wb_photos
  for all to authenticated using (public.wb_is_member()) with check (public.wb_is_member());

drop policy if exists wb_state_all on public.wb_state;
create policy wb_state_all on public.wb_state
  for all to authenticated using (public.wb_is_member()) with check (public.wb_is_member());

-- 6. Private storage bucket for photos ---------------------------------
insert into storage.buckets (id, name, public)
values ('wallboard', 'wallboard', false)
on conflict (id) do nothing;

drop policy if exists wb_storage_all on storage.objects;
create policy wb_storage_all on storage.objects
  for all to authenticated
  using (bucket_id = 'wallboard' and public.wb_is_member())
  with check (bucket_id = 'wallboard' and public.wb_is_member());

-- 7. Live updates (the wall refreshes the moment either of you saves) --
do $$ begin
  begin alter publication supabase_realtime add table public.wb_recipes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wb_photos;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wb_state;   exception when duplicate_object then null; end;
end $$;

-- 8. Starter recipes (safe to delete later) ----------------------------
insert into public.wb_recipes (title, category, cook_time, serves, ingredients, steps, notes, created_by_name)
select * from (values
  ('Nasi Goreng Kampung','Dinner','20 min','3',
   array['3 cups cooked rice, day-old','2 eggs','3 shallots, sliced','2 cloves garlic','1 red chilli (optional)','2 tbsp kecap manis','1 tsp shrimp paste (terasi)','1 tbsp oil','Fried shallots and cucumber to serve'],
   array['Pound shallots, garlic, chilli and terasi into a rough paste.','Fry the paste in oil over medium heat until fragrant, about 2 minutes.','Push to one side, scramble the eggs, then mix together.','Add the rice and break up any clumps. Stir-fry on high heat for 3–4 minutes.','Add kecap manis and a pinch of salt, toss until evenly coloured.','Serve with fried shallots and sliced cucumber.'],
   'For little ones, leave out the chilli and set a portion aside before adding terasi.','Starter'),
  ('Soto Ayam','Soup','1 hr','4',
   array['500 g chicken thighs or legs','1.5 L water','2 stalks lemongrass, bruised','3 kaffir lime leaves','2 cm galangal, sliced','Spice paste: 6 shallots, 4 garlic, 3 candlenuts, 2 cm turmeric, 1 cm ginger','Glass noodles, bean sprouts, boiled eggs','Lime, fried shallots, celery leaves'],
   array['Blend the spice paste ingredients until smooth.','Fry the paste with lemongrass, lime leaves and galangal until fragrant.','Add chicken and water, bring to a boil, then simmer 40 minutes.','Lift out the chicken, shred it, and season the broth with salt.','Put noodles, sprouts, chicken and half an egg in each bowl.','Ladle over hot broth and top with fried shallots, celery and lime.'],
   'Broth freezes well — make a double batch.','Starter'),
  ('Sayur Bening Bayam','Kids','15 min','3',
   array['1 bunch spinach (bayam), picked','1 corn cob, cut into rounds','2 shallots, sliced','1 clove garlic, sliced','1 small piece fingerroot (temu kunci)','800 ml water','Salt and a pinch of sugar'],
   array['Bring water to a boil with shallots, garlic and fingerroot.','Add corn and cook for 6 minutes.','Add spinach and cook for 1–2 minutes only.','Season lightly with salt and sugar. Serve warm.'],
   'Mild and toddler-friendly.','Starter'),
  ('Pisang Goreng','Snack','25 min','4',
   array['6 ripe plantains (pisang kepok or raja)','100 g rice flour','50 g plain flour','1 tbsp sugar','Pinch of salt','150 ml cold water','Oil for frying'],
   array['Whisk the flours, sugar, salt and water into a smooth batter.','Peel the bananas and slice in half lengthways.','Heat oil to about 170°C.','Dip bananas in batter and fry until golden, 3–4 minutes each side.','Drain on paper and serve warm.'],
   null,'Starter')
) as v(title, category, cook_time, serves, ingredients, steps, notes, created_by_name)
where not exists (select 1 from public.wb_recipes);

-- Breakfast and lunch in the meal plan (2026-11-13)
alter table public.wb_meal_plan add column if not exists meal text not null default 'dinner';
alter table public.wb_meal_plan drop constraint if exists wb_meal_plan_meal_check;
alter table public.wb_meal_plan add constraint wb_meal_plan_meal_check check (meal in ('breakfast','lunch','dinner'));
alter table public.wb_meal_plan drop constraint if exists wb_meal_plan_pkey;
alter table public.wb_meal_plan add primary key (day, meal);

-- Lock-down (2026-11-13): confirmed household emails only; no anon access; members can't edit the member list
create or replace function public.wb_is_member()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.wb_members m join auth.users u on lower(u.email) = lower(m.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
      and lower(coalesce(auth.jwt() ->> 'email','')) = lower(m.email)
  );
$$;
revoke all on function public.wb_is_member() from anon, public;
grant execute on function public.wb_is_member() to authenticated;
revoke all on public.wb_members, public.wb_recipes, public.wb_photos, public.wb_state, public.wb_meal_plan,
  public.wb_shopping, public.wb_pantry, public.wb_calendars, public.wb_reviews from anon;
revoke insert, update, delete on public.wb_members from authenticated;

-- Hardening (2026-11-13): daily cap on Claude calls per person, and a size limit on stored settings
create table if not exists public.wb_ai_usage (
  day   date not null,
  email text not null,
  n     int  not null default 0,
  primary key (day, email)
);
alter table public.wb_ai_usage enable row level security;   -- no policies: only the function below touches it
revoke all on public.wb_ai_usage from anon, authenticated;
create or replace function public.wb_ai_tick()
returns boolean language plpgsql security definer set search_path to 'public'
as $$
declare
  e text := lower(coalesce(auth.jwt() ->> 'email', ''));
  d date := (now() at time zone 'Asia/Jakarta')::date;
  used int;
begin
  if public.wb_role() is null then return false; end if;
  insert into public.wb_ai_usage (day, email, n) values (d, e, 1)
    on conflict (day, email) do update set n = public.wb_ai_usage.n + 1
    returning n into used;
  delete from public.wb_ai_usage where day < d - 60;
  return used <= 200;
end $$;
revoke all on function public.wb_ai_tick() from anon, public;
grant execute on function public.wb_ai_tick() to authenticated;
alter table public.wb_state drop constraint if exists wb_state_value_size;
alter table public.wb_state add constraint wb_state_value_size check (pg_column_size(value) < 1500000) not valid;
