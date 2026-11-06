import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isAxiosError } from "axios";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth";
import type { AuthSession } from "../types/auth";

const schema = z.object({
  email: z.string().email("Enter a valid email address.").max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128),
});
type Values = z.infer<typeof schema>;
export default function LoginScreen() {
  const router = useRouter();
  const saveSession = useAuthStore((state) => state.setSession);
  const [serverError, setServerError] = useState("");
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    setServerError("");
    try {
      const response = await api.post<AuthSession>("/api/auth/login", values);
      await saveSession(response.data);
      router.replace("/(tabs)");
    } catch (error) {
      const message = isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined;
      setServerError(
        message ?? "Unable to connect. Check your connection and try again.",
      );
    }
  });
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top", "bottom"]}>
      <View className="flex-1 justify-center px-6">
        <View className="mb-8">
          <Image
            source={require("../assets/images/icon.png")}
            style={{
              width: 56,
              height: 56,
              marginBottom: 20,
              borderRadius: 16,
            }}
            accessibilityLabel="ClassTrack academic record icon"
          />
          <Text className="text-3xl font-extrabold tracking-tight text-[#142B4A]">
            ClassTrack
          </Text>
          <Text className="mt-2 text-base text-slate-500">
            Your classes, at a glance.
          </Text>
        </View>
        <View className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <Text className="text-xl font-bold text-slate-900">Sign in</Text>
          <Text className="mt-1 text-sm text-slate-500">
            Use the account provided by your institution.
          </Text>
          <Text className="mb-1 mt-6 text-sm font-semibold text-slate-700">
            Email address
          </Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                placeholder="you@school.edu"
                placeholderTextColor="#94A3B8"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900"
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
              />
            )}
          />
          {errors.email && (
            <Text className="mt-1 text-xs text-red-600">
              {errors.email.message}
            </Text>
          )}
          <Text className="mb-1 mt-4 text-sm font-semibold text-slate-700">
            Password
          </Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                secureTextEntry
                autoComplete="password"
                placeholder="Enter your password"
                placeholderTextColor="#94A3B8"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900"
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
              />
            )}
          />
          {errors.password && (
            <Text className="mt-1 text-xs text-red-600">
              {errors.password.message}
            </Text>
          )}
          {serverError ? (
            <Text
              accessibilityRole="alert"
              className="mt-3 text-sm text-red-600"
            >
              {serverError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={submit}
            style={{
              marginTop: 24,
              borderRadius: 14,
              backgroundColor: "#2563EB",
              paddingVertical: 15,
              alignItems: "center",
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            <View className="flex-row items-center gap-2">
              {isSubmitting && <ActivityIndicator size="small" color="white" />}
              <Text className="font-bold text-white">
                {isSubmitting ? "Signing in…" : "Sign in"}
              </Text>
            </View>
          </Pressable>
          <Link
            href="/forgot-password"
            className="mt-4 text-center text-sm font-semibold text-[#2563EB]"
          >
            Forgot password?
          </Link>
        </View>
        <Text className="mt-6 text-center text-xs leading-5 text-slate-400">
          Your role and institution access are assigned securely by your
          administrator.
        </Text>
      </View>
    </SafeAreaView>
  );
}
