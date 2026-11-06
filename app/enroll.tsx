import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isAxiosError } from "axios";
import { api } from "../services/api";
const schema = z.object({
  enrollmentCode: z
    .string()
    .trim()
    .min(4, "Enter the code shared by your faculty member.")
    .max(32),
});
type Values = z.infer<typeof schema>;
type Enrollment = {
  _id?: string;
  status: string;
  reason?: string;
  createdAt?: string;
  offeringId?: {
    subjectId?: { code?: string; name?: string };
    facultyId?: { name?: string };
    sectionId?: { name?: string };
  };
};
export default function EnrollScreen() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { data = [], isLoading } = useQuery<Enrollment[]>({
    queryKey: ["enrollments", "student"],
    queryFn: async () =>
      (await api.get<{ items: Enrollment[] }>("/api/enrollments/student")).data
        .items,
  });
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { enrollmentCode: "" },
  });
  const submit = handleSubmit(async ({ enrollmentCode }) => {
    setError("");
    setMessage("");
    try {
      await api.post("/api/enrollments/request", {
        enrollmentCode: enrollmentCode.toUpperCase(),
      });
      setMessage("Request sent. Your faculty member will review it.");
      await queryClient.invalidateQueries({
        queryKey: ["enrollments", "student"],
      });
    } catch (e) {
      setError(
        isAxiosError(e)
          ? ((e.response?.data as { error?: string } | undefined)?.error ??
              "The request could not be sent.")
          : "The request could not be sent.",
      );
    }
  });
  const cancel = async (id: string) => {
    setError("");
    setMessage("");
    try {
      await api.patch(`/api/enrollments/${id}/cancel`);
      setMessage("Pending enrollment request cancelled.");
      await queryClient.invalidateQueries({
        queryKey: ["enrollments", "student"],
      });
    } catch (e) {
      setError(
        isAxiosError(e)
          ? ((e.response?.data as { error?: string } | undefined)?.error ??
              "Request could not be cancelled.")
          : "Request could not be cancelled.",
      );
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
        <Link
          href="/(tabs)/subjects"
          className="mb-5 text-sm font-semibold text-[#2563EB]"
        >
          ‹ My subjects
        </Link>
        <Text className="text-2xl font-extrabold text-[#142B4A]">
          Enroll in a subject
        </Text>
        <Text className="mt-2 text-sm leading-5 text-slate-500">
          Enter the unique code shared by your faculty member. Your place is
          confirmed only after approval.
        </Text>
        <View className="mt-5 rounded-2xl bg-white p-5">
          <Text className="text-sm font-semibold text-slate-700">
            Enrollment code
          </Text>
          <Controller
            control={control}
            name="enrollmentCode"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                autoCapitalize="characters"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="e.g. 2F8A91BC"
                className="mt-2 rounded-xl border border-slate-200 px-4 py-4 text-lg font-bold tracking-widest text-[#142B4A]"
              />
            )}
          />
          {errors.enrollmentCode && (
            <Text className="mt-1 text-xs text-red-600">
              {errors.enrollmentCode.message}
            </Text>
          )}
          {message ? (
            <Text className="mt-3 text-sm text-emerald-700">{message}</Text>
          ) : null}
          {error ? (
            <Text className="mt-3 text-sm text-red-600">{error}</Text>
          ) : null}
          <Pressable
            onPress={submit}
            disabled={isSubmitting}
            style={{
              marginTop: 18,
              borderRadius: 14,
              backgroundColor: "#2563EB",
              padding: 15,
              alignItems: "center",
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            <View className="flex-row items-center gap-2">
              {isSubmitting && <ActivityIndicator color="white" size="small" />}
              <Text className="font-bold text-white">
                {isSubmitting ? "Sending request…" : "Request enrollment"}
              </Text>
            </View>
          </Pressable>
        </View>
        <Text className="mb-3 mt-7 text-lg font-bold text-slate-900">
          My requests
        </Text>
        {isLoading ? (
          <ActivityIndicator color="#2563EB" />
        ) : data.length === 0 ? (
          <View className="rounded-xl bg-white p-4">
            <Text className="text-sm text-slate-500">
              Your enrollment requests will appear here.
            </Text>
          </View>
        ) : (
          data.map((entry) => (
            <View
              key={entry._id}
              className="mb-2 flex-row items-center justify-between rounded-xl bg-white p-4"
            >
              <View className="flex-1">
                <Text className="font-semibold text-slate-900">
                  {entry.offeringId?.subjectId?.code ?? "Class"} ·{" "}
                  {entry.offeringId?.subjectId?.name ?? "Subject"}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {entry.offeringId?.facultyId?.name ?? "Faculty"} ·{" "}
                  {entry.offeringId?.sectionId?.name ?? "Section"}
                </Text>
                {entry.reason ? (
                  <Text className="mt-1 text-xs text-slate-500">
                    Reason: {entry.reason}
                  </Text>
                ) : null}
              </View>
              <View className="ml-2 items-end">
                <Text
                  className={`rounded-full px-3 py-1 text-xs font-bold ${entry.status === "approved" ? "bg-emerald-50 text-emerald-700" : entry.status === "rejected" ? "bg-rose-50 text-rose-700" : entry.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                >
                  {entry.status}
                </Text>
                {entry.status === "pending" && entry._id ? (
                  <TouchableOpacity
                    onPress={() => void cancel(entry._id!)}
                    className="mt-2"
                  >
                    <Text className="text-xs font-bold text-rose-700">
                      Cancel request
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
