-- Runman / RunCoach schema.
--
-- Access model: every table has RLS enabled and *no* permissive policy for the
-- `anon` or `authenticated` roles. A leaked publishable key therefore reads
-- nothing. All access runs through the serverless functions in `api/`, which
-- authenticate the Strava session cookie and scope each query to one athlete,
-- and through the RunCoach MCP server, which authenticates an API key. Both
-- connect with the service-role key, which only ever exists server-side.
--
-- Denying by default and granting narrowly beats enumerating what to forbid.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- athletes --

create table if not exists athletes (
  -- Strava's athlete id, as text: it is an external identifier, not ours.
  id                  text primary key,
  username            text,
  firstname           text,
  lastname            text,
  sex                 text check (sex in ('male', 'female', 'unspecified')),
  profile_image_url   text,
  weight_kg           numeric(5, 2),

  -- Athlete-supplied physiology. These are what make heart-rate zones and
  -- training load personal rather than population averages, so they are first
  -- class columns rather than something buried in a JSON blob.
  max_heart_rate      integer check (max_heart_rate between 120 and 230),
  resting_heart_rate  integer check (resting_heart_rate between 25 and 120),
  birth_year          integer check (birth_year between 1900 and 2100),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ------------------------------------------------------------ oauth tokens --

-- Separated from `athletes` so that a query selecting a profile cannot
-- accidentally return credentials.
create table if not exists strava_tokens (
  athlete_id     text primary key references athletes(id) on delete cascade,
  access_token   text        not null,
  refresh_token  text        not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- -------------------------------------------------------------- activities --

create table if not exists activities (
  -- Strava activity id.
  id                 text primary key,
  athlete_id         text not null references athletes(id) on delete cascade,
  name               text not null,
  type               text not null,
  -- Always the UTC instant. Storing local time without an offset silently
  -- shifts every calendar-week bucket by the athlete's timezone.
  start_date         timestamptz not null,
  distance_m         numeric(10, 2) not null check (distance_m >= 0),
  moving_time_s      integer        not null check (moving_time_s >= 0),
  elapsed_time_s     integer        not null check (elapsed_time_s >= 0),
  elevation_gain_m   numeric(8, 2)  not null default 0,
  average_heartrate  numeric(5, 1)  check (average_heartrate between 30 and 230),
  max_heartrate      numeric(5, 1)  check (max_heartrate between 30 and 230),
  average_speed_mps  numeric(6, 3),
  is_race            boolean        not null default false,
  synced_at          timestamptz    not null default now()
);

-- Every read is "this athlete's activities, newest first, since a date".
create index if not exists activities_athlete_date_idx
  on activities (athlete_id, start_date desc);

-- Reference-effort lookups filter to runs before anything else.
create index if not exists activities_athlete_type_idx
  on activities (athlete_id, type);

-- ------------------------------------------------------------- sync state --

create table if not exists sync_state (
  athlete_id          text primary key references athletes(id) on delete cascade,
  last_synced_at      timestamptz,
  -- Cursor for incremental syncs: only ask Strava for activities after this.
  last_activity_date  timestamptz,
  activity_count      integer not null default 0
);

-- --------------------------------------------------------------- api keys --

-- Credentials the athlete issues to RunCoach (or any other MCP client). Only
-- the hash is stored: a database dump must not yield working keys.
create table if not exists api_keys (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    text not null references athletes(id) on delete cascade,
  name          text not null,
  key_hash      text not null unique,
  -- First few characters of the key, for display. Enough to tell two keys
  -- apart in a list, not enough to be one.
  key_prefix    text not null,
  scopes        text[] not null default array['read'],
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);

create index if not exists api_keys_athlete_idx on api_keys (athlete_id) where revoked_at is null;

-- ------------------------------------------------------------------- RLS --

alter table athletes      enable row level security;
alter table strava_tokens enable row level security;
alter table activities    enable row level security;
alter table sync_state    enable row level security;
alter table api_keys      enable row level security;

-- Force RLS even for the table owner, so a mistake in a migration or an admin
-- session cannot quietly bypass it.
alter table athletes      force row level security;
alter table strava_tokens force row level security;
alter table activities    force row level security;
alter table sync_state    force row level security;
alter table api_keys      force row level security;

-- No policies are created on purpose. With RLS enabled and no policy, every
-- role except service_role (which bypasses RLS) reads and writes nothing. If a
-- direct-from-browser path is ever added, it needs an explicit policy keyed to
-- a verified athlete claim — not a blanket `using (true)`.

revoke all on athletes, strava_tokens, activities, sync_state, api_keys from anon, authenticated;

-- --------------------------------------------------------------- triggers --

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists athletes_touch_updated_at on athletes;
create trigger athletes_touch_updated_at
  before update on athletes
  for each row execute function touch_updated_at();

drop trigger if exists strava_tokens_touch_updated_at on strava_tokens;
create trigger strava_tokens_touch_updated_at
  before update on strava_tokens
  for each row execute function touch_updated_at();
