-- =============================================================
-- NutLux — Supabase Database Schema + Row Level Security
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================

-- 1. CUSTOMERS TABLE
-- Stores one row per authenticated user. id matches auth.users.id.
create table if not exists public.customers (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null check (char_length(name) between 2 and 100),
  phone       text check (phone is null or phone ~ '^[0-9+\-\s\(\)]{7,15}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_email_idx on public.customers (lower(email));

-- 2. ORDERS TABLE
-- Stores orders linked to customers. items is jsonb so cart snapshots
-- are preserved even if a product's price/name changes later.
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  items        jsonb not null check (jsonb_typeof(items) = 'array'),
  subtotal     numeric(10,2) not null check (subtotal >= 0),
  total        numeric(10,2) not null check (total >= 0),
  status       text not null default 'processing'
                 check (status in ('processing','shipped','delivered','cancelled')),
  progress     int  not null default 33
                 check (progress between 0 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists orders_customer_idx
  on public.orders (customer_id, created_at desc);

-- 3. NEWSLETTER SUBSCRIBERS TABLE (optional)
create table if not exists public.newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_at  timestamptz not null default now()
);

-- =============================================================
-- ROW LEVEL SECURITY (RLS)
-- This is the security backbone. Without these policies the anon
-- key would be able to read/write every row in the database.
-- =============================================================

alter table public.customers           enable row level security;
alter table public.orders              enable row level security;
alter table public.newsletter_subscribers enable row level security;

-- CUSTOMERS policies: a user can only see/edit their OWN row.
drop policy if exists "customers_select_own" on public.customers;
create policy "customers_select_own"
  on public.customers for select
  using (auth.uid() = id);

drop policy if exists "customers_insert_own" on public.customers;
create policy "customers_insert_own"
  on public.customers for insert
  with check (auth.uid() = id);

drop policy if exists "customers_update_own" on public.customers;
create policy "customers_update_own"
  on public.customers for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ORDERS policies: a user can only see/insert their OWN orders.
-- No update/delete from client (use a backend or admin SQL for status changes).
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders for select
  using (auth.uid() = customer_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own"
  on public.orders for insert
  with check (
    auth.uid() = customer_id
    and jsonb_array_length(items) > 0
    and total >= 0
  );

-- NEWSLETTER: anyone (even unauthenticated) can subscribe, but
-- no one can read the list (prevents email harvesting).
drop policy if exists "newsletter_insert_anyone" on public.newsletter_subscribers;
create policy "newsletter_insert_anyone"
  on public.newsletter_subscribers for insert
  with check (true);

-- =============================================================
-- TRIGGERS: keep updated_at fresh automatically
-- =============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated
  before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- =============================================================
-- 4. PRODUCTS TABLE (server-side source of truth for prices)
-- The client cannot be trusted with prices. The trigger below
-- always recalculates order totals from this table.
-- =============================================================
create table if not exists public.products (
  id          int primary key,
  name        text not null,
  price       numeric(10,2) not null check (price >= 0),
  is_active   boolean not null default true
);

insert into public.products (id, name, price) values
  (1, 'Plain Whole Cashews', 900)
on conflict (id) do update set price = excluded.price, name = excluded.name;

-- Remove legacy products if they exist (safe re-run)
delete from public.products where id not in (1);

-- Products table: anyone (including anonymous) can SELECT to see prices,
-- but no one can INSERT/UPDATE/DELETE — only admins via service_role.
alter table public.products enable row level security;

drop policy if exists "products_select_anyone" on public.products;
create policy "products_select_anyone"
  on public.products for select
  using (is_active = true);

-- =============================================================
-- 5. PRICE VALIDATION TRIGGER
-- Recalculates subtotal/total on every order insert, ignoring any
-- values the client sent. Rejects malformed items.
-- =============================================================
create or replace function public.recalc_order_totals()
returns trigger language plpgsql as $$
declare
  computed_total numeric(10,2) := 0;
  item           jsonb;
  pid            int;
  qty            int;
  server_price   numeric(10,2);
  item_count     int := 0;
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  for item in select * from jsonb_array_elements(new.items)
  loop
    pid := (item->>'id')::int;
    qty := (item->>'qty')::int;

    if pid is null then
      raise exception 'Each item must have an id';
    end if;
    if qty is null or qty <= 0 or qty > 99 then
      raise exception 'Quantity for product % must be between 1 and 99', pid;
    end if;

    select price into server_price
    from public.products
    where id = pid and is_active = true;

    if server_price is null then
      raise exception 'Unknown or inactive product id %', pid;
    end if;

    computed_total := computed_total + (server_price * qty);
    item_count := item_count + 1;
  end loop;

  if item_count = 0 then
    raise exception 'Order must contain at least one item';
  end if;

  -- OVERWRITE whatever the client claimed. DB is the only authority.
  new.subtotal := computed_total;
  new.total    := computed_total;

  return new;
end;
$$;

drop trigger if exists trg_recalc_totals on public.orders;
-- 'aaa_' prefix forces this trigger to run FIRST (alphabetical order).
-- The strict check must see the CLIENT's original total before recalc overwrites it.
create trigger aaa_recalc_totals
  before insert on public.orders
  for each row execute function public.recalc_order_totals();

-- =============================================================
-- 6. STRICT PRICE VALIDATION (recommended for production)
-- Runs AFTER recalc, so it reads the SERVER's authoritative total.
-- Recomputes independently from public.products and rejects the
-- order if the server-computed value disagrees with itself.
-- This is a belt-and-suspenders check: if recalc ever has a bug,
-- the second trigger catches it.
-- =============================================================
create or replace function public.strict_price_check()
returns trigger language plpgsql as $$
declare
  server_total   numeric(10,2);
  computed       numeric(10,2) := 0;
  item           jsonb;
  pid            int;
  qty            int;
  prod_price     numeric(10,2);
begin
  server_total := new.total;

  for item in select * from jsonb_array_elements(new.items)
  loop
    pid := (item->>'id')::int;
    qty := (item->>'qty')::int;

    select price into prod_price
    from public.products
    where id = pid and is_active = true;

    if prod_price is null then
      raise exception 'Unknown or inactive product id %', pid;
    end if;

    computed := computed + (prod_price * qty);
  end loop;

  if abs(server_total - computed) > 0.01 then
    raise exception 'Internal price mismatch: stored % vs recomputed %', server_total, computed;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_strict_price_check on public.orders;
-- 'zzz_' prefix forces this trigger to run LAST.
create trigger zzz_strict_price_check
  before insert on public.orders
  for each row execute function public.strict_price_check();