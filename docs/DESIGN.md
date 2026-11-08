# Motley Crew Soccer — Design Overview

Owner: Alex Mercer (T-01)

## Elevator pitch

Top-down 2D arena soccer, 3 vs 3, in the browser. Matches last three minutes
by default. Walls keep the ball in play so there are no throw-ins and no
stoppages except goals. Pickups spawn on the pitch and grant short, loud
boosts. Any slot a human does not take is played by a bot.

## Flow

1. **Lobby** (`/`): shows every room (waiting or in progress), its player
   count, whether it is locked, and lets you join, create, or enter an
   invite code. Invite links look like `/?invite=CODE` and skip the password.
2. **Pre-match**: two team boards (Red, Blue) with three positions each
   (GK, DEF, FWD). Click a slot to take it; click again to leave it. Bots
   fill the rest. The host edits rules and chooses which boosts are in the
   pool, then presses Start.
3. **Match**: server simulates at 60 Hz, broadcasts snapshots at 30 Hz,
   client renders 100 ms behind with interpolation. Controls: WASD / arrows
   to move, Space (or mouse click) to kick, Shift to dash.
4. **Results**: scoreboard, stats, Rematch button (back to pre-match keeping
   slots) or Leave.

## Customizable rules (all host-editable)

| Rule | Default | Range |
|------|---------|-------|
| Match length | 180 s | 60–600 s |
| Goal limit (first to N, 0 = off) | 0 | 0–15 |
| Sudden death when tied | on | toggle |
| Mercy rule (lead to end match, 0 = off) | 0 | 0–10 |
| Goal width | 180 | 120–320 |
| Player speed | 1.0× | 0.6–1.6× |
| Kick power | 1.0× | 0.5–2.0× |
| Ball bounciness | 0.85 | 0.3–1.1 |
| Ball drag | 0.992 | 0.95–1.0 |
| Dash enabled | on | toggle |
| Boost pickups | on | toggle |
| Pickup spawn interval | 8 s | 3–30 s |
| Enabled boosts | all | per-boost toggles |

## Boosts (pickups)

| Boost | Effect (duration) |
|-------|-------------------|
| Speed | Collector moves 1.6× faster (5 s) |
| Rocket Kick | Collector's next kick is 2.2× power |
| Giant Ball | Ball becomes 2.2× bigger and lighter (7 s) |
| Freeze | All opponents cannot move (2 s) |
| Shrink | All opponents become small and slow (6 s) |
| Magnet | Ball is pulled toward the collector when near (5 s) |
| Shield | Collector's team cannot be pushed around (6 s) |

## Positions and bots

* **GK** stays on the goal line between ball and goal, rushes loose balls
  in the box, and clears.
* **DEF** holds a line between ball and own goal, challenges when the ball
  is in its half.
* **FWD** chases the ball, aims shots at the far post, and spreads out
  when a team-mate is closer to the ball.
