import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import { useAuthStore } from "../store/auth";
let socket: Socket | null = null;
export function getMessageSocket(): Socket | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  if (socket?.connected) return socket;
  socket?.disconnect();
  socket = io(api.defaults.baseURL || undefined, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnectionAttempts: 4,
    timeout: 10_000,
  });
  return socket;
}
export function disconnectMessageSocket(): void {
  socket?.disconnect();
  socket = null;
}
