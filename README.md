# Fantasy Contests

A mobile-first daily fantasy contest platform for **NFL, MLB and NBA**, built on React + Vite + Firebase.

Anyone can start a contest and hand out its six-digit code; the application does the rest — it pulls the player
pool, calculates every salary, derives
the salary cap, and normalizes MLB and NBA fantasy production onto the NFL scoring scale so players from
different sports can compete on one leaderboard without a sport dominating just because it accumulates more
statistical events.

---

## What it does

**For players**
- Enter a first and last name once; it is remembered on the device (honour system, no accounts).
- Start a contest, or join someone else's by typing its six-digit code. Your contests page lists only the
  contests you started or joined, and every card shows that contest's code so it can be passed on without
  anyone memorizing it.
- Build one lineup per contest against an automatically calculated salary cap, with player cards showing
  headshots, position, team, opponent, salary, season stats, projections and live points.
- Roster spots are interchangeable — any player fits any spot — and every spot must be filled to submit.
- One player can be named **team captain**: they score 1.5× points and cost 1.5× salary. Tap a player to add
  them, tap again to make them captain, tap a third time to drop them. The captain leads the roster wherever
  it is displayed, and the salary cap is calculated with the premium included.
- Finishing an entry names the team: an alliterative, G-rated name built from the first name — "Jaren's
  Jumping Jackrabbits" — with 196 combinations per letter and a shuffle button.
- Tapping a player adds them; tapping them again takes them back out. A player you cannot afford is refused
  with the amount you have left, rather than being added and rejected at submission. When a lineup is not
  submittable yet, the footer says exactly what is missing.
- The pinned footer tracks salary used, salary remaining, the average left per unfilled spot, and roster
  progress, with the action on its own full-width row beneath. Once the roster is full it offers *Next*, which
  moves on to the game-winner picks, and becomes *Submit* once those are made. Saving goes straight to the
  leaderboard.
- Make a game-winner pick for every game when the contest has them enabled.
- Watch a live leaderboard with broadcast-style scoring animations, and a green "+4.6" — or a red "-2.0" — on
  any player the moment their score moves, on your lineup, the leaderboard and the scoring tab alike. Badges
  belong to the latest play: the next one replaces them, so several players light up together if they scored
  on the same play.
- A **Scoring** tab with the best lineup the pool currently allows (the perfect lineup once games are final),
  a live feed of every scoring change — defenses and losses included — stamped with where the game stood
  ("2nd & 10 · 3rd 10:15 · LAR 16 - 7 DEN") and tagged with who rosters the player, and the pool ranked by
  points.
- A leaderboard toggle that lays every entrant out as a grid of tiles — 3 across for a small group, 4 for a
  full one — so the whole field fits on one screen without scrolling.

**For whoever starts a contest**
- Build it from any combination of NFL, MLB and NBA games on a date range. No PIN is needed.
- The app retrieves players, teams, positions, opponents, headshots, season production and recent form.
- Salaries, the salary cap, cross-sport normalization factors and the game-winner bonus baseline are all
  calculated — none of them are typed in.
- Customise the number of roster spots, the scoring table for each sport and the game-winner bonus percentage.
  Spots can optionally be restricted to positions or to one sport if a positional contest is wanted.
- Publishing hands back a six-digit join code to share.
- Editing, deleting, marking final and running live scoring belong to the contest's creator alone; everyone
  else sees the contest but not the controls.

**For admins** (PIN `2325`)
- Sets the defaults a new contest opens with: sports, how many days of games to load, roster spots, whether
  captains and game-winner picks start on, the captain multiplier and the bonus percentage.
- That is all the PIN does now — it does not run contests.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Firebase project configuration

The Firebase web config is compiled in with the project's own defaults (`src/lib/firebase.ts`). To point at a
different project, copy `.env.example` to `.env` and fill in the values.

**No Firebase Authentication is required.** Nothing needs enabling in the console beyond Firestore itself:

- a player is identified by a random id generated on their own device and kept in `localStorage`;
- a contest belongs to the device id that created it, and is reached by its six-digit join code;
- the default settings are unlocked by comparing the PIN (`2325`, override with `VITE_ADMIN_PIN`) in the
  browser.

### 3. Security rules

Paste these into **Firestore → Rules** in the console, or run `npm run deploy:rules` (they are in
`firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function contestLocked(contestId) {
      let contest = get(/databases/$(database)/documents/contests/$(contestId)).data;
      return contest.keys().hasAny(['lockAt']) && request.time >= contest.lockAt;
    }

    match /contests/{contestId} {
      allow read, write: if true;
      match /pool/{chunkId} { allow read, write: if true; }
      match /standings/{entryId} { allow read, write: if true; }
      match /entries/{entryId} {
        allow get: if true;
        allow list: if contestLocked(contestId);
        allow create, update: if !contestLocked(contestId);
        allow delete: if true;
      }
    }

    match /config/{document} { allow read, write: if true; }
  }
}
```

These are open rules — no login — but they still keep two contest guarantees that need no account:

- **entries freeze at lock**, so a lineup cannot be edited once the first game starts;
- **entries cannot be listed before lock**, so nobody can pull down the field's rosters and picks while the
  contest is open. Reading a single entry requires already knowing its random device id.

If you would rather have nothing at all in the way, this is the fully open equivalent:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

The app works under either. The only difference is that the fully open version lets anyone read every roster
before lock, and lets a submitted lineup be changed after the games have started.

### 4. What open rules mean

Worth being clear about, since the trade-off was chosen deliberately: the Firebase web config ships inside the
JavaScript bundle, as it must for the browser to connect. With open rules, anyone who reads it can read, write
and delete this database directly with their own script. The admin PIN keeps the default settings out of
casual reach, and contest ownership and join codes keep other people's contests off your screen; neither is a
server-side check, because there is no login for the server to check against.

That is fine for a private contest among people you know. If the app is ever shared more widely, the way to
close it is Firebase Authentication plus rules that key off `request.auth.uid`.

### 5. Run it

```bash
npm run dev      # development
npm run build    # production build into dist/
npm run deploy   # build + deploy hosting, rules and indexes
```

Contests created before join codes existed need one before they will appear on anybody's contests page:

```bash
npm run backfill:codes -- --dry     # show what would change
npm run backfill:codes              # give each one a code, an owner and its members
```

The owner is taken to be the earliest entrant, which in practice is whoever set the contest up; pass
`--contest=<id> --owner=<deviceId>` to say otherwise.

---

## Live scoring

**Normally nothing has to be running.** While a contest is live, whichever browsers have its page open take
turns polling the feeds and writing the results back, coordinating through the contest's `lastSyncAt` so they
do not all poll at once. Scoring therefore keeps moving whenever a single participant is watching.

The two manual options remain, for a contest nobody happens to have open:

**From the browser** — open your contest → *Live scoring* → *Start auto-sync*, and leave the tab open.

**Headless** — no browser needed:

```bash
npm run live-sync                  # every contest that is live
npm run live-sync -- --contest=<id> --interval=20
npm run live-sync -- --once        # a single pass, then exit
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
| Betting lines | SportsGameOdds (`api.sportsgameodds.com`) | the point spread for each game, read once when a contest is created |

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

Because rosters are positionless, the cap is the real constraint on a lineup: every spot must be filled, so
paying up for stars means finding value in the spots that are left.

### Roster format (`src/lib/engine/roster.ts`)
Contests default to interchangeable spots (9 for NFL, 11 for MLB, 8 for NBA, 9 for multi-sport), which is what
makes a cross-sport contest straightforward — there is no NFL FLEX to reconcile with an MLB outfielder. The
engine still enforces whatever a spot lists, so a creator can load a traditional positional preset, restrict one
spot to `RB, WR, TE`, or pin a spot to a single sport.

### Team captain (`src/lib/engine/captain.ts`)
Exactly one rostered player may be captain, scoring and costing `multiplier`× (1.5 by default, configurable per
contest). Because the premium is real cap space, the salary cap and the scoring baseline are both computed with
it: the cheapest measured lineup captains its cheapest player, every other measured lineup captains its most
expensive, and the baseline adds the bonus on its strongest projection. Contests created before captains
existed have no `captain` field, which reads as disabled.

### Best possible lineup (`src/lib/engine/optimal.ts`)
The highest score the pool allows under the contest's own rules — roster size, salary cap and the captain
multiplier — since a lineup breaking them was never available to anyone. With interchangeable spots it is
solved exactly, as a knapsack over salary in hundreds with one slot reserved for the captain; position-locked
rosters fall back to a greedy fill, which the result reports as inexact. Checked against brute force over 40
randomised pools.

### Spread picks (`src/lib/engine/spread.ts`)
Picks are made against the point spread. The line is read from SportsGameOdds when the contest is created and
frozen onto the contest, so later movement cannot change what entrants were picking against; a game with no
line available falls back to a straight winner pick.

Because not everyone knows what a spread is, the number is never presented on its own. Each side shows its
line *and* what it has to do — "Must win by 4+", "Can lose by up to 3, or win" — and whole-number lines say
plainly that landing exactly on the number is a tie that pays nobody. Grading follows the same rule: a pick
covers when its margin plus its line is above zero, a push earns no bonus and costs nothing.

### Spread pick bonus
The bonus is a percentage of a **contest scoring baseline** frozen when the contest is created: the expected
normalized score of a solid, ordinary lineup from the pool. It is never a percentage of a user's own score,
which would make scoring circular, and every entrant receives exactly the same points for a correct pick.

---

## Security model

This app runs without Firebase Authentication, by choice. What that means in practice:

| Data | Read | Write |
| --- | --- | --- |
| Contests, pools, salaries, scoring, live stats, results | anyone | anyone |
| Public entrant records (name only) | anyone | anyone |
| Lineups + game-winner picks | one at a time, if you know its device id; the whole list only **after lock** | only **before lock** |

What the rules still enforce, without any login:

- **Entries are immutable once the contest locks.** Writes are rejected by comparing `request.time` against the
  contest's stored lock timestamp, which is the first game's start.
- **Rosters are not listable before lock.** The leaderboard falls back to the public entrant records, which
  contain no roster, no picks and no score.

What is *not* enforced, and should be understood:

- **Contest ownership is a client-side check.** A contest records the device id that created it, and the app
  shows the edit, delete and scoring controls only to that device. Since there is no login, the rules cannot
  verify a device id, so someone writing their own script could still edit another person's contest.
- **A join code is an invitation, not a lock.** It keeps contests off everyone else's list; it is not a secret
  the database enforces.
- **The admin PIN is a client-side check.** It gates the default settings in the UI; it cannot stop someone
  writing to Firestore directly.
- **Anyone can write contest data.** Salaries, scoring, live statistics and results are all publicly writable.

Two things are still true regardless, because they are properties of the scoring code rather than the rules:

- **No score is ever read from a user-writable field.** Scores are recomputed from the stored player pool every
  time the leaderboard renders, so an entry cannot carry points of its own.
- **Submitted lineups are re-validated when scored.** `buildLeaderboard` re-checks every lineup against the
  stored salaries, the cap, duplicate players and any position restrictions, and flags and demotes entries that
  break them. A lineup that is merely *short* is legal and is scored normally.

## Project layout

```
src/
  types.ts                  sport-neutral contest domain model
  lib/
    stats.ts                canonical stat vocabulary per sport
    scoring.ts              default scoring tables + fantasy point calculation
    firebase.ts             Firestore app + the admin PIN
    defaults.ts             house defaults a new contest opens with
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
  pages/                    home, contest, contest builder, live control, admin defaults
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

## Publishing to GitHub Pages

`.github/workflows/deploy-pages.yml` builds the app and publishes it to
`https://<owner>.github.io/<repo>/` on every push to `main`.

The repository's **Settings → Pages → Source** must be **GitHub Actions**. On "Deploy from a branch" GitHub
runs its own build on each push that publishes the repository root — the unbuilt `index.html` — over this one,
and the site renders blank. The workflow's last step fetches the live URL and fails the run if that happens,
so a misconfiguration shows up as a red build rather than a blank page.

## Known limitations

- **Live scoring rides on open browsers.** Any tab viewing a live contest drives the polling, so scores only
  stall if nobody is watching and neither an open tab nor the worker is running. A Cloud Function on the
  Blaze plan would make it fully independent.
- **Two-point conversions** are not in ESPN's live box score, so they score from season data only.
- **NFL D/ST projections** are estimates from the game's implied point total plus league-average takeaway
  rates, not team-by-team defensive splits; blocked kicks are not detected live.
- **Entrant counts** on the main page come from an aggregation query per contest, refreshed on load.
