# ⚽ Motley Crew Soccer

Fast-paced 2D online soccer, **3 vs 3**, in the browser. Three-minute matches,
walls instead of throw-ins, pickups that grant boosts, and bots that fill every
seat a human doesn't take.

* **Lobby** lists every game (waiting or live). Create your own, lock it with a
  password, and share an invite link that skips the password.
* **Pre-match** page: pick Red or Blue and GK / DEF / FWD. Unclaimed positions
  are bots. The host edits the rules and chooses which boosts are in the pool.
* **National teams**: 16 nations with authentic-looking pixel kits, keeper
  kits and distinct play styles (Brazil dribbles, Spain passes, England goes
  long, Italy parks the bus). Pick both sides when creating a game or in the
  pre-match room; clashing kits switch
  to the alternate automatically.
* **Stadium crowd**: hundreds of pixel fans who cheer, gasp, clap, slump and
  start a Mexican wave depending on what is happening on the pitch.
* **Signature moves**: every nation has one (Brazil's Banana Shot,
  England's thunderbolt, Italy's sliding tackle, Spain's laser pass,
  France's glued-ball sprint, Belgium's shockwave...). Fill the meter by
  playing, then press `E`.
* **Real shooting**: hold kick to charge, sweep the mouse sideways to bend
  it, `F` or right-click to lob over players. Keepers can claw lobs; a ball
  over the bar hits the frame.
* **Combo passes**: three completed passes in a row set the next shot on fire.
* **Arenas**: classic, ice rink, mud bath, windy (shifting gusts) or
  pinball (orbiting bumpers).
* **Chaos events** every ~35 s: tiny goals, golden window (double points),
  bouncy ball, frenzy, pickup rain.
* **Tournament mode**: an 8-nation knockout. Your nation's fixtures are
  played live, the rest are simulated; draws go to penalties; win the
  final for the trophy.
* **Player cards**: XP and levels that persist on the server, career stats,
  and unlockable hairstyles, hair colours, boots and six goal celebrations
  that play on a player cam when you score.
* **Quick shouts** on `1`–`6` (Pass! Shoot! Back! Nice! Sorry! Wow!).
* **Highlight GIFs**: every goal can be downloaded as a GIF from the
  results screen.
* **Live join**: open a game in progress and take over any bot slot.
* **Rules** are all host-editable: match length, goal limit, sudden death,
  mercy rule, goal width, speed, kick power, ball physics, dash, pickups, bot skill.

See [docs/TEAM.md](docs/TEAM.md) for the development team and task board and
[docs/DESIGN.md](docs/DESIGN.md) for the design overview.

## Run it

```bash
npm install
npm start           # http://localhost:3000
PORT=8080 npm start # custom port
npm test            # unit + headless soak tests
```

Open the URL in two browser windows (or send the invite link to friends on the
same network / a deployed host) to play online. Only one dependency (`ws`).

## Controls

| Action | Keys |
|--------|------|
| Move | `W A S D` or arrow keys (touch: left joystick) |
| Kick | `Space` / `X` or mouse click, aim with the mouse |
| Dash | `Shift` / `C` |
| Charged shot | hold kick, release on contact |
| Curve | sweep the mouse sideways as you kick, or run across the ball |
| Lob | `F` or right mouse button (touch: LOB) |
| Signature move | `E` (touch: SKILL) when the meter is full |
| Quick shouts | `1`–`6` (touch: 💬) |
| Chat | `Enter` |
| Mute | `M` |
| Toggle prediction | `P` |

## Boosts

⚡ Speed · 🚀 Rocket Kick · 🎈 Giant Ball · ❄️ Freeze · 🔻 Shrink · 🧲 Magnet · 🛡️ Shield

## Architecture

```
shared/rules.js      constants, rule schema, boost catalogue (server + browser)
shared/physics.js    player movement + arena collision, shared for client prediction
shared/teams.js      national teams: kits, traits, bot play styles, signature moves
shared/progress.js   levels, XP awards, cosmetic unlocks
server/index.js      static files + WebSocket endpoint
server/lobby.js      room registry: list / create / join / invite
server/room.js       room state machine, 60 Hz loop, 30 Hz snapshots
server/game/match.js authoritative physics, rules engine, boosts
server/game/ai.js    bot brains for GK / DEF / FWD
server/tournament.js 8-nation knockout, simulated fixtures, penalties
server/profiles.js   persistent player cards (data/profiles.json, or MCS_DATA_DIR)
public/js/*.js       net, audio, pixel-art sprites, renderer, game client, lobby + pre-match UI,
                     player card, celebrations, highlight GIF encoder
test/                node:test suites (rules, match engine, room flow, soak)
```

The server is authoritative: clients only send intent (direction, kick, dash,
aim). Remote players and the ball are interpolated behind the newest snapshot
with an adaptive delay; the local player is predicted with the shared physics
code and reconciled smoothly against each snapshot. See docs/DESIGN.md.
