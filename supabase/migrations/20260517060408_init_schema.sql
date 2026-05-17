-- Create profiles table
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  is_admin boolean default false,
  plan text default 'free',
  plan_status text default 'inactive',
  plan_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create subscription_requests table
create table if not exists public.subscription_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  plan text not null,
  amount_php numeric,
  gcash_number text,
  gcash_name text,
  reference_note text,
  status text default 'pending',
  created_at timestamptz default now(),
  reviewed_at timestamptz
);

-- Create chat_history table
create table if not exists public.chat_history (
  id bigint generated always as identity primary key,
  session_id text not null,
  user_id uuid references auth.users on delete set null,
  role text not null,
  text text,
  image jsonb,
  thinking_level text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.subscription_requests enable row level security;
alter table public.chat_history enable row level security;

-- Create indexes
create index if not exists idx_chat_history_session_id on public.chat_history(session_id);
create index if not exists idx_chat_history_user_id on public.chat_history(user_id);
create index if not exists idx_subscription_requests_user_id on public.subscription_requests(user_id);
create index if not exists idx_subscription_requests_status on public.subscription_requests(status);

-- Auto-update updated_at for profiles
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- RLS Policies
-- Profiles: users can read/update own profile, admins can read all
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

create policy "Admins can update all profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- Subscription requests: users can view own, admins can view all
create policy "Users can view own requests"
  on public.subscription_requests for select
  using (auth.uid() = user_id);

create policy "Users can create own requests"
  on public.subscription_requests for insert
  with check (auth.uid() = user_id);

create policy "Admins can view all requests"
  on public.subscription_requests for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

create policy "Admins can update requests"
  on public.subscription_requests for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- Chat history: users can view own, insert own
create policy "Users can view own chat history"
  on public.chat_history for select
  using (auth.uid() = user_id);

create policy "Users can insert chat history"
  on public.chat_history for insert
  with check (auth.uid() = user_id or user_id is null);
