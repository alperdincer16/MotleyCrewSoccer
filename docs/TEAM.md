# Motley Crew Soccer — Game Development Team

Every task in this project is owned by exactly one team member. Ownership is
recorded here, in the header comment of each source file, and in the
`Owner:` trailer of every commit.

| # | Member | Role | Owns |
|---|--------|------|------|
| 1 | **Alex Mercer** | Producer / Technical Lead | Project structure, architecture, docs, task board, release |
| 2 | **Priya Natarajan** | Backend & Netcode Engineer | HTTP/WebSocket server, lobby, rooms, invites, protocol, snapshots |
| 3 | **Diego Ferreira** | Gameplay Engineer | Physics, match rules engine, customizable rules, scoring |
| 4 | **Mei Lin** | AI Engineer | Bot controller for every slot not taken by a human |
| 5 | **Sam Okafor** | Frontend / UX Engineer | Lobby page, create-game dialog, pre-match page, HUD, results |
| 6 | **Tomasz Nowak** | Art & Audio | Pitch/player/ball rendering, visual effects, procedural sound |
| 7 | **Rosa Vidal** | QA Engineer | Automated tests, bot-vs-bot soak test, bug triage |

## Task board

| ID | Task | Owner | Status |
|----|------|-------|--------|
| T-01 | Project skeleton, package.json, team charter, design doc | Alex Mercer | Done |
| T-02 | Shared constants + rule presets module (`shared/rules.js`) | Diego Ferreira | Done |
| T-03 | Static HTTP server + WebSocket endpoint + message protocol | Priya Natarajan | Done |
| T-04 | Lobby: list ongoing games, create game, password protection, invite links | Priya Natarajan | Done |
| T-05 | Room state machine: pre-match → playing → finished → rematch | Priya Natarajan | Done |
| T-06 | Pre-match slot picking (team + position), host controls, kick/ready | Priya Natarajan (server) / Sam Okafor (UI) | Done |
| T-07 | Arena physics: players, ball, walls, goals, kicking, dash | Diego Ferreira | Done |
| T-08 | Match rules engine: timer, kickoff, goal limit, sudden death, mercy rule | Diego Ferreira | Done |
| T-09 | Boost system: pickups, timed effects, host-selectable boost set | Diego Ferreira | Done |
| T-10 | Bot AI: goalkeeper, defender, forward behaviours; takes over empty slots | Mei Lin | Done |
| T-11 | Client networking: connect, reconnect, input stream, snapshot interpolation | Priya Natarajan | Done |
| T-12 | Lobby UI + create-game dialog + join-by-code / invite-link flow | Sam Okafor | Done |
| T-13 | Pre-match UI: team boards, slot picking, rules editor, boost toggles | Sam Okafor | Done |
| T-14 | In-game HUD, results screen, mid-match join (claim a bot slot) | Sam Okafor | Done |
| T-15 | Canvas renderer: pitch, players, ball, pickups, effects, camera shake | Tomasz Nowak | Done |
| T-19 | 16-bit style pixel-art player sprites: kits, skin/hair variety, walk and kick frames, slot avatars | Tomasz Nowak | Done |
| T-20 | Shared physics module; sub-stepped ball collisions (no tunnelling); kick input buffer; dash-into-ball | Diego Ferreira | Done |
| T-21 | Client-side prediction of the local player on the server tick grid, adaptive interpolation delay, net HUD | Priya Natarajan | Done |
| T-22 | Bot quality: per-tick kick safety, passing lanes, spacing, keeper reads, host-set bot skill | Mei Lin | Done |
| T-23 | Instant replay on goals, golden-goal banner, clock pulse and ticks, kick/post shake | Sam Okafor / Tomasz Nowak | Done |
| T-24 | Input rate limiting, aim clamping, physics guarantee tests | Priya Natarajan / Rosa Vidal | Done |
| T-26 | Stadium: stands with ~900 large animated pixel fans, hoardings, flags; crowd reacts to tension, goals, posts, pickups, final minute, full time, Mexican wave; procedural crowd audio | Tomasz Nowak | Done |
| T-25 | National teams: 16 nations with home/alt kits, keeper kits, traits and bot play styles; team pickers in create dialog and pre-match room; kit-clash resolution | Mei Lin (styles) / Tomasz Nowak (kits) / Sam Okafor (picker) / Rosa Vidal (tests) | Done |
| T-16 | Procedural audio: whistle, kick, goal horn, pickup chime | Tomasz Nowak | Done |
| T-17 | Unit tests: physics, rules, boosts, lobby/room flow | Rosa Vidal | Done |
| T-18 | Headless bot-vs-bot soak test (full match completes, no NaNs) | Rosa Vidal | Done |
| T-27 | Signature moves per nation, charged/curved/lob shots with ball height, combo passes, arenas (ice, mud, wind, pinball), chaos events, keeper saves; bots use specials | Diego Ferreira (physics/rules) / Mei Lin (bots) | Done |
| T-28 | Visuals and sound for T-27: armed auras, slides, knockdowns, ball height and trails, bumpers, wind, arena surfaces, callouts | Tomasz Nowak | Done |
| T-29 | HUD for T-27 (skill meter, combo pips, chaos and wind chips), quick shouts with speech bubbles, touch LOB/SKILL/shout buttons | Sam Okafor | Done |
| T-30 | Player cards: persistent XP and levels, career stats, cosmetic unlocks validated server-side, results XP panel | Alex Mercer (design) / Priya Natarajan (storage) / Sam Okafor (UI) | Done |
| T-31 | Goal celebrations (six animations, new sprite frames) on a player cam during the replay | Tomasz Nowak | Done |
| T-32 | Tournament mode: 8-nation knockout, cooperative simulation of other fixtures, penalties, bracket and trophy UI | Priya Natarajan / Mei Lin / Sam Okafor | Done |
| T-33 | Goal highlight GIF export with follow-cam and in-browser GIF encoder | Tomasz Nowak / Sam Okafor | Done |
| T-34 | Tests for T-27 to T-33 | Rosa Vidal | Done |
| T-35 | UI polish pass: shared tokens for spacing, radii and type; consistent buttons, inputs and selects; lobby, create dialog, pre-match room, HUD, results and player card tidied; pitch fits the window; phone layouts; readable team colours on dark UI | Sam Okafor | Done |
| T-36 | Real soccer ball: shaded truncated-icosahedron pattern that rolls in 3D with the ball's movement and spins on curved shots (rendering only) | Tomasz Nowak | Done |
| T-37 | 4v4: midfielder (MID) slot, formation, MID bot brain, keeper sweeps loose balls off the goal line | Mei Lin (bots) / Diego Ferreira (formation) | Done |
| T-38 | Ball control: cushioned first touch, close dribbling with turning, aim-true kicks off a controlled ball, snappier turns | Diego Ferreira | Done |
| T-39 | Tests for T-37 and T-38 | Rosa Vidal | Done |

## Working agreements

* Server is authoritative. Clients only send intent (movement, kick, dash).
* Everything that is not a human is a bot. A slot can be claimed by a human at
  any moment, including mid-match, and reverts to a bot when they leave.
* Matches are short by default (3 minutes) and every rule is a host-editable
  number or toggle, never a hard-coded constant inside gameplay code.
