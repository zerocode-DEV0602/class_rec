import axios, { isAxiosError, type InternalAxiosRequestConfig } from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useAuthStore } from "../store/auth";

const configuredBase = Constants.expoConfig?.extra?.apiBaseUrl;
const nativeHost = Constants.expoConfig?.hostUri?.split(":")[0];
const baseURL =
  typeof configuredBase === "string" && configuredBase.length > 0
    ? configuredBase.replace(/\/$/, "")
    : Platform.OS === "web"
      ? ""
      : `http://${nativeHost || "127.0.0.1"}:3000`;

export const api = axios.create({
  baseURL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<string | null> | null = null;
api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (
      !isAxiosError(error) ||
      !error.config ||
      error.response?.status !== 401 ||
      error.config.url?.includes("/auth/")
    )
      throw error;
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      await useAuthStore.getState().clearSession();
      throw error;
    }
    refreshPromise ??= axios
      .post(
        `${baseURL}/api/auth/refresh`,
        { refreshToken },
        { timeout: 15_000 },
      )
      .then(async (response) => {
        const data = response.data as {
          user: import("../types/auth").ClassTrackUser;
          accessToken: string;
          refreshToken: string;
        };
        await useAuthStore.getState().setSession(data);
        return data.accessToken;
      })
      .catch(async () => {
        await useAuthStore.getState().clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
    const token = await refreshPromise;
    if (!token) throw error;
    error.config.headers.Authorization = `Bearer ${token}`;
    return api.request(error.config);
  },
);
