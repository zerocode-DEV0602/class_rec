import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../services/api";
const schema = z.object({
  email: z.string().email("Enter a valid email address."),
});
type Values = z.infer<typeof schema>;
export default function ForgotPasswordScreen() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showResetForm, setShowResetForm] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });
  const submit = handleSubmit(async (values) => {
    setError("");
    setMessage("");
    try {
      const response = await api.post("/api/auth/forgot-password", values);
      const body = response.data as {
        message?: string;
        developmentResetToken?: string;
      };
      setMessage(
        body.message ??
          "If the account exists, reset instructions will be sent.",
      );
      if (body.developmentResetToken) setResetToken(body.developmentResetToken);
      setShowResetForm(true);
    } catch {
      setError("Password reset is unavailable right now. Try again shortly.");
    }
  });
  const completeReset = async () => {
    if (resetToken.trim().length < 32 || newPassword.length < 8) {
      setError(
        "Enter the reset code from your instructions and a password of at least 8 characters.",
      );
      return;
    }
    setResetBusy(true);
    setError("");
    try {
      await api.post("/api/auth/reset-password", {
        token: resetToken.trim(),
        newPassword,
      });
      setResetComplete(true);
      setNewPassword("");
      setMessage(
        "Password updated. Return to sign in using your new password.",
      );
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "The reset code is invalid or expired.",
      );
    } finally {
      setResetBusy(false);
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]">
      <View className="flex-1 justify-center px-6">
        <Link
          href="/login"
          className="mb-6 text-sm font-semibold text-[#2563EB]"
        >
          ‹ Back to sign in
        </Link>
        <Text className="text-3xl font-extrabold text-[#142B4A]">
          Reset password
        </Text>
        <Text className="mt-2 text-base leading-6 text-slate-500">
          Enter your account email and we’ll send reset instructions if it’s
          registered.
        </Text>
        <View className="mt-7 rounded-3xl bg-white p-5 shadow-sm">
          <Text className="text-sm font-semibold text-slate-700">
            Email address
          </Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value } }) => (
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={value}
                onChangeText={onChange}
                placeholder="you@school.edu"
                className="mt-2 rounded-xl border border-slate-200 px-4 py-3 text-base"
              />
            )}
          />
          {errors.email && (
            <Text className="mt-1 text-xs text-red-600">
              {errors.email.message}
            </Text>
          )}
          {message ? (
            <Text className="mt-3 text-sm text-emerald-700">{message}</Text>
          ) : null}
          {error ? (
            <Text className="mt-3 text-sm text-red-600">{error}</Text>
          ) : null}
          {showResetForm && !resetComplete ? (
            <View className="mt-5 border-t border-slate-100 pt-4">
              <Text className="text-sm font-bold text-slate-800">
                Complete password reset
              </Text>
              <Text className="mt-1 text-xs leading-5 text-slate-500">
                Enter the one-time reset code delivered by your institution. In
                development, the code appears below automatically.
              </Text>
              <TextInput
                value={resetToken}
                onChangeText={setResetToken}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Reset code"
                multiline
                className="mt-3 min-h-16 rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoComplete="new-password"
                placeholder="New password (8+ characters)"
                className="mt-2 rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
              <Pressable
                onPress={() => void completeReset()}
                disabled={resetBusy}
                className="mt-3 items-center rounded-xl bg-[#142B4A] py-3"
              >
                <Text className="font-bold text-white">
                  {resetBusy ? "Updating password…" : "Set new password"}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            onPress={submit}
            disabled={isSubmitting}
            style={{
              marginTop: 20,
              borderRadius: 14,
              backgroundColor: "#2563EB",
              padding: 15,
              alignItems: "center",
            }}
          >
            <View className="flex-row items-center gap-2">
              {isSubmitting && <ActivityIndicator color="white" size="small" />}
              <Text className="font-bold text-white">Send instructions</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
