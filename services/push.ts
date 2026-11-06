import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

export async function registerPushNotifications(): Promise<{
  enabled: boolean;
  reason?: string;
}> {
  if (Platform.OS === "web")
    return {
      enabled: false,
      reason: "Push delivery is available on Android and iOS.",
    };
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted
    ? existing
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    return {
      enabled: false,
      reason: "Notification permission was not granted.",
    };
  try {
    const projectId =
      Constants.easConfig?.projectId ??
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
        ?.projectId;
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await api.post("/api/notifications/register-device", {
      token: result.data,
    });
    return { enabled: true };
  } catch {
    return {
      enabled: false,
      reason:
        "Push setup needs a linked Expo/EAS project and valid device credentials.",
    };
  }
}
