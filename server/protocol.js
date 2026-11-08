/**
 * server/protocol.js — message names shared by client and server.
 * Owner: Priya Natarajan (T-03)
 *
 * Every WebSocket frame is JSON: { type: string, ...payload }.
 */
'use strict';

const C2S = {
  HELLO: 'hello',            // { name, token? }
  SET_NAME: 'setName',       // { name }
  LIST: 'listGames',         // {}
  CREATE: 'createGame',      // { name, password?, rules? }
  JOIN: 'joinGame',          // { roomId, password? } | { invite }
  LEAVE: 'leaveGame',        // {}
  PICK_SLOT: 'pickSlot',     // { slot }  slot = "red:GK" etc.
  LEAVE_SLOT: 'leaveSlot',   // {}
  READY: 'setReady',         // { ready }
  RULES: 'updateRules',      // { rules }      (host only)
  SET_TEAM: 'setTeam',       // { side, nation } (host only)
  KICK: 'kickPlayer',        // { playerId }   (host only)
  START: 'startGame',        // {}             (host only)
  REMATCH: 'rematch',        // {}             (host only)
  INPUT: 'input',            // { up, down, left, right, kick, dash, aimX, aimY }
  CHAT: 'chat',              // { text }
  PING: 'ping',              // { t }
};

const S2C = {
  WELCOME: 'welcome',        // { id, name, token }
  LOBBY: 'lobby',            // { games: [...] }
  ROOM: 'room',              // full room state or null when you left
  MATCH_START: 'matchStart', // { rules }
  SNAPSHOT: 'snapshot',      // match snapshot
  MATCH_END: 'matchEnd',     // { winner, score, stats }
  ERROR: 'error',            // { code, message }
  CHAT: 'chat',              // { from, text, team? }
  PONG: 'pong',              // { t }
};

module.exports = { C2S, S2C };
