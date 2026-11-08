/**
 * server/lobby.js — registry of rooms; create / join / invite / list.
 * Owner: Priya Natarajan (T-04)
 */
'use strict';

const { Room } = require('./room');
const { S2C } = require('./protocol');

class Lobby {
  constructor() {
    this.rooms = new Map();     // roomId -> Room
    this.clients = new Set();   // every connected client (for lobby broadcasts)
    this.broadcastPending = false;
  }

  addClient(client) { this.clients.add(client); client.send({ type: S2C.LOBBY, games: this.list() }); }
  removeClient(client) { this.clients.delete(client); if (client.room) client.room.disconnectPlayer(client, false); }

  list() {
    return [...this.rooms.values()]
      .map(r => r.summary())
      .sort((a, b) => (a.status === 'prematch' ? 0 : 1) - (b.status === 'prematch' ? 0 : 1) || b.createdAt - a.createdAt);
  }

  createRoom(client, opts) {
    if (client.room) client.room.disconnectPlayer(client, true);
    if (this.rooms.size >= 200) { client.send({ type: S2C.ERROR, code: 'full', message: 'Server is full, try again later' }); return null; }
    const room = new Room(this, client, opts || {});
    this.rooms.set(room.id, room);
    room.addPlayer(client);
    return room;
  }

  joinRoom(client, { roomId, password, invite }) {
    let room = null;
    if (invite) {
      const code = String(invite).trim().toUpperCase();
      room = [...this.rooms.values()].find(r => r.inviteCode === code);
      if (!room) return client.send({ type: S2C.ERROR, code: 'bad_invite', message: 'That invite code is not valid any more' });
    } else {
      room = this.rooms.get(roomId);
      if (!room) return client.send({ type: S2C.ERROR, code: 'no_room', message: 'That game no longer exists' });
      if (room.password && room.password !== String(password || '') && !room.players.has(client.id)) {
        return client.send({ type: S2C.ERROR, code: 'bad_password', message: 'Wrong password' });
      }
    }
    if (client.room && client.room !== room) client.room.disconnectPlayer(client, true);
    if (room.players.size >= 12 && !room.players.has(client.id)) {
      return client.send({ type: S2C.ERROR, code: 'room_full', message: 'That room is full' });
    }
    room.addPlayer(client);
  }

  removeRoom(room) {
    this.rooms.delete(room.id);
    this.broadcastLobby();
  }

  /** Coalesce lobby updates into one broadcast per tick of the event loop. */
  broadcastLobby() {
    if (this.broadcastPending) return;
    this.broadcastPending = true;
    setImmediate(() => {
      this.broadcastPending = false;
      const data = JSON.stringify({ type: S2C.LOBBY, games: this.list() });
      for (const c of this.clients) c.sendRaw(data);
    });
  }
}

module.exports = { Lobby };
