import { Image, ScrollView, Text, View, TouchableOpacity } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { api } from "../../services/api";
import { useAuthStore } from "../../store/auth";
import type { ClassTrackUser } from "../../types/auth";

import { ScreenContainer } from "@/components/screen-container";

/**
 * Home Screen - NativeWind Example
 *
 * This template uses NativeWind (Tailwind CSS for React Native).
 * You can use familiar Tailwind classes directly in className props.
 *
 * Key patterns:
 * - Use `className` instead of `style` for most styling
 * - Theme colors: use tokens directly (bg-background, text-foreground, bg-primary, etc.); no dark: prefix needed
 * - Responsive: standard Tailwind breakpoints work on web
 * - Custom colors defined in tailwind.config.js
 */
export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user) as ClassTrackUser | null;
  const { data, isLoading, isError, refetch } = useQuery<{
    metrics: { label: string; value: number | string }[];
    recent?: { title?: string; body?: string }[];
  }>({
    queryKey: ["dashboard", user?.role],
    queryFn: async () => (await api.get("/api/dashboard/summary")).data,
  });
  const role = user?.role ?? "student";
  const roleTitle =
    role === "super_admin"
      ? "Super Admin"
      : role === "administrator"
        ? "Administrator"
        : role === "faculty"
          ? "Faculty"
          : "Student";
  const actions =
    role === "faculty"
      ? [
          {
            title: "Create class offering",
            detail: "Set a subject, section, schedule and code",
            path: "/records",
          },
          {
            title: "Review enrollments & records",
            detail: "Gradebook, attendance and student support",
            path: "/records",
          },
          {
            title: "Generate reports",
            detail: "Class record, attendance and performance",
            path: "/reports",
          },
          {
            title: "Announcements & messages",
            detail: "Communicate with your classes",
            path: "/announcements",
          },
          {
            title: "Student support plans",
            detail: "Record recommendations and track follow-up",
            path: "/interventions",
          },
        ]
      : role === "student"
        ? [
            {
              title: "Enroll in a subject",
              detail: "Enter a class enrollment code",
              path: "/enroll",
            },
            {
              title: "View my subjects",
              detail: "Classes, grades and academic progress",
              path: "/subjects",
            },
            {
              title: "Announcements",
              detail: "Read school and class updates",
              path: "/announcements",
            },
          ]
        : [
            {
              title: "Manage accounts",
              detail: "Search people and institution access",
              path: "/manage",
            },
            {
              title: "Academic structure",
              detail: "Edit departments, years, semesters and subjects",
              path: "/manage",
            },
            {
              title: "System & audit",
              detail: "Settings, login activity and audit history",
              path: "/manage?panel=system",
            },
            {
              title: "Generate reports",
              detail: "Class, attendance and performance exports",
              path: "/reports",
            },
          ];
  return (
    <ScreenContainer className="p-0 bg-[#F8FAFC]">
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View className="bg-[#142B4A] px-6 pb-7 pt-5">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-bold uppercase tracking-[2px] text-blue-200">
                CLASSTRACK · {roleTitle}
              </Text>
              <Text className="mt-2 text-2xl font-extrabold text-white">
                Good day, {user?.name?.split(" ")[0] ?? "there"}.
              </Text>
            </View>
            <Image
              source={require("../../assets/images/icon.png")}
              style={{ width: 48, height: 48, borderRadius: 16 }}
              accessibilityLabel="ClassTrack checked-book icon"
            />
          </View>
          <Text className="mt-2 text-sm text-blue-100">
            Your classes, at a glance.
          </Text>
        </View>
        <View className="px-5">
          <View className="-mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-slate-900">
                Your overview
              </Text>
              <TouchableOpacity onPress={() => void refetch()}>
                <Text className="text-sm font-semibold text-[#2563EB]">
                  Refresh
                </Text>
              </TouchableOpacity>
            </View>
            {isLoading ? (
              <View className="mt-4 flex-row flex-wrap gap-3">
                {[1, 2, 3, 4].map((item) => (
                  <View
                    key={item}
                    className="h-20 min-w-[44%] flex-1 rounded-xl bg-slate-100"
                  />
                ))}
              </View>
            ) : isError ? (
              <View className="mt-4 rounded-xl bg-rose-50 p-4">
                <Text className="text-sm font-semibold text-rose-700">
                  We couldn’t load your records.
                </Text>
                <TouchableOpacity
                  onPress={() => void refetch()}
                  className="mt-2"
                >
                  <Text className="text-sm font-semibold text-[#2563EB]">
                    Try again
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="mt-3 flex-row flex-wrap gap-3">
                {(data?.metrics ?? []).map((metric, index) => (
                  <View
                    key={metric.label}
                    className="min-w-[44%] flex-1 rounded-xl bg-[#F8FAFC] p-3"
                  >
                    <Text className="text-xs font-medium text-slate-500">
                      {metric.label}
                    </Text>
                    <Text
                      className={`mt-2 text-2xl font-extrabold ${index === 0 ? "text-[#2563EB]" : "text-[#142B4A]"}`}
                    >
                      {metric.value}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <Text className="mb-3 mt-6 text-lg font-bold text-slate-900">
            Next steps
          </Text>
          {actions.map((action, index) => (
            <TouchableOpacity
              key={action.title}
              onPress={() => router.push(action.path as Href)}
              activeOpacity={0.8}
              className="mb-3 flex-row items-center rounded-2xl border border-slate-100 bg-white p-4"
            >
              <View
                className={`mr-3 h-10 w-10 items-center justify-center rounded-xl ${index === 0 ? "bg-blue-50" : "bg-amber-50"}`}
              >
                <Text className="font-bold text-[#2563EB]">
                  {index === 0 ? "01" : "02"}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="font-bold text-slate-900">{action.title}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {action.detail}
                </Text>
              </View>
              <Text className="text-lg text-slate-400">›</Text>
            </TouchableOpacity>
          ))}
          {data?.recent?.length ? (
            <>
              <Text className="mb-3 mt-4 text-lg font-bold text-slate-900">
                Recent updates
              </Text>
              {data.recent.map((notice, index) => (
                <View
                  key={`${notice.title ?? "notice"}-${index}`}
                  className="mb-2 rounded-xl bg-white p-4"
                >
                  <Text className="font-semibold text-slate-800">
                    {notice.title ?? "Class update"}
                  </Text>
                  <Text className="mt-1 text-sm text-slate-500">
                    {notice.body ?? "There is a new update for your classes."}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
          <View className="mt-3 rounded-2xl bg-[#EAF1FF] p-4">
            <Text className="text-sm font-bold text-[#142B4A]">
              Private until published
            </Text>
            <Text className="mt-1 text-xs leading-5 text-slate-600">
              Draft grades stay visible to faculty only. Students see grades
              after publication.
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
