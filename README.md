# Runman

**Live:** [runman-pied.vercel.app](https://runman-pied.vercel.app)

Strava training analytics that shows its work: training load, race predictions
and generated plans, where every number reports which activities it came from,
how it was calculated, and how much to trust it.

The training science lives in **`@runman/core`**, a standalone tested TypeScript
package. This web app imports it, and so does
[RunCoach](https://github.com/varun-gangadharan/runcoach), an MCP server that
exposes the same calculations as tools an LLM can call. Asking Claude "is my
training load trending up before race day" and loading the dashboard run the
same code against the same data.

## Why the numbers are the interesting part

An earlier version of this app computed its metrics inline in React components.
The calculations were plausible-looking and wrong in ways that mattered:

| What it did | Why that breaks | What it does now |
|---|---|---|
| Training load multiplied duration by `avgHR / 180`, or by a flat `0.8` when an activity had no heart rate | 180 bpm is one athlete's max, not everyone's. The flat fallback gave a hill session and a shakeout the same score, with no signal about which numbers were measured | Banister TRIMP against the athlete's own max and resting HR; pace-vs-threshold scoring for activities without HR, calibrated onto the same scale using activities that have both |
| Race prediction picked whichever activity had the fastest *pace* above 30% of the target distance | One GPS glitch reading 3 km in 4 minutes produced a sub-2-hour marathon prediction | Plausibility screening against the world-record curve, then a personal power-law fit across screened efforts; falls back to Riegel from the *closest* effort, never the fastest |
| Selecting an ambitious goal multiplied the prediction by 0.90 | A dropdown does not make anyone 10% faster | Goal shapes pacing advice; the prediction reflects fitness only |
| "Average weekly distance" was `sum(last 30 activities) / 4` | Only correct for a runner averaging exactly 7.5 runs a week. A runner with 30 activities spread over a year was told they average 45 km/week | Real calendar windows, so rest days and quiet weeks land in the denominator |
| Heart-rate zones used fixed 130/150/170 bpm thresholds | Calls a 25-year-old's easy run "tempo" and never registers a hard effort for a 60-year-old | Derived per athlete from their own max, Karvonen when a resting HR is known |

Every one of these has a regression test built from hand-computed values.

## Provenance, not just numbers

Each calculation returns a `method`, a `confidence` and a plain-language
`explanation` alongside its value. A race prediction names every activity it
used *and* every activity it excluded, with the reason. Training load says
whether it was scored from heart rate, from pace, or — in the one case where
neither is possible — from duration alone, explicitly labelled an assumption.

This is what makes the numbers arguable. A runner who disagrees with their
fitness figure can trace it back to individual runs instead of being handed a
number.

## Architecture

```
packages/core/     @runman/core — the training science. No I/O, no framework.
                   64 fixture tests. Imported by the web app and by RunCoach.
apps/web/          React + Vite. Fetches stored activities, computes with core.
api/               Vercel serverless functions. Hold all credentials.
supabase/          Postgres schema and migrations. RLS on, no public policies.
```

**Security model.** The Strava client secret exists only in serverless
environment variables. OAuth token exchange happens server-side; access and
refresh tokens are stored in Postgres and never sent to the browser. The browser
holds an HMAC-signed httpOnly session cookie and nothing else. Every table has
RLS enabled with no permissive policy, so a leaked publishable key reads nothing
— all access runs through functions that authenticate first and scope every
query to one athlete.

This replaced a design that kept Strava tokens in `localStorage` and shipped the
client secret in the browser bundle, with a hardcoded fallback in three files.

**API keys.** Athletes issue read-only keys from the Profile page for RunCoach to
authenticate with. Only a SHA-256 hash is stored; the key is displayed once and
is unrecoverable afterwards.

## Running it

Requires Node 22+ (the core package uses native TypeScript type stripping for
its tests).

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm test                       # 64 core tests, no credentials needed
npm run dev                    # web app on :3000
```

`npm test` and `npm run build` work with no configuration at all, because the
core package does no I/O. Credentials are only needed to sign in and sync.

### Configuration

| Variable | Where it comes from |
|---|---|
| `STRAVA_CLIENT_ID` | strava.com/settings/api. Public — it travels in the OAuth redirect |
| `STRAVA_CLIENT_SECRET` | Same page. Server-side only, never committed |
| `SUPABASE_URL` | Supabase project settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. Bypasses RLS — server-side only |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `APP_URL` | The deployment's public origin, used to build the OAuth redirect URI |

Nothing in the code has a default. A missing variable throws by name on the
first request that needs it, rather than silently falling back to a baked-in
value — which is how a rotated credential goes unnoticed for months.

Set the Strava app's "Authorization Callback Domain" to your deployment's
hostname, and run `supabase/migrations/0001_initial_schema.sql` against your
database before first sign-in.

## Tests

```bash
npm test
```

The fixture set is deliberately adversarial: a consistent runner, a runner with
no heart-rate data at all, a single-activity athlete, an empty history, a runner
whose history contains one GPS glitch, 30 activities spread across a year, a
runner returning from a month off, and one with a sudden volume spike. RunCoach
reuses the same fixtures, so "what should this data produce" has one definition
across both repos.

## Licence

MIT. Earlier revisions of this repository vendored
[robiningelbrecht/statistics-for-strava](https://github.com/robiningelbrecht/statistics-for-strava)
(AGPL-3.0); that code has been removed and none of it remains.
