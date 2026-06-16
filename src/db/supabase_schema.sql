begin;

-- Registered player and engine profiles.
create table if not exists app_users (
  id text primary key,  -- stable user id
  username text not null unique,  -- display name
  password_hash text not null,  -- hashed password
  password_salt text not null,  -- per-user salt
  photo_url text,  -- optional avatar url
  created_at timestamptz not null default now()  -- account created at
);

-- Auth sessions for logged-in users.
create table if not exists app_sessions (
  id text primary key,  -- session id
  user_id text not null references app_users(id) on delete cascade,  -- owner
  token_hash text not null unique,  -- hashed bearer token
  expires_at timestamptz not null,  -- session expiry
  created_at timestamptz not null default now()  -- session created at
);

-- Whole-game facts live here as columns/FKs (no meta_json, no clock columns, no winner color/name text).
create table if not exists app_games (
  id text primary key,  -- game id
  user_id text not null references app_users(id) on delete cascade,  -- game owner/creator
  player_a_id text references app_users(id) on delete set null,  -- slot a (chezz white / pool player1)
  player_b_id text references app_users(id) on delete set null,  -- slot b (chezz black / pool player2)
  game_type text not null check (game_type in ('pool', 'chezz')),  -- pool or chezz
  mode text not null,  -- enforced per game_type below
  status text not null,  -- ready | active | finished
  winner_id text references app_users(id) on delete set null,  -- winning profile; null = draw/ongoing
  reason text,  -- terminal reason (draw = winner_id null + finished)
  side_a text,  -- slot a role: chezz white | pool solids
  side_b text,  -- slot b role: chezz black | pool stripes
  created_at timestamptz not null default now(),  -- game created at
  updated_at timestamptz not null default now(),  -- last game update
  constraint app_games_mode_chk check (
    (game_type = 'pool'  and mode in ('pnp', 'pvp')) or
    (game_type = 'chezz' and mode in ('pve', 'pvp'))
  )
);

-- One row per ply: board/layout config + this move's events + actor FKs + per-slot score/clock.
create table if not exists app_game_moves (
  id bigserial primary key,  -- move row id
  game_id text not null references app_games(id) on delete cascade,  -- parent game
  ply integer not null,  -- move number; total moves = max(ply)+1
  state_json jsonb not null,  -- board/layout config only
  events_json jsonb not null default '[]'::jsonb,  -- all events for this one move
  notation text not null default '',  -- move notation / action key
  played_by_id text references app_users(id) on delete set null,  -- who made this move (null on ply 0)
  next_player_id text references app_users(id) on delete set null,  -- whose turn is next (ply 0 = who starts)
  score_a jsonb not null default '[]'::jsonb,  -- slot a claimed tokens (captures / sunk balls)
  score_b jsonb not null default '[]'::jsonb,  -- slot b claimed tokens
  time_a_ms integer,  -- slot a remaining clock after this move
  time_b_ms integer,  -- slot b remaining clock after this move
  created_at timestamptz not null default now(),  -- clock tick anchor for this move
  unique (game_id, ply)
);

-- In-game chat messages.
create table if not exists app_game_messages (
  id bigserial primary key,  -- message id
  game_id text not null references app_games(id) on delete cascade,  -- parent game
  user_id text not null references app_users(id) on delete cascade,  -- sender
  body text not null,  -- message text
  created_at timestamptz not null default now(),  -- sent at
  constraint message_len check (char_length(body) >= 1 and char_length(body) <= 500)
);

-- Online presence for matchmaking and lobby.
create table if not exists app_presence (
  user_id text primary key references app_users(id) on delete cascade,  -- user
  game_type text not null default 'chezz',  -- pool or chezz lobby
  last_seen timestamptz not null default now()  -- last heartbeat
);

-- Matchmaking queue entries.
create table if not exists app_match_queue (
  id bigserial primary key,  -- queue row id
  user_id text not null references app_users(id) on delete cascade,  -- queued user
  game_type text not null default 'chezz',  -- pool or chezz
  status text not null default 'waiting',  -- waiting | matched
  match_id text references app_games(id) on delete set null,  -- assigned game when matched
  created_at timestamptz not null default now(),  -- queued at
  updated_at timestamptz not null default now(),  -- last queue update
  unique (user_id, game_type)
);

-- Shareable invite codes for private games.
create table if not exists app_game_invites (
  id text primary key default (gen_random_uuid()::text),  -- invite id
  game_type text not null,  -- pool or chezz
  inviter_user_id text not null references app_users(id) on delete cascade,  -- creator
  code text not null,  -- join code
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),  -- invite state
  invitee_user_id text references app_users(id) on delete set null,  -- user who accepted
  match_id text references app_games(id) on delete set null,  -- provisioned game when accepted
  created_at timestamptz not null default now(),  -- invite created at
  expires_at timestamptz,  -- optional expiry
  unique (game_type, code)
);

create index if not exists idx_sessions_user on app_sessions(user_id);
create index if not exists idx_sessions_exp on app_sessions(expires_at);
create index if not exists idx_presence_game_seen on app_presence(game_type, last_seen desc);
create index if not exists idx_games_user_type_updated on app_games(user_id, game_type, updated_at desc);
create index if not exists idx_games_type_updated on app_games(game_type, updated_at desc);
create index if not exists idx_games_type_status_winner on app_games(game_type, status, winner_id);
create index if not exists idx_games_player_ab on app_games(player_a_id, player_b_id)
  where player_a_id is not null or player_b_id is not null;
create index if not exists idx_games_player_a_type_status_updated on app_games(player_a_id, game_type, status, updated_at desc)
  where player_a_id is not null;
create index if not exists idx_games_player_b_type_status_updated on app_games(player_b_id, game_type, status, updated_at desc)
  where player_b_id is not null;
create index if not exists idx_moves_game_ply on app_game_moves(game_id, ply asc);
create index if not exists idx_messages_game_id on app_game_messages(game_id, id asc);
create index if not exists idx_match_queue_game_status_time on app_match_queue(game_type, status, created_at asc);
create index if not exists idx_match_queue_user on app_match_queue(user_id, game_type);
create index if not exists idx_app_game_invites_game_type_code on app_game_invites(game_type, code);
create index if not exists idx_app_game_invites_inviter on app_game_invites(inviter_user_id);

-- Seed the engine as a regular profile row (its seat is a plain player FK).
insert into app_users (id, username, password_hash, password_salt, photo_url, created_at)
values (
  'engine',
  'Maximus',
  encode(gen_random_bytes(32), 'hex'),
  encode(gen_random_bytes(32), 'hex'),
  null,
  now()
)
on conflict (id) do update set
  username = excluded.username,
  photo_url = excluded.photo_url;

-- Append one move and update the parent game row (status, winner, reason, sides).
create or replace function app_commit_move(
  p_game_id text,  -- game id
  p_state_json jsonb,  -- board/layout snapshot after the move
  p_events jsonb default '[]'::jsonb,  -- move animation/events
  p_notation text default '',  -- move notation
  p_status text default 'active',  -- game status after move
  p_winner_id text default null,  -- winner user id, if any
  p_reason text default null,  -- terminal reason, if any
  p_played_by_id text default null,  -- user who played the move
  p_next_player_id text default null,  -- user to play next
  p_score_a jsonb default '[]'::jsonb,  -- slot a score after move
  p_score_b jsonb default '[]'::jsonb,  -- slot b score after move
  p_time_a_ms integer default null,  -- slot a clock after move
  p_time_b_ms integer default null,  -- slot b clock after move
  p_side_a text default null,  -- slot a side label
  p_side_b text default null  -- slot b side label
)
returns jsonb  -- { ply: next_ply }
language plpgsql
as $$
declare
  v_next_ply integer;
  v_now timestamptz := now();
begin
  perform 1 from app_games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;

  select coalesce(max(ply), -1) + 1 into v_next_ply
  from app_game_moves where game_id = p_game_id;

  insert into app_game_moves (
    game_id, ply, state_json, events_json, notation,
    played_by_id, next_player_id, score_a, score_b, time_a_ms, time_b_ms
  )
  values (
    p_game_id, v_next_ply, p_state_json, coalesce(p_events, '[]'::jsonb), coalesce(p_notation, ''),
    p_played_by_id, p_next_player_id,
    coalesce(p_score_a, '[]'::jsonb), coalesce(p_score_b, '[]'::jsonb), p_time_a_ms, p_time_b_ms
  );

  update app_games set
    status = p_status,
    winner_id = p_winner_id,
    reason = p_reason,
    side_a = coalesce(p_side_a, side_a),
    side_b = coalesce(p_side_b, side_b),
    updated_at = v_now
  where id = p_game_id;

  return jsonb_build_object('ply', v_next_ply);
end;
$$;

-- Load the active game for a user and game type.
create or replace function app_load_active_game(
  p_user_id text,  -- requesting user
  p_game_type text  -- pool or chezz
)
returns table (
  game_id text,  -- active game id
  game_row jsonb,  -- full app_games row
  snapshot jsonb,  -- latest board/layout state
  latest_move jsonb,  -- latest app_game_moves row
  mode text,  -- game mode
  player_seat text  -- a | b | null
)
language sql
stable
as $$
with candidate_game as (
  select g.*
  from app_games g
  where g.game_type = p_game_type
    and lower(g.status) = 'active'
    and (g.player_a_id = p_user_id or g.player_b_id = p_user_id or g.user_id = p_user_id)
  order by case when g.mode = 'pvp' then 0 else 1 end, g.updated_at desc
  limit 1
),
latest as (
  select m.*
  from app_game_moves m
  join candidate_game g on g.id = m.game_id
  order by m.ply desc
  limit 1
)
select
  g.id as game_id,
  to_jsonb(g) as game_row,
  lm.state_json as snapshot,
  to_jsonb(lm) as latest_move,
  g.mode as mode,
  case
    when g.player_a_id = p_user_id then 'a'
    when g.player_b_id = p_user_id then 'b'
    when g.user_id = p_user_id then 'a'
    else null
  end as player_seat
from candidate_game g
left join latest lm on true;
$$;

-- Provision a ready live match and update both queue entries atomically.
create or replace function app_provision_live_match(
  p_game_type text,  -- pool or chezz
  p_match_id text,  -- new game id
  p_player_a_id text,  -- slot a user
  p_player_b_id text  -- slot b user
)
returns jsonb  -- { ok, match_id, ready_at }
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  insert into app_games (
    id, user_id, player_a_id, player_b_id, game_type, mode, status, created_at, updated_at
  )
  values (
    p_match_id, p_player_a_id, p_player_a_id, p_player_b_id, p_game_type, 'pvp', 'ready', v_now, v_now
  )
  on conflict (id) do nothing;

  insert into app_match_queue (user_id, game_type, status, match_id, created_at, updated_at)
  values
    (p_player_a_id, p_game_type, 'matched', p_match_id, v_now, v_now),
    (p_player_b_id, p_game_type, 'matched', p_match_id, v_now, v_now)
  on conflict (user_id, game_type) do update set
    status = excluded.status,
    match_id = excluded.match_id,
    updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'match_id', p_match_id, 'ready_at', v_now);
end;
$$;

-- Accept one pending invite and provision its ready match in the same transaction.
create or replace function app_accept_game_invite(
  p_game_type text,  -- pool or chezz
  p_code text,  -- invite code
  p_invitee_user_id text,  -- joining user
  p_match_id text  -- new game id to create
)
returns jsonb  -- ok/status/error payload
language plpgsql
as $$
declare
  v_invite app_game_invites%rowtype;
  v_match jsonb;
begin
  select *
  into v_invite
  from app_game_invites
  where game_type = p_game_type and code = p_code
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Invite not found');
  end if;
  if v_invite.status <> 'pending' then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'Invite already used or expired');
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    update app_game_invites set status = 'expired' where id = v_invite.id;
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'Invite expired');
  end if;
  if v_invite.inviter_user_id = p_invitee_user_id then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'You cannot join your own invite');
  end if;

  v_match := app_provision_live_match(p_game_type, p_match_id, v_invite.inviter_user_id, p_invitee_user_id);
  update app_game_invites set
    status = 'accepted',
    invitee_user_id = p_invitee_user_id,
    match_id = p_match_id
  where id = v_invite.id;

  return jsonb_build_object(
    'ok', true,
    'invite_id', v_invite.id,
    'inviter_user_id', v_invite.inviter_user_id,
    'match_id', p_match_id,
    'ready_at', v_match->>'ready_at'
  );
end;
$$;

-- Leaderboard wins/draws/losses for one game type.
create or replace function app_leaderboard(
  p_game_type text  -- pool or chezz
)
returns table (
  user_id text,  -- user id
  username text,  -- display name
  photo_url text,  -- avatar url
  wins bigint,  -- win count
  draws bigint,  -- draw count
  losses bigint  -- loss count
)
language sql
stable
as $$
  with qualifying as (
    select g.player_a_id, g.player_b_id, g.winner_id
    from app_games g
    where g.game_type = p_game_type
      and g.status = 'finished'
      and g.player_a_id is not null
      and g.player_b_id is not null
      -- Pool: humans only, no pass-and-play self-games. Chezz: include PvE (engine is a seat).
      and (p_game_type = 'chezz' or (g.player_a_id <> 'engine' and g.player_b_id <> 'engine'))
      and (p_game_type <> 'pool' or g.player_a_id <> g.player_b_id)
  ),
  seat_rows as (
    select
      g.player_a_id as user_id,
      case
        when g.winner_id is null then 'draw'
        when g.winner_id = g.player_a_id then 'win'
        else 'loss'
      end as outcome
    from qualifying g
    union all
    select
      g.player_b_id as user_id,
      case
        when g.winner_id is null then 'draw'
        when g.winner_id = g.player_b_id then 'win'
        else 'loss'
      end as outcome
    from qualifying g
  ),
  tallies as (
    select
      user_id,
      count(*) filter (where outcome = 'win') as wins,
      count(*) filter (where outcome = 'draw') as draws,
      count(*) filter (where outcome = 'loss') as losses
    from seat_rows
    where user_id is not null
      and (p_game_type = 'chezz' or user_id <> 'engine')
    group by user_id
  )
  select
    u.id,
    u.username,
    u.photo_url,
    coalesce(t.wins, 0),
    coalesce(t.draws, 0),
    coalesce(t.losses, 0)
  from tallies t
  join app_users u on u.id = t.user_id
  where p_game_type = 'chezz' or u.id <> 'engine'
  order by coalesce(t.wins, 0) desc, coalesce(t.draws, 0) desc, coalesce(t.losses, 0) asc;
$$;

-- Single user's wins/draws/losses for one game type.
create or replace function app_user_record(
  p_user_id text,  -- user id
  p_game_type text  -- pool or chezz
)
returns table (
  wins bigint,  -- win count
  draws bigint,  -- draw count
  losses bigint  -- loss count
)
language sql
stable
as $$
  with qualifying as (
    select g.player_a_id, g.player_b_id, g.winner_id
    from app_games g
    where g.game_type = p_game_type
      and g.status = 'finished'
      and g.player_a_id is not null
      and g.player_b_id is not null
      and p_user_id in (g.player_a_id, g.player_b_id)
      and (p_game_type = 'chezz' or (g.player_a_id <> 'engine' and g.player_b_id <> 'engine'))
      and (p_game_type <> 'pool' or g.player_a_id <> g.player_b_id)
  )
  select
    count(*) filter (where winner_id = p_user_id) as wins,
    count(*) filter (where winner_id is null) as draws,
    count(*) filter (where winner_id is not null and winner_id <> p_user_id) as losses
  from qualifying;
$$;

-- Browser clients use the application server, never Supabase RPCs directly.
revoke execute on function app_commit_move(text, jsonb, jsonb, text, text, text, text, text, text, jsonb, jsonb, integer, integer, text, text) from public, anon, authenticated;
revoke execute on function app_load_active_game(text, text) from public, anon, authenticated;
revoke execute on function app_provision_live_match(text, text, text, text) from public, anon, authenticated;
revoke execute on function app_accept_game_invite(text, text, text, text) from public, anon, authenticated;
revoke execute on function app_leaderboard(text) from public, anon, authenticated;
revoke execute on function app_user_record(text, text) from public, anon, authenticated;

grant execute on function app_commit_move(text, jsonb, jsonb, text, text, text, text, text, text, jsonb, jsonb, integer, integer, text, text) to service_role;
grant execute on function app_load_active_game(text, text) to service_role;
grant execute on function app_provision_live_match(text, text, text, text) to service_role;
grant execute on function app_accept_game_invite(text, text, text, text) to service_role;
grant execute on function app_leaderboard(text) to service_role;
grant execute on function app_user_record(text, text) to service_role;

-- Browser roles cannot read or mutate application tables directly.
alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table app_games enable row level security;
alter table app_game_moves enable row level security;
alter table app_game_messages enable row level security;
alter table app_presence enable row level security;
alter table app_match_queue enable row level security;
alter table app_game_invites enable row level security;

revoke all on table app_users, app_sessions, app_games, app_game_moves, app_game_messages, app_presence, app_match_queue, app_game_invites from public, anon, authenticated;
grant all on table app_users, app_sessions, app_games, app_game_moves, app_game_messages, app_presence, app_match_queue, app_game_invites to service_role;

revoke all on sequence app_game_moves_id_seq, app_game_messages_id_seq, app_match_queue_id_seq from public, anon, authenticated;
grant all on sequence app_game_moves_id_seq, app_game_messages_id_seq, app_match_queue_id_seq to service_role;

commit;
