import type { Server } from "socket.io";
let server: Server | null = null;
export function setRealtimeServer(io: Server): void {
  server = io;
}
export function emitToUser(
  userId: string,
  event: string,
  payload: unknown,
): void {
  server?.to(`user:${userId}`).emit(event, payload);
}
