import { useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../services/api";
import { registerPushNotifications } from "../../services/push";
import { useAuthStore } from "../../store/auth";
export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setUser = useAuthStore((state) => state.setUser);
  const [busy, setBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [nameDraft, setNameDraft] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const saveName = async () => {
    if (nameDraft.trim().length < 2) {
      setProfileMessage("Enter a name of at least 2 characters.");
      return;
    }
    setBusy(true);
    setProfileMessage("");
    try {
      const result = await api.patch<{ item: { name: string } }>(
        "/api/auth/profile",
        { name: nameDraft.trim() },
      );
      if (user) setUser({ ...user, name: result.data.item.name });
      setProfileMessage("Profile updated and audited.");
    } catch (e) {
      setProfileMessage(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Profile could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  const changePassword = async () => {
    if (currentPassword.length < 8 || newPassword.length < 8) {
      setProfileMessage(
        "Enter your current password and a new password of at least 8 characters.",
      );
      return;
    }
    setBusy(true);
    setProfileMessage("");
    try {
      await api.patch("/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setProfileMessage(
        "Password changed. Please sign in again with your new password.",
      );
      await clearSession();
      router.replace("/login");
    } catch (e) {
      setProfileMessage(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Password could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* Revoke locally even if offline. */
    }
    await clearSession();
    router.replace("/login");
  };
  const roleName = user?.role.replaceAll("_", " ") ?? "student";
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 32,
        }}
      >
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          ACCOUNT
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          Profile
        </Text>
        <View className="mt-5 items-center rounded-3xl bg-[#142B4A] p-6">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-white/15">
            <Text className="text-2xl font-bold text-[#F5C542]">
              {user?.name?.trim().charAt(0).toUpperCase() ?? "C"}
            </Text>
          </View>
          <Text className="mt-3 text-xl font-bold text-white">
            {user?.name ?? "ClassTrack member"}
          </Text>
          <Text className="mt-1 text-sm capitalize text-blue-100">
            {roleName}
          </Text>
        </View>
        <View className="mt-4 rounded-2xl bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Email
          </Text>
          <Text className="mt-1 font-semibold text-slate-900">
            {user?.email ?? "—"}
          </Text>
          <Text className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Institution access
          </Text>
          <Text className="font-semibold text-slate-900">
            {user?.role === "super_admin"
              ? "System-wide"
              : user?.institutionId
                ? "Assigned institution"
                : "Not assigned"}
          </Text>
        </View>
        <View className="mt-4 rounded-2xl bg-white p-4">
          <Text className="font-bold text-slate-900">Edit profile</Text>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="Full name"
            className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
          />
          <Text className="mt-2 text-xs text-slate-500">
            Your email and assigned role are managed by your institution.
          </Text>
          <TouchableOpacity
            onPress={() => void saveName()}
            disabled={busy}
            className="mt-3 items-center rounded-xl bg-blue-50 py-3"
          >
            <Text className="font-bold text-[#2563EB]">Save profile</Text>
          </TouchableOpacity>
        </View>
        <View className="mt-4 rounded-2xl bg-white p-4">
          <Text className="font-bold text-slate-900">Change password</Text>
          <TextInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoComplete="current-password"
            placeholder="Current password"
            className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
          />
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
            placeholder="New password (8+ characters)"
            className="mt-2 rounded-xl border border-slate-200 px-3 py-3 text-sm"
          />
          <TouchableOpacity
            onPress={() => void changePassword()}
            disabled={busy}
            className="mt-3 items-center rounded-xl bg-slate-100 py-3"
          >
            <Text className="font-bold text-[#142B4A]">Update password</Text>
          </TouchableOpacity>
        </View>
        {profileMessage ? (
          <Text className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            {profileMessage}
          </Text>
        ) : null}
        <TouchableOpacity
          onPress={() => {
            void registerPushNotifications().then((result) =>
              setPushMessage(
                result.enabled
                  ? "Push notifications are enabled on this device."
                  : (result.reason ?? "Could not enable push notifications."),
              ),
            );
          }}
          className="mt-4 rounded-xl border border-blue-200 bg-white p-4"
        >
          <Text className="font-bold text-[#2563EB]">
            Enable push notifications
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            Get enrollment, grade and message alerts on this device.
          </Text>
          {pushMessage ? (
            <Text className="mt-2 text-xs text-slate-600">{pushMessage}</Text>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void logout()}
          disabled={busy}
          className="mt-4 flex-row items-center justify-center rounded-xl border border-rose-200 bg-white py-4"
        >
          {busy && <ActivityIndicator color="#B91C1C" size="small" />}
          <Text className="ml-2 font-bold text-rose-700">Sign out</Text>
        </TouchableOpacity>
        <Text className="mt-4 text-center text-xs text-slate-400">
          ClassTrack · Academic records, clearly managed.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
