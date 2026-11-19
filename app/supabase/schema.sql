-- NBA Live — Supabase schema (Phase 1 + 2)
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to re-run.
-- Game, play and player ids come from the data provider (text), so they are not FKs here.

create extension if not exists pgcrypto;

-- ============ PROFILES ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  avatar_color text not null default '#ff6a2b' check (avatar_color ~* '^#[0-9a-f]{6}$'),
  favourite_team text,
  role text not null default 'member' check (role in ('member','moderator','admin')),
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(nullif(regexp_replace(new.raw_user_meta_data->>'username', '[^A-Za-z0-9_]', '', 'g'), ''), 'fan');
  uname text := left(base, 20);
  i int := 0;
begin
  if length(uname) < 3 then uname := uname || 'fan'; end if;
  while exists (select 1 from public.profiles where lower(username) = lower(uname)) loop
    i := i + 1;
    uname := left(base, 15) || i::text;
  end loop;
  insert into public.profiles (id, username, display_name)
  values (new.id, uname, uname);
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- ============ FOLLOWS ============
create table if not exists public.follows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('team','player')),
  ref_id text not null,
  ref_name text,
  team_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

-- ============ NOTIFICATIONS ============
create table if not exists public.notification_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  game_start boolean not null default true,
  game_final boolean not null default true,
  close_game boolean not null default true,
  milestones boolean not null default true,
  replies boolean not null default true,
  browser_push boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_time on public.notifications (user_id, created_at desc);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ DISCUSSIONS ============
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  game_id text not null,
  play_id text,                         -- null = whole-game discussion
  parent_id bigint references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (length(body) <= 1000),
  like_count int not null default 0,
  reply_count int not null default 0,
  deleted boolean not null default false,
  hidden boolean not null default false, -- moderation
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_game_play on public.comments (game_id, play_id, created_at);
create index if not exists comments_recent on public.comments (created_at desc);
create index if not exists comments_parent on public.comments (parent_id);

create table if not exists public.comment_likes (
  comment_id bigint not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.play_reactions (
  game_id text not null,
  play_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('🔥','👏','😮','😂','😤','💀')),
  created_at timestamptz not null default now(),
  primary key (play_id, user_id, emoji)
);
create index if not exists play_reactions_game on public.play_reactions (game_id);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  game_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 300),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_game_time on public.chat_messages (game_id, created_at desc);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  comment_id bigint references public.comments(id) on delete cascade,
  chat_id bigint references public.chat_messages(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  check (comment_id is not null or chat_id is not null)
);

-- ============ TRIGGERS: counters, rate limits, reply notifications ============
create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if tg_table_name = 'chat_messages' then
    select count(*) into n from public.chat_messages where user_id = new.user_id and created_at > now() - interval '10 seconds';
    if n >= 4 then raise exception 'rate limit: slow down'; end if;
  else
    select count(*) into n from public.comments where user_id = new.user_id and created_at > now() - interval '30 seconds';
    if n >= 5 then raise exception 'rate limit: slow down'; end if;
  end if;
  return new;
end $$;
drop trigger if exists chat_rate on public.chat_messages;
create trigger chat_rate before insert on public.chat_messages for each row execute function public.rate_limit();
drop trigger if exists comment_rate on public.comments;
create trigger comment_rate before insert on public.comments for each row execute function public.rate_limit();

create or replace function public.comment_counters() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent_author uuid; prefs_on boolean;
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    update public.comments set reply_count = reply_count + 1 where id = new.parent_id returning user_id into parent_author;
    if parent_author is not null and parent_author <> new.user_id then
      select coalesce(replies, true) into prefs_on from public.notification_prefs where user_id = parent_author;
      if coalesce(prefs_on, true) then
        insert into public.notifications (user_id, kind, title, body, link)
        select parent_author, 'reply', p.username || ' replied to you', left(new.body, 140),
               '#/game/' || new.game_id || case when new.play_id is null then '/discussion' else '/plays?play=' || new.play_id end
        from public.profiles p where p.id = new.user_id;
      end if;
    end if;
  elsif tg_op = 'DELETE' and old.parent_id is not null then
    update public.comments set reply_count = greatest(reply_count - 1, 0) where id = old.parent_id;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists comments_count on public.comments;
create trigger comments_count after insert or delete on public.comments for each row execute function public.comment_counters();

create or replace function public.like_counters() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.comments set like_count = like_count + 1 where id = new.comment_id;
  else update public.comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists likes_count on public.comment_likes;
create trigger likes_count after insert or delete on public.comment_likes for each row execute function public.like_counters();

-- Users may only edit their own comment's body / deleted flag, never counters or moderation fields.
create or replace function public.guard_comment_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = auth.uid() and role in ('moderator','admin')) then return new; end if;
  new.like_count := old.like_count; new.reply_count := old.reply_count; new.hidden := old.hidden;
  new.game_id := old.game_id; new.play_id := old.play_id; new.parent_id := old.parent_id; new.user_id := old.user_id;
  new.created_at := old.created_at; new.edited_at := now();
  return new;
end $$;
drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before update on public.comments for each row execute function public.guard_comment_update();

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    new.role := old.role; new.id := old.id; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_update();

-- ============ ROW LEVEL SECURITY ============
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.play_reactions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.reports enable row level security;

create or replace function public.is_mod() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('moderator','admin'));
$$;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "follows own" on public.follows;
create policy "follows own" on public.follows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "prefs own" on public.notification_prefs;
create policy "prefs own" on public.notification_prefs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments for select using (hidden = false or public.is_mod() or auth.uid() = user_id);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert with check (auth.uid() = user_id and length(body) > 0 and deleted = false and hidden = false and like_count = 0 and reply_count = 0);
drop policy if exists "comments update own" on public.comments;
create policy "comments update own" on public.comments for update using (auth.uid() = user_id or public.is_mod());

drop policy if exists "likes readable" on public.comment_likes;
create policy "likes readable" on public.comment_likes for select using (true);
drop policy if exists "likes own insert" on public.comment_likes;
create policy "likes own insert" on public.comment_likes for insert with check (auth.uid() = user_id);
drop policy if exists "likes own delete" on public.comment_likes;
create policy "likes own delete" on public.comment_likes for delete using (auth.uid() = user_id);

drop policy if exists "reactions readable" on public.play_reactions;
create policy "reactions readable" on public.play_reactions for select using (true);
drop policy if exists "reactions own insert" on public.play_reactions;
create policy "reactions own insert" on public.play_reactions for insert with check (auth.uid() = user_id);
drop policy if exists "reactions own delete" on public.play_reactions;
create policy "reactions own delete" on public.play_reactions for delete using (auth.uid() = user_id);

drop policy if exists "chat readable" on public.chat_messages;
create policy "chat readable" on public.chat_messages for select using (hidden = false or public.is_mod());
drop policy if exists "chat insert own" on public.chat_messages;
create policy "chat insert own" on public.chat_messages for insert with check (auth.uid() = user_id and hidden = false);
drop policy if exists "chat mod update" on public.chat_messages;
create policy "chat mod update" on public.chat_messages for update using (public.is_mod());

drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports for insert with check (auth.uid() = user_id);
drop policy if exists "reports mod read" on public.reports;
create policy "reports mod read" on public.reports for select using (public.is_mod());


-- ============ API GRANTS (RLS above still decides which rows) ============
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.comments, public.comment_likes, public.play_reactions, public.chat_messages to anon, authenticated;
grant update (display_name, avatar_color, favourite_team) on public.profiles to authenticated;
grant select, insert, update, delete on public.follows, public.notification_prefs to authenticated;
grant select, update (read_at) on public.notifications to authenticated;
grant insert on public.comments, public.chat_messages, public.reports to authenticated;
grant update (body, deleted) on public.comments to authenticated;
grant update (hidden) on public.comments, public.chat_messages to authenticated;
grant insert, delete on public.comment_likes, public.play_reactions to authenticated;
grant execute on function public.is_mod() to anon, authenticated;

-- ============ REALTIME ============
do $$
declare t text;
begin
  foreach t in array array['chat_messages','comments','play_reactions','notifications'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
