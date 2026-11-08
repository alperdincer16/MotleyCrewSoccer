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
  long, Italy parks the bus). The host picks both sides; clashing kits switch
  to the alternate automatically.
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
| Chat | `Enter` |
| Mute | `M` |
| Toggle prediction | `P` |

## Boosts

⚡ Speed · 🚀 Rocket Kick · 🎈 Giant Ball · ❄️ Freeze · 🔻 Shrink · 🧲 Magnet · 🛡️ Shield

## Architecture

```
shared/rules.js      constants, rule schema, boost catalogue (server + browser)
shared/physics.js    player movement + arena collision, shared for client prediction
shared/teams.js      national teams: kits, traits, bot play styles
server/index.js      static files + WebSocket endpoint
server/lobby.js      room registry: list / create / join / invite
server/room.js       room state machine, 60 Hz loop, 30 Hz snapshots
server/game/match.js authoritative physics, rules engine, boosts
server/game/ai.js    bot brains for GK / DEF / FWD
public/js/*.js       net, audio, pixel-art sprites, renderer, game client, lobby + pre-match UI
test/                node:test suites (rules, match engine, room flow, soak)
```

The server is authoritative: clients only send intent (direction, kick, dash,
aim). Remote players and the ball are interpolated behind the newest snapshot
with an adaptive delay; the local player is predicted with the shared physics
code and reconciled smoothly against each snapshot. See docs/DESIGN.md.
