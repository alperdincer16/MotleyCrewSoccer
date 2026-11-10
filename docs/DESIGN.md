# Motley Crew Soccer — Design Overview

Owner: Alex Mercer (T-01)

## Elevator pitch

Top-down 2D arena soccer, 4 vs 4, in the browser. Matches last three minutes
by default. Walls keep the ball in play so there are no throw-ins and no
stoppages except goals. Pickups spawn on the pitch and grant short, loud
boosts. Any slot a human does not take is played by a bot.

## Flow

1. **Lobby** (`/`): shows every room (waiting or in progress), its player
   count, whether it is locked, and lets you join, create, or enter an
   invite code. Invite links look like `/?invite=CODE` and skip the password.
2. **Pre-match**: two team boards (Red, Blue) with four positions each
   (GK, DEF, MID, FWD). Click a slot to take it; click again to leave it. Bots
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
| Arena | classic | classic / ice / mud / wind / pinball |
| Signature moves | on | toggle |
| Chaos events | on | toggle |
| Chaos event every | 35 s | 15–120 s |

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
  in the box, and clears. A loose ball sitting on the goal line behind the
  keeper is swept out sideways past the post rather than touched in.

## Team play (T-40)

Each team has one **presser**: the outfield player best placed to reach the
ball (a human on the ball always counts as the presser, so bots never take
it off a team-mate). When the opponent has the ball in our half, one more bot,
preferably the defender, **covers** between the ball and our goal. Everyone
else keeps the team's **shape**: formation spots that slide with the ball,
squeezing up when defending and stretching wide and high when we have it so
there is always a pass on. A presser facing a dribbler **jockeys** goal-side
for a moment before committing to a tackle, and backs off again if it fails.
On the ball, bots shoot from a clear look, pass to an open team-mate, carry it
forward when there is room, and only clear it under pressure.

## Possession (T-41)

* Bumping into a ball that someone is dribbling does not knock it loose;
  only a tackle (a kick) can win it.
* For 0.5 s after winning the ball, even tackles can't take it, and the
  player who just lost it can't snatch it straight back.
* A successful tackle plays an animation: the tackler lunges into the ball
  with a motion smear and a TACKLE! callout, dust and an impact ring burst at
  the contact point, and the tackled player stumbles (no kicking for 0.35 s).
* Right next to their own goal, a player's body touch never sends the ball
  backwards into the net (keepers get a bigger zone).

## Ball control

* **First touch**: a ball reaching you slower than ~260 u/s is cushioned
  dead at your feet; above ~700 u/s it bounces off like a block. In between
  it blends.
* **Close control**: the player nearest a slow ball at their feet keeps it
  there. Holding a direction steers it in front of you, so you can turn
  with it; standing still traps it. An opponent alongside halves the grip.
* **Aim**: a kick off a ball under control follows the mouse much more
  closely (75% aim vs 55%).
* Dashing, special-move balls and the giant ball skip all of this.
* **DEF** holds a line between ball and own goal, challenges when the ball
  is in its half.
* **MID** holds the middle third, wins balls that come near, plays the
  forward in and shoots only from a clear look.
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

## Stadium

The arena sits inside empty terraced stands (three stepped tiers coloured by
location) behind advertising hoardings that carry the fixture. There is no
crowd: no fans are drawn and there is no crowd audio (murmur, roars, gasps or
claps). The crowd from T-26/T-47 was removed in T-48.

## Shooting, signature moves and combos (T-27)

* **Charge**: holding kick (or lob) before contact adds up to +42% power
  over 0.75 s. A tap behaves exactly as before. Humans only.
* **Curve**: the client measures how fast the mouse sweeps sideways relative
  to the aim direction (or, without mouse movement, whether you are running
  across the aim line) and sends `curve` in -1..1. The ball's heading then
  rotates at up to 2.4 rad/s, decaying, without changing speed. Touches
  clear spin; walls halve it.
* **Lob**: the ball gets height (`z`, gravity 900). Above 18 units it sails
  over outfield players, keepers reach up to 36, and a ball higher than the
  42-unit crossbar bounces off the goal frame.
* **Signature moves**: a per-player meter (0..1) charges from time on the
  pitch, touches, kicks and completed passes. `E` uses it. Banana, thunder
  and laser arm the next kick for 5 s; tackle, sprint and shockwave act
  immediately. Bots use theirs when the situation fits (for example a
  thunderbolt only when in range and lined up).
* **Combos**: a kick followed within 3 s by a touch from a team-mate is a
  completed pass. Three in a row powers up the team's next shot (+30%, fire
  trail). Any opponent touch resets the chain.

## Arenas and chaos (T-27)

Arena feel multipliers live in `shared/rules.js` (`ARENAS`) and are applied
in `shared/physics.js`, so client prediction of your own player stays exact
on ice and mud. Pinball bumpers move as a pure function of the server tick,
which the client replays too. Wind is server-only and acts on the ball,
twice as hard on a ball in the air.

Chaos events start every `chaosEvery` seconds of open play and last 3–15 s:
Tiny Goals (goal mouth ×0.55; snapshots carry the live goal width), Golden
Window (goals count double), Bouncy Castle, Frenzy (everyone gets Speed)
and Pickup Rain (four boosts at once).

## Player cards and celebrations (T-30, T-31)

Profiles are keyed by the identity token in the browser's localStorage and
saved to `data/profiles.json`. XP per match: 40 played, +60 win / +25 draw,
+25 per goal, +15 per assist, +10 per save, +10 per combo goal, +30 man of
the match, plus tournament bonuses. Level L→L+1 costs 100 + 50·(L−1) XP, up
to level 30. Cosmetic unlocks (hair, hair colour, boots, celebration) are
validated on the server against your level. Players who take over a bot
mid-match only earn for what they did after joining.

When someone scores, the replay shows a player-cam card with their chosen
celebration (bots get one derived from their name).

## Tournament (T-32)

The room's red nation is yours; the first opponent is the blue side, six
more nations are drawn at random. Your fixture each round is played live.
The others are simulated with the real engine and bots, a few hundred ticks
at a time between event-loop turns. Knockout matches always use sudden
death; a draw after that goes to a best-of-five penalty shoot-out. If you
are knocked out, the rest of the bracket is simulated to crown a champion.

## Highlights (T-33)

The client keeps 5 s of snapshots. On each goal it stores the 2.8 s before
and 0.9 s after. From the results screen it re-renders that clip with a
second renderer off-screen, crops a smoothed follow-cam to 480×300 at
15 fps, appends the player-cam celebration and encodes a GIF in the browser
(`public/js/gif.js`, no dependencies).
