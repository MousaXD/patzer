import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { lookupUser, SESSION_COOKIE_NAME } from '../auth/sessions.js';
import { isAllowedWsOrigin, parseCookies } from './cookies.js';
import type { AuthedUser } from '../types.js';

// In-memory presence: user_id → set of connected lobby WebSockets.
const presence = new Map<number, Set<WebSocket>>();

export function isOnline(userId: number): boolean {
  const set = presence.get(userId);
  return !!set && set.size > 0;
}

export function onlineUserIds(): number[] {
  return Array.from(presence.keys()).filter((id) => isOnline(id));
}

export function notifyUser(userId: number, payload: Record<string, unknown>): boolean {
  const set = presence.get(userId);
  if (!set || set.size === 0) return false;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
  return true;
}

export function broadcastPresence() {
  const ids = onlineUserIds();
  const payload = JSON.stringify({ type: 'presence_update', online: ids });
  for (const set of presence.values()) {
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
}

export function attachLobbyWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/lobby')) return;
    if (!isAllowedWsOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    let user: AuthedUser | null = null;
    try {
      const cookies = parseCookies(req.headers.cookie);
      user = lookupUser(cookies[SESSION_COOKIE_NAME]);
    } catch {
      user = null;
    }
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, user);
    });
  });
}

function handleConnection(ws: WebSocket, user: AuthedUser) {
  let set = presence.get(user.id);
  if (!set) { set = new Set(); presence.set(user.id, set); }
  set.add(ws);

  ws.send(JSON.stringify({ type: 'lobby_hello', user_id: user.id }));
  ws.send(JSON.stringify({ type: 'presence_update', online: onlineUserIds() }));
  broadcastPresence();

  ws.on('close', () => {
    set!.delete(ws);
    if (set!.size === 0) presence.delete(user.id);
    broadcastPresence();
  });

  ws.on('error', () => { /* ignore */ });
}
