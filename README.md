# Runman

**Live:** [runman-pied.vercel.app](https://runman-pied.vercel.app)

I love running, so I built a training dashboard that uses real activity data to
explain training load, race predictions, and planning instead of giving generic
advice.

Runman shares its core logic with
[RunCoach](https://github.com/varun-gangadharan/runcoach), an MCP server that
lets an assistant answer training questions from the same underlying data and
calculations.

## What it does

- imports Strava history through CSV upload today, with API sync support built in
- shows training load, consistency, and recent trend
- predicts race times from recorded efforts instead of guesses
- generates plans from measured training history
- explains where each number came from and how it was computed

## Why it exists

Most fitness apps give polished numbers without much context. I wanted
something closer to "show your work":

- what runs were used
- what method was used
- what got excluded
- how confident the result is

That matters more than the number itself.

## Stack

- `@runman/core` for the shared training logic
- React + Vite web app
- Vercel functions for auth and sync
- Supabase/Postgres for storage

## Repo layout

```text
packages/core/  shared training logic and fixtures
apps/web/       Runman frontend
api/            serverless auth and sync handlers
supabase/       schema and migrations
```

## Running locally

Requires Node 22+.

```bash
npm install
cp .env.example .env.local
npm test
npm run dev
```

`npm test` covers the shared core plus app/server behavior. `npm run build`
works without needing live Strava credentials.

## Configuration

Set these in `.env.local`:

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `APP_URL`

## Current state

- bulk CSV import is the main working path for Strava data
- API sync is implemented, but depends on Strava app access being active
- Runman and RunCoach use the same core logic and shared fixtures to stay in sync

## License

MIT
