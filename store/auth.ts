import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { Platform } from "react-native";
import type { AuthSession, ClassTrackUser } from "../types/auth";

const ACCESS_KEY = "classtrack.access";
const REFRESH_KEY = "classtrack.refresh";
async function read(key: string): Promise<string | null> {
  if (Platform.OS === "web")
    return typeof sessionStorage === "undefined"
      ? null
      : sessionStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}
async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof sessionStorage !== "undefined")
      sessionStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
async function remove(key: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

type AuthState = {
  user: ClassTrackUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  ready: boolean;
  setSession: (session: AuthSession) => Promise<void>;
  restoreTokens: () => Promise<{
    accessToken: string | null;
    refreshToken: string | null;
  }>;
  setUser: (user: ClassTrackUser) => void;
  clearSession: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  ready: false,
  setSession: async (session) => {
    await Promise.all([
      write(ACCESS_KEY, session.accessToken),
      write(REFRESH_KEY, session.refreshToken),
    ]);
    set({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      ready: true,
    });
  },
  restoreTokens: async () => {
    const [accessToken, refreshToken] = await Promise.all([
      read(ACCESS_KEY),
      read(REFRESH_KEY),
    ]);
    set({ accessToken, refreshToken, ready: true });
    return { accessToken, refreshToken };
  },
  setUser: (user) => set({ user }),
  clearSession: async () => {
    await Promise.all([remove(ACCESS_KEY), remove(REFRESH_KEY)]);
    set({ user: null, accessToken: null, refreshToken: null, ready: true });
  },
}));
