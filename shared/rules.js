/**
 * shared/rules.js — constants, rule schema and boost catalogue.
 * Owner: Diego Ferreira (T-02)
 *
 * Loaded by the Node server via require() and by the browser as a plain
 * script (exposed as window.MCS). Keep this file dependency-free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MCS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Arena geometry (world units) ---------------------------------------
  const FIELD = {
    width: 1200,
    height: 700,
    margin: 122,         // space around the arena for goal pockets, hoardings and the stands
    goalDepth: 50,       // how deep the goal pocket is behind the goal line
    cornerRadius: 50,    // rounded arena corners (they curl the ball a little)
  };

  const PLAYER_RADIUS = 20;
  const BALL_RADIUS = 11;

  const TEAMS = ['red', 'blue'];
  const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];   // 4v4 (T-37)
  const TEAM_SIZE = POSITIONS.length;

  const TICK_RATE = 60;      // server simulation Hz
  const SNAPSHOT_RATE = 30;  // network broadcast Hz

  // ---- Rule schema ----------------------------------------------------------
  // Every rule has: label, kind ('number' | 'bool'), default, and for numbers
  // min/max/step. The server validates incoming rule changes against this.
  const RULE_SCHEMA = {
    matchSeconds:    { label: 'Match length (s)',        kind: 'number', def: 180,   min: 60,  max: 600, step: 30 },
    goalLimit:       { label: 'Goal limit (0 = off)',    kind: 'number', def: 0,     min: 0,   max: 15,  step: 1 },
    suddenDeath:     { label: 'Sudden death if tied',    kind: 'bool',   def: true },
    mercyLead:       { label: 'Mercy rule lead (0 = off)',kind: 'number', def: 0,    min: 0,   max: 10,  step: 1 },
    goalWidth:       { label: 'Goal width',              kind: 'number', def: 180,   min: 120, max: 320, step: 20 },
    playerSpeed:     { label: 'Player speed ×',          kind: 'number', def: 1.0,   min: 0.6, max: 1.6, step: 0.1 },
    kickPower:       { label: 'Kick power ×',            kind: 'number', def: 1.0,   min: 0.5, max: 2.0, step: 0.1 },
    ballBounce:      { label: 'Ball bounciness',         kind: 'number', def: 0.85,  min: 0.3, max: 1.1, step: 0.05 },
    ballDrag:        { label: 'Ball drag (1 = none)',    kind: 'number', def: 0.992, min: 0.95, max: 1.0, step: 0.002 },
    dashEnabled:     { label: 'Dash ability',            kind: 'bool',   def: true },
    boostsEnabled:   { label: 'Boost pickups',           kind: 'bool',   def: true },
    pickupInterval:  { label: 'Pickup spawn every (s)',  kind: 'number', def: 8,     min: 3,   max: 30,  step: 1 },
    maxPickups:      { label: 'Max pickups on pitch',    kind: 'number', def: 2,     min: 1,   max: 5,   step: 1 },
    kickoffPause:    { label: 'Pause after goal (s)',    kind: 'number', def: 2.5,   min: 0.5, max: 5,   step: 0.5 },
    botSkill:        { label: 'Bot skill ×',             kind: 'number', def: 1.0,   min: 0.5, max: 1.5, step: 0.1 },
    arena:           { label: 'Arena',                   kind: 'enum',   def: 'classic', options: ['classic', 'ice', 'mud', 'wind', 'bumpers'] },
    specials:        { label: 'Signature moves',         kind: 'bool',   def: true },
    chaosEvents:     { label: 'Chaos events',            kind: 'bool',   def: true },
    chaosEvery:      { label: 'Chaos event every (s)',   kind: 'number', def: 35,    min: 15,  max: 120, step: 5 },
  };

  // ---- Arenas ---------------------------------------------------------------
  // Feel multipliers applied by shared/physics.js (players, so the client can
  // predict them) and server/game/match.js (ball, wind).
  const ARENAS = {
    classic: { label: 'Classic',  icon: '🏟️', desc: 'Fresh grass, no surprises.',
      accel: 1, speed: 1, moveDamp: null, idleDamp: null, ballDrag: 0, ballBounce: 1 },
    ice:     { label: 'Ice rink', icon: '🧊', desc: 'Players slide and the ball barely slows down.',
      accel: 0.5, speed: 1.08, moveDamp: 0.993, idleDamp: 0.985, ballDrag: 0.005, ballBounce: 1.05 },
    mud:     { label: 'Mud bath', icon: '🟫', desc: 'Heavy legs, heavy ball, dead bounces.',
      accel: 0.85, speed: 0.82, moveDamp: 0.94, idleDamp: 0.84, ballDrag: -0.01, ballBounce: 0.65 },
    wind:    { label: 'Windy',    icon: '🌬️', desc: 'Gusts change direction and push the ball around. Lobs drift the most.',
      accel: 1, speed: 1, moveDamp: null, idleDamp: null, ballDrag: 0, ballBounce: 1 },
    bumpers: { label: 'Pinball',  icon: '🔵', desc: 'Four orbiting bumpers fire the ball off at speed.',
      accel: 1, speed: 1, moveDamp: null, idleDamp: null, ballDrag: 0, ballBounce: 1 },
  };

  // ---- Chaos events -----------------------------------------------------------
  const CHAOS = {
    tinyGoals:    { label: 'Tiny Goals',     icon: '🥅', duration: 15, desc: 'Both goals shrink' },
    doublePoints: { label: 'Golden Window',  icon: '✨', duration: 15, desc: 'Goals count double' },
    bouncyBall:   { label: 'Bouncy Castle',  icon: '🏀', duration: 12, desc: 'The ball goes super bouncy' },
    frenzy:       { label: 'Frenzy',         icon: '🔥', duration: 8,  desc: 'Everyone is fast' },
    pickupRain:   { label: 'Pickup Rain',    icon: '🎁', duration: 3,  desc: 'Boosts rain onto the pitch' },
  };
  const CHAOS_IDS = Object.keys(CHAOS);

  // ---- Quick emotes -----------------------------------------------------------
  const EMOTES = [
    { id: 'pass',  text: 'Pass!',  key: '1' },
    { id: 'shoot', text: 'Shoot!', key: '2' },
    { id: 'back',  text: 'Back!',  key: '3' },
    { id: 'nice',  text: 'Nice!',  key: '4' },
    { id: 'sorry', text: 'Sorry!', key: '5' },
    { id: 'wow',   text: 'Wow!',   key: '6' },
  ];

  // ---- Boost catalogue ------------------------------------------------------
  const BOOSTS = {
    speed:   { label: 'Speed',       icon: '⚡', color: '#ffd166', duration: 5,   desc: 'Move 1.6× faster' },
    rocket:  { label: 'Rocket Kick', icon: '🚀', color: '#ef476f', duration: 10,  desc: 'Next kick is 2.2× harder' },
    giant:   { label: 'Giant Ball',  icon: '🎈', color: '#06d6a0', duration: 7,   desc: 'Ball becomes huge and floaty' },
    freeze:  { label: 'Freeze',      icon: '❄️', color: '#8ecae6', duration: 2,   desc: 'Opponents cannot move' },
    shrink:  { label: 'Shrink',      icon: '🔻', color: '#b388eb', duration: 6,   desc: 'Opponents become tiny and slow' },
    magnet:  { label: 'Magnet',      icon: '🧲', color: '#ff9f1c', duration: 5,   desc: 'Ball is pulled toward you' },
    shield:  { label: 'Shield',      icon: '🛡️', color: '#48cae4', duration: 6,   desc: 'Your team cannot be shoved' },
  };
  const BOOST_IDS = Object.keys(BOOSTS);

  // ---- Helpers --------------------------------------------------------------
  function defaultRules() {
    const r = {};
    for (const k of Object.keys(RULE_SCHEMA)) r[k] = RULE_SCHEMA[k].def;
    r.enabledBoosts = BOOST_IDS.slice();
    return r;
  }

  /** Validate and clamp a partial rules object; returns a full rules object. */
  function sanitizeRules(input, base) {
    const out = Object.assign({}, base || defaultRules());
    if (!input || typeof input !== 'object') return out;
    for (const k of Object.keys(RULE_SCHEMA)) {
      if (!(k in input)) continue;
      const s = RULE_SCHEMA[k];
      let v = input[k];
      if (s.kind === 'bool') { out[k] = !!v; continue; }
      if (s.kind === 'enum') { if (s.options.includes(v)) out[k] = v; continue; }
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      v = Math.min(s.max, Math.max(s.min, v));
      // snap to step to keep values tidy
      const steps = Math.round((v - s.min) / s.step);
      v = s.min + steps * s.step;
      out[k] = Number(v.toFixed(4));
    }
    if (Array.isArray(input.enabledBoosts)) {
      out.enabledBoosts = input.enabledBoosts.filter(b => BOOST_IDS.includes(b));
    }
    return out;
  }

  function slotId(team, pos) { return team + ':' + pos; }
  function parseSlot(id) {
    const [team, pos] = String(id).split(':');
    if (!TEAMS.includes(team) || !POSITIONS.includes(pos)) return null;
    return { team, pos };
  }
  function otherTeam(t) { return t === 'red' ? 'blue' : 'red'; }

  // Kickoff formation, expressed for the red team attacking to the right.
  // x is distance from own goal line as a fraction of pitch length.
  const FORMATION = {
    GK:  { fx: 0.06, fy: 0.50 },
    DEF: { fx: 0.22, fy: 0.56 },
    MID: { fx: 0.32, fy: 0.28 },
    FWD: { fx: 0.42, fy: 0.68 },
  };

  return {
    FIELD, PLAYER_RADIUS, BALL_RADIUS, TEAMS, POSITIONS, TEAM_SIZE,
    TICK_RATE, SNAPSHOT_RATE, RULE_SCHEMA, BOOSTS, BOOST_IDS, FORMATION,
    ARENAS, CHAOS, CHAOS_IDS, EMOTES,
    defaultRules, sanitizeRules, slotId, parseSlot, otherTeam,
  };
});
