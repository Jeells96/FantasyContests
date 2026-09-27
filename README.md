# Fantasy Contests

A mobile-first daily fantasy contest platform for **NFL, MLB and NBA**, built on React + Vite + Firebase.

An admin picks games; the application does the rest — it pulls the player pool, calculates every salary, derives
the salary cap, and normalizes MLB and NBA fantasy production onto the NFL scoring scale so players from
different sports can compete on one leaderboard without a sport dominating just because it accumulates more
statistical events.

---

## What it does

**For players**
- Enter a first and last name once; it is remembered on the device (honour system, no accounts).
- Browse open, live and completed contests.
- Build one lineup per contest against an automatically calculated salary cap, with player cards showing
  headshots, position, team, opponent, salary, season stats, projections and live points.
- Roster spots are interchangeable — any player fits any spot — and a lineup does not have to be full: spend
  the cap on six stars instead of nine ordinary players if you prefer. Empty spots simply score nothing.
- Make a game-winner pick for every game when the admin enables it.
- Watch a live leaderboard with broadcast-style scoring animations.

**For admins** (PIN `2325`)
- Create a contest from any combination of NFL, MLB and NBA games on a date range.
- The app retrieves players, teams, positions, opponents, headshots, season production and recent form.
- Salaries, the salary cap, cross-sport normalization factors and the game-winner bonus baseline are all
  calculated — none of them are typed in.
- Customise the number of roster spots, the scoring table for each sport and the game-winner bonus percentage.
  Spots can optionally be restricted to positions or to one sport if a positional contest is wanted.
- Run live scoring from the browser or from a headless worker.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Firebase project configuration

The Firebase web config is compiled in with the project's own defaults (`src/lib/firebase.ts`). To point at a
different project, copy `.env.example` to `.env` and fill in the values.

### 3. Enable the two sign-in methods

In the Firebase console → **Authentication → Sign-in method**, enable:

| Provider | Used for |
| --- | --- |
| **Anonymous** | every visitor; the anonymous account is what owns a user's entry |
| **Email/Password** | the single admin account behind the PIN |

### 4. Admin bootstrap

The admin PIN is not a client-side check: it unlocks one real Firebase Auth account, and the Firestore rules
only trust that account. Create it once, in **Authentication → Users → Add user**:

- **Email:** `admin@fantasycontests.app`
- **Password:** `2325::fc-admin-v1`

The password is the PIN plus the salt from `VITE_ADMIN_PW_SALT` (`fc-admin-v1` by default), joined by `::`.
To change the PIN, change this account's password to `<new-pin>::<salt>`. To use a different email or salt, set
`VITE_ADMIN_EMAIL` / `VITE_ADMIN_PW_SALT` and update the email in `firestore.rules` to match.

### 5. Deploy the security rules

The rules are what actually protect the data, so deploy them before using the app:

```bash
npx firebase login
npx firebase use stocks-b13c5
npm run deploy:rules
```

### 6. Run it

```bash
npm run dev      # development
npm run build    # production build into dist/
npm run deploy   # build + deploy hosting, rules and indexes
```

---

## Live scoring

Live statistics are admin-writable only, so something has to be signed in as the admin to publish them. Either:

**From the browser** — Admin → a contest → *Live scoring* → *Start auto-sync*, and leave the tab open.

**Headless** — no browser needed:

```bash
ADMIN_PIN=2325 npm run live-sync                 # every contest that is live
ADMIN_PIN=2325 npm run live-sync -- --contest=<id> --interval=20
ADMIN_PIN=2325 npm run live-sync -- --once       # a single pass, then exit
```

Both paths run the same code (`src/lib/engine/liveSync.ts`): poll the feeds, convert new statistics into raw
and normalized fantasy points, write the changed pool chunks, update game states and scores, and — once every
game is final — freeze the final standings onto the contest.

Behind an HTTP proxy, prefix the worker with `NODE_USE_ENV_PROXY=1` so Node's `fetch` honours `HTTPS_PROXY`.

### Verifying the engine against real data

```bash
npm run check:engine -- --sports=nfl,mlb --date=2026-09-27 --games=3
```

Builds a real player pool, prices it, and prints the salary hierarchy, the automatic cap, normalization
factors, the scoring baseline and live scoring — without touching Firebase.

---

## Data sources

No API keys are required; both feeds are public and CORS-enabled, so the browser calls them directly.

| Sport | Source | Used for |
| --- | --- | --- |
| NFL, NBA | ESPN (`site.api.espn.com`, `site.web.api.espn.com`) | schedule, rosters + headshots, season stats for every athlete, per-player game logs, live box scores, market odds |
| MLB | MLB Stats API (`statsapi.mlb.com`) | schedule + probable pitchers, rosters with season and last-10 splits, live box scores |

MLB uses its own feed because ESPN's baseball box score omits categories this app scores (doubles, triples,
stolen bases). Each sport sits behind the `SportProvider` interface in `src/lib/providers/`, so adding a fourth
sport means adding a provider and a default scoring table — not touching the contest engine.

---

## How the automatic calculations work

### Projections
Season per-game production is blended with recent form (last ~5 games, weighted 40%) and then adjusted for
game context: market-implied team total for NFL/NBA, the opposing probable starter's ERA for MLB hitters. Small
samples are shrunk toward the positional baseline, so one big game does not price a player like a star.

### Cross-sport normalization (`src/lib/engine/normalization.ts`)
NFL is the baseline scale. For each sport, an **anchor** is measured from the selected pool — the mean expected
output of the players who would realistically be rostered from it. Every non-NFL sport is multiplied by
`nflAnchor / sportAnchor`. When a contest has no NFL games there is no measured NFL anchor, so a reference NFL
anchor is used as the target instead. Both the raw sport score and the normalized contest score are stored on
every player, for display and debugging; the leaderboard uses the normalized score.

Measured on real slates: NBA ×0.36 (a 45-point DFS night becomes ~16 contest points), MLB ×1.12.

### Salaries (`src/lib/engine/pricing.ts`)
Each player's salary blends two pool-relative components:

- **production (65%)** — expected contest points against what a "stars" level player in *this* pool produces.
  This keeps points-per-dollar broadly flat, so no tier is a free lunch.
- **scarcity (35%)** — points above the replacement level at the player's own position, where replacement is
  derived from this contest's roster demand.

The result is scaled so the strongest player in the pool costs the maximum ($12,000) and the floor is $3,000.
A slate with one elite player prices him at the ceiling; a slate full of them spreads salary across them all.

### Salary cap (`computeSalaryCap`)
Measured from the pool: the cheapest legal lineup, a median-priced lineup and the most expensive legal lineup
are each constructed, and the cap is placed ~62% of the way from median to maximum, with guards so it can never
reach 92% of the all-stars lineup and never falls below what a complete roster costs. On real slates this lands
around 80% of the all-stars lineup — several stars fit, all of them never do.

Because rosters are positionless and need not be filled, the cap is the real constraint on a lineup, and the
trade-off it creates is the interesting one: a few expensive stars with spots left empty, or a full roster of
cheaper players.

### Roster format (`src/lib/engine/roster.ts`)
Contests default to interchangeable spots (9 for NFL, 11 for MLB, 8 for NBA, 9 for multi-sport), which is what
makes a cross-sport contest straightforward — there is no NFL FLEX to reconcile with an MLB outfielder. The
engine still enforces whatever a spot lists, so an admin can load a traditional positional preset, restrict one
spot to `RB, WR, TE`, or pin a spot to a single sport.

### Game-winner bonus
The bonus is a percentage of a **contest scoring baseline** frozen when the contest is created: the expected
normalized score of a solid, ordinary lineup from the pool. It is never a percentage of a user's own score,
which would make scoring circular, and every entrant receives exactly the same points for a correct pick.

---

## Security model

`firestore.rules` enforces the following on the server, independent of the UI:

| Data | Read | Write |
| --- | --- | --- |
| Contest config, salaries, caps, scoring, normalization, live stats, results | public | admin only |
| A user's lineup + game-winner picks | the owner, plus everyone **after lock** | the owner, **only before lock** |
| Public entrant record (name only) | public | the owner, before lock |

- **Other users' rosters are unreadable before lock**, including by listing the collection — the leaderboard
  falls back to the public entrant records, which contain no roster, no picks and no score.
- **Entries become immutable at lock.** Writes are rejected by comparing `request.time` against the contest's
  stored lock timestamp, which is the first game's start.
- **No user-writable field contains a score.** Scores are recomputed from the admin-written player pool every
  time the leaderboard renders, so an entry cannot carry points of its own.
- **Submitted lineups are re-validated when scored.** The rules check ownership, lock state, entry shape, that
  a lineup is never longer than the roster, and the self-reported salary against the cap; `buildLeaderboard`
  then re-checks every lineup against the stored salaries, the cap, duplicate players and any position
  restrictions, and flags and demotes any entry that breaks them. A lineup crafted outside the UI therefore
  gains nothing. A lineup that is merely *short* is legal and is scored normally.

The PIN's only job is to sign in to the admin account. Anyone who learns the PIN is an admin — but nobody who
doesn't have it can write admin data, whatever they do to the frontend.

---

## Project layout

```
src/
  types.ts                  sport-neutral contest domain model
  lib/
    stats.ts                canonical stat vocabulary per sport
    scoring.ts              default scoring tables + fantasy point calculation
    firebase.ts             app + separate admin auth app
    db.ts                   Firestore access (contests, chunked pools, entries, standings)
    identity.ts             device-local name
    providers/              espn.ts (NFL/NBA), mlb.ts (MLB), http.ts, registry
    engine/
      projections.ts        expected production
      normalization.ts      cross-sport scaling
      pricing.ts            salaries, salary cap, scoring baseline
      roster.ts             roster formats + position eligibility
      lineup.ts             lineup/entry validation
      leaderboard.ts        scoring, ranking, violation detection
      liveSync.ts           fold live feed results into a contest
      contestState.ts       lock/live/complete derivation
      liveEvents.ts         scoring events for the animations
  hooks/                    realtime contest data, scoring events
  components/               player cards, roster, picks, leaderboard, overlay
  pages/                    home, contest, admin, admin wizard, live control
scripts/
  live-sync.ts              headless live scoring worker
  engine-check.ts           engine smoke check against real feeds
```

### Contest states

`UPCOMING/OPEN` → enter and edit freely, other rosters hidden. → `LIVE` at the first game's start: everything
locks, rosters become visible, live scoring and animations begin. → `COMPLETE` when every game is final: final
scores, bonuses and standings are frozen onto the contest.

Ranking is by highest final total. `buildLeaderboard` assigns shared ranks on ties, leaving room for
tie-breaker rules to be layered in later without touching the scoring path.

---

## Known limitations

- **Live scoring needs an admin session running** (browser tab or worker) — Firestore rules deliberately do not
  let clients write statistics. A Cloud Function on the Blaze plan would be the natural next step.
- **Two-point conversions** are not in ESPN's live box score, so they score from season data only.
- **NFL D/ST projections** are estimates from the game's implied point total plus league-average takeaway
  rates, not team-by-team defensive splits; blocked kicks are not detected live.
- **Entrant counts** on the main page come from an aggregation query per contest, refreshed on load.
