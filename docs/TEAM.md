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
| T-16 | Procedural audio: whistle, kick, goal horn, pickup chime | Tomasz Nowak | Done |
| T-17 | Unit tests: physics, rules, boosts, lobby/room flow | Rosa Vidal | Done |
| T-18 | Headless bot-vs-bot soak test (full match completes, no NaNs) | Rosa Vidal | Done |

## Working agreements

* Server is authoritative. Clients only send intent (movement, kick, dash).
* Everything that is not a human is a bot. A slot can be claimed by a human at
  any moment, including mid-match, and reverts to a bot when they leave.
* Matches are short by default (3 minutes) and every rule is a host-editable
  number or toggle, never a hard-coded constant inside gameplay code.
