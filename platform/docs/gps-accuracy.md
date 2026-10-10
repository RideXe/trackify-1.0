# GPS accuracy: how positions are cleaned

GPS cannot be perfect: phones are 3–10 m off in the open and 50 m or more between tall buildings,
indoors or under flyovers, and Android silently substitutes Wi-Fi or cell-tower positions that can
be 1–2 km off. The goal is no visible jumps, no fake distance and correct trips.

## On the phone (most of the work)

1. The Android service samples a fix **every second** (every 5 s on "balanced") and hands JS one
   **window** per tracker interval (30 s by default), so JS wakes once per window.
2. `filterWindow` in `packages/geo/src/track-filter.ts` cleans the window:
   - **gate**: mock locations, no accuracy, accuracy worse than 30 m moving / 50 m parked
     (Wi-Fi and cell fallbacks), out-of-order times;
   - **spike**: A→B→C where B leaves the path and comes back (the last fix of a window waits for
     the next window, so this works across window edges);
   - **physics**: faster than the vehicle can go, impossible acceleration, or a jump the
     receiver's own Doppler speed contradicts; three consistent "impossible" fixes in a row are a
     real jump (tunnel exit) and are kept;
   - **parking**: below 0.8 m/s for 5 s holds one accuracy-weighted position and adds no distance;
   - **smoothing**: Kalman filter (position + Doppler velocity) forward, Rauch–Tung–Striebel
     backward, so turns are not cut;
   - **distance** along the full 1-second track, and **compression** (Douglas–Peucker, 5 m) to the
     points that define the route, at least one per 10 s while driving.
3. The phone uploads one **batch** (format v2 of `POST /phone/positions`) through its offline
   queue. Each point carries `path`, the distance driven since the previous point.

## On the server (light checks; also protects hardware trackers)

`assessFix` in `packages/fleet/src/fix-quality.ts` rejects fixes with fewer than 4 satellites,
HDOP above 5, accuracy worse than 100 m, speeds above the vehicle type's limit (35 m/s buses and
trucks, 50 m/s cars), or jumps far faster than the tracker's own GPS speed. A fix that disagrees
with the past but agrees with the next ones (three in a row) is accepted as a real jump, with no
distance for the jump. Trip distance uses the phone's `path` when it is plausible.

## Debugging a bad track

| Where                         | What you see                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Phone app, tracker log        | `GPS: 30 fixes, 6 sent, 3 dropped (poor accuracy 2, spike 1), 412 m` for every window where something was dropped |
| Position history (API)        | Last point of each phone window: `io.filter.raw`, `filter.kept`, `filter.rejected.<reason>`, `filter.distanceM`   |
| Position history (API)        | Points the server held out: `attributes.rejectedReason` (`speedMismatch`, `fewSatellites`, …)                     |
| CloudWatch, phone ingest logs | `phone batch` entries with the phone's rejected samples whenever it dropped fixes                                 |

Thresholds live in `defaultFilterOptions` (phone) and `fix-quality.ts` (server). Tune them on
real logs; the scenario tests in `packages/geo/test/track-filter.test.ts` must keep passing.

## How often phones sync

Phones always measure once a second; the **sync interval** is only how often a filtered window is
uploaded (5 s, 10 s, 15 s, 30 s, 1 min, 2 min or 5 min).

- **Vehicle setting** (dashboard) overrides the **fleet default** (organisation settings), which
  falls back to 30 s.
- The fleet's **subscription plan** caps how fast either may be: basic 30 s, standard 15 s,
  premium 5 s. Fleets without a plan are standard. The API refuses faster settings, and a
  downgrade slows vehicles at once (the cap is applied when the phone reads its settings).
- Phones re-read their settings every 5 minutes, also in the background, and change the interval
  without restarting tracking.
- Only the platform operator sets plans:
  `npm start -w @trackify/fleet-plan -- --tenant-id TENANT --plan premium --core-table CORE_TABLE`
  (AWS credentials for the account; the Core table name is a Data stack output).

Faster syncs mean more requests and mobile data (5 s is six times 30 s), not more GPS battery.

## Online, offline and "no GPS signal"

- Every window the phone contacts the server, even without a usable position (indoors, weak
  signal, or paused). A window with no position is a **check-in**: the server only refreshes
  "last seen", and any positions saved offline are sent first.
- A vehicle is **offline** after two missed syncs plus a minute, never under 5 minutes (11 minutes
  at a 5-minute interval). The server's offline sweeper and the dashboard use the same rule
  (`offlineAfterMs` in `packages/domain/src/activity.ts`).
- A phone that checks in but has had no fix for that long shows as **"Phone online · no GPS
  signal since …"**; one that stops contacting the server shows **"phone not reachable since …"**.
- The phone's home screen shows what actually reached the server ("Last sent at 14:05"), or why
  not: no GPS, no internet, access refused, server down.
- If Android stops the tracker and won't let it restart in the background, the shift stays on.
  The app restarts tracking as soon as it is opened, and shows "Restart tracking" if nothing has
  been sent for two missed syncs. Drivers are asked to exclude Trackify from battery optimisation.
- The dashboard cannot wake a phone whose app Android has stopped: that needs push notifications.
