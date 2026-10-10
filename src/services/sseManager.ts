import { Response } from "express";

/**
 * Manages Server-Sent Event connections per user.
 * Zero dependencies — uses native Node.js HTTP streaming.
 */

// userId → Set of active SSE response objects
const connections = new Map<number, Set<Response>>();

// Heartbeat interval (keeps connections alive, detects dead clients)
const HEARTBEAT_MS = 30_000;

/**
 * Register a new SSE connection for a user.
 */
export const addConnection = (userId: number, res: Response) => {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(res);

  // Clean up on close
  res.on("close", () => {
    connections.get(userId)?.delete(res);
    if (connections.get(userId)?.size === 0) {
      connections.delete(userId);
    }
  });
};

/**
 * End every open stream of a user (e.g. their client was deactivated). The
 * browser's EventSource reconnects, and the stream endpoint refuses it then.
 */
export const closeConnections = (userId: number) => {
  for (const res of connections.get(userId) ?? []) {
    try {
      res.end();
    } catch {
      // already gone
    }
  }
  connections.delete(userId);
};

/**
 * Push an event to all active connections for a user.
 */
export const pushToUser = (userId: number, event: string, data: any) => {
  const userConns = connections.get(userId);
  if (!userConns || userConns.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead: Response[] = [];

  for (const res of userConns) {
    try {
      res.write(payload);
    } catch {
      dead.push(res);
    }
  }
  dead.forEach((res) => userConns.delete(res));
};

/**
 * Start heartbeat to keep connections alive and detect dead clients.
 */
export const startHeartbeat = () => {
  setInterval(() => {
    for (const [, userConns] of connections) {
      const dead: Response[] = [];
      for (const res of userConns) {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          dead.push(res);
        }
      }
      dead.forEach((res) => userConns.delete(res));
    }
  }, HEARTBEAT_MS);
};

/**
 * Get total active connection count (for monitoring).
 */
export const getConnectionCount = (): number => {
  let count = 0;
  for (const [, conns] of connections) {
    count += conns.size;
  }
  return count;
};
