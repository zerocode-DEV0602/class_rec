import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth";
import type { ClassTrackUser } from "../types/auth";

export default function StartScreen() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const restoreTokens = useAuthStore((state) => state.restoreTokens);
  const setUser = useAuthStore((state) => state.setUser);
  const clearSession = useAuthStore((state) => state.clearSession);
  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await restoreTokens();
      if (!active) return;
      if (!session.accessToken) {
        router.replace("/login");
        return;
      }
      try {
        const response = await api.get("/api/auth/me");
        setUser((response.data as { user: ClassTrackUser }).user);
        if (active) router.replace("/(tabs)");
      } catch {
        await clearSession();
        if (active) {
          setFailed(true);
          router.replace("/login");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [clearSession, restoreTokens, router, setUser]);
  return (
    <View className="flex-1 items-center justify-center bg-[#F8FAFC]">
      <ActivityIndicator size="large" color="#2563EB" />
      <Text className="mt-4 text-sm text-slate-500">
        {failed ? "Please sign in again" : "Opening your class record…"}
      </Text>
    </View>
  );
}
