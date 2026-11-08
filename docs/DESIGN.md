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
| Bot skill | 1.0× | 0.5–1.5× |
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

## Art direction

Players are 14×20 pixel-art sprites in the style of 16-bit football games:
big heads, team kits (red with white stripes, blue with white sleeves),
shorts, socks and boots, with an automatically generated one-pixel outline.
Skin tone, hair colour and hairstyle are derived from the player's name so a
person always looks the same; goalkeepers wear dark trim and gloves. Sprites
have stand, two walk and one kick frame, flip to face their direction of
travel, and turn icy blue while frozen. The same sprites appear as avatars on
the pre-match slot cards and the spectator take-over bar.

## Netcode

* The server simulates at 60 Hz and sends 30 snapshots a second. The ball is
  sub-stepped inside a tick whenever it would move more than three quarters
  of its radius, so a full-power shot cannot pass through a post or a player.
* Remote players and the ball are rendered behind the newest snapshot by an
  adaptive delay (60–160 ms, from measured snapshot jitter) with linear
  interpolation and a short extrapolation if a snapshot is late.
* The local player is predicted. `shared/physics.js` is the same movement
  code the server runs. The client maps snapshot tick numbers onto its own
  clock with a min-filter, then replays its input history tick by tick on the
  server's grid up to the moment its current input will land. When a new
  snapshot arrives, the old and new predictions are compared for the same
  instant and the difference decays away as a smoothing offset, so
  corrections never snap. Press `P` in a match to toggle prediction.
* Human kick presses are buffered for 150 ms so a tap just before contact
  still connects; bots are evaluated every tick and get no buffer.
* Inputs are rate-limited per connection; aim coordinates are clamped to the
  arena.

## Bots

* Bots re-plan every 100–140 ms (scaled by the host's Bot skill rule) but the
  decision to kick is re-checked every tick with the real kick geometry: a
  kick that would cross the bot's own goal line is never taken.
* Forwards shoot at the far post, or pass when the shooting lane is blocked
  by an opponent and a team-mate is free; defenders clear or pass; keepers
  read slow shots well and are late on fast ones, hold the line against
  fast balls and only rush slow ones from the goal side.
* Bots grab nearby pickups when the ball is not urgent and always shoot
  when holding a Rocket Kick.

## Presentation

* Goals trigger confetti, camera shake, a goal banner with scorer and
  assist, and an instant replay of the last 1.4 s played back during the
  kickoff pause with letterbox bars and a REPLAY tag.
* The clock turns red and pulses in the last ten seconds and ticks in the
  last five. Sudden-death winners get a GOLDEN GOAL banner.

## National teams

The host picks a nation for each side in the pre-match room (default: a random
pair). Each nation has a home kit, an alternate kit (worn by the second side
when the two home jerseys are too similar), a keeper colour, three small
trait modifiers that apply to every player on the team including humans, and a
bot play style. Traits are capped at ±8% so no nation is strictly better.

| Nation | Style | How the bots play | Speed / Kick / Dash recharge |
|--------|-------|-------------------|------------------------------|
| 🇧🇷 Brazil | Joga Bonito | Quick feet, dribbles at defenders, shoots from close range. | +6% / -4% / +0% |
| 🇦🇷 Argentina | Garra | Relentless pressing and hard tackles; wins the ball high up the pitch. | +3% / +0% / +18% |
| 🇩🇪 Germany | Die Maschine | Disciplined shape and patient passing; strikes with power when the lane opens. | -2% / +6% / +0% |
| 🇫🇷 France | Contre-attaque | Sits deep, then breaks at speed; forwards love the counter. | +4% / +2% / +11% |
| 🇮🇹 Italy | Catenaccio | Defends the box as a unit, keeper comes for everything, scores on the break. | -3% / +5% / +0% |
| 🇪🇸 Spain | Tiki-taka | Passes, passes, passes; only shoots when the chance is clear. | +0% / -5% / -9% |
| 🏴󠁧󠁢󠁥󠁮󠁧󠁿 England | Route One | Long balls forward and thunderous shots from anywhere. | -2% / +8% / +0% |
| 🇳🇱 Netherlands | Total Football | Everyone attacks, everyone defends; the defender pushes right up. | +2% / +0% / +0% |
| 🇵🇹 Portugal | Flair | Shoots from distance, dashes into space, a little greedy. | +2% / +4% / +11% |
| 🇯🇵 Japan | Hassle | Swarms the ball carrier and moves it on quickly. | +5% / -4% / +5% |
| 🇺🇸 USA | Athletic | Fit and fearless: dashes recover fastest in the game. | +2% / +0% / +33% |
| 🇳🇬 Nigeria | Power | Fast and physical; hits the ball harder than anyone when it sits up. | +3% / +6% / +0% |
| 🇭🇷 Croatia | Midfield control | Keeps the ball moving and pushes the defender up to support. | +0% / +2% / +0% |
| 🇲🇽 Mexico | Quick feet | Nimble and busy; wins second balls and plays one-twos. | +5% / -5% / +5% |
| 🇧🇪 Belgium | Balanced | No weaknesses, no gimmicks: a textbook side. | +0% / +0% / +0% |
| 🇹🇷 Türkiye | Ateş | All heart: presses hard, shoots early, dashes into every duel. | +3% / +3% / +11% |

Bot play style knobs: `press` (how far from goal the defender engages, and
whether forwards hunt in the opponent half), `passing` (willingness to pass
instead of shoot, and support distance), `shootRange` (distance from goal at
which forwards shoot rather than look for a pass), `defLine` (how high the
defender holds), `gkRush` (how far and how fast a ball the keeper will come
for), `dash` (how often bots dash into duels) and `flair` (shot placement
variance).
