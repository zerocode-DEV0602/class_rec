import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { api } from "../../services/api";
import { cacheRecords, readCachedRecords } from "../../services/offline";
import { useAuthStore } from "../../store/auth";

type Offering = {
  _id?: string;
  id?: string;
  subjectId?: { code?: string; name?: string } | string;
  facultyId?: { name?: string } | string;
  sectionId?: { name?: string } | string;
  academicYearId?: { label?: string } | string;
  semesterId?: { name?: string } | string;
  schedule?: { day?: string; startsAt?: string; endsAt?: string }[];
  location?: string;
  updatedAt?: string;
};
export default function SubjectsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Offering[]>({
    queryKey: ["class-offerings", user?.id],
    queryFn: async () => {
      try {
        const response = await api.get<{ items: Offering[] }>(
          "/api/class-offerings",
        );
        const items = response.data.items ?? [];
        await cacheRecords(
          "class-offerings",
          items.map((item) => ({
            ...item,
            id: item._id ?? item.id ?? "",
            updatedAt: item.updatedAt,
          })),
        );
        return items;
      } catch {
        return readCachedRecords<Offering>("class-offerings");
      }
    },
  });
  const label = (
    value:
      | { name?: string; code?: string; label?: string }
      | string
      | undefined,
  ) =>
    typeof value === "string"
      ? value
      : (value?.name ?? value?.label ?? value?.code ?? "—");
  return (
    <ScrollView
      className="flex-1 bg-[#F8FAFC]"
      contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
    >
      <View className="mb-5 flex-row items-end justify-between">
        <View>
          <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
            ACADEMIC
          </Text>
          <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
            {user?.role === "student" ? "My subjects" : "My classes"}
          </Text>
        </View>
        {user?.role === "student" ? (
          <TouchableOpacity
            onPress={() => router.push("/enroll" as Href)}
            className="rounded-xl bg-[#2563EB] px-4 py-3"
          >
            <Text className="text-sm font-bold text-white">+ Enroll</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {isLoading
        ? [1, 2, 3].map((n) => (
            <View key={n} className="mb-3 h-28 rounded-2xl bg-slate-200" />
          ))
        : null}
      {isError && data.length === 0 ? (
        <View className="rounded-2xl bg-rose-50 p-4">
          <Text className="font-semibold text-rose-700">
            Subjects couldn’t be loaded.
          </Text>
          <TouchableOpacity onPress={() => void refetch()} className="mt-2">
            <Text className="font-semibold text-[#2563EB]">Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {!isLoading && data.length === 0 && !isError ? (
        <View className="items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10">
          <Text className="text-lg font-bold text-[#142B4A]">
            No subjects yet
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
            {user?.role === "student"
              ? "Use the enrollment code shared by your faculty member to request a place."
              : "Your assigned classes will appear here when they’re set up."}
          </Text>
        </View>
      ) : null}
      {data.map((offering) => {
        const id = offering._id ?? offering.id;
        return (
          <TouchableOpacity
            key={id}
            onPress={() => id && router.push(`/class/${id}` as Href)}
            activeOpacity={0.85}
            className="mb-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          >
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xs font-bold uppercase tracking-wide text-[#2563EB]">
                  {label(offering.subjectId) === "—"
                    ? "CLASS OFFERING"
                    : label(offering.subjectId)}
                </Text>
                <Text className="mt-1 text-lg font-bold text-slate-900">
                  {typeof offering.subjectId === "object"
                    ? (offering.subjectId.name ?? "Subject")
                    : "Subject details"}
                </Text>
              </View>
              <Text className="text-lg text-slate-400">›</Text>
            </View>
            <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-2">
              <Text className="text-xs text-slate-500">
                Faculty · {label(offering.facultyId)}
              </Text>
              <Text className="text-xs text-slate-500">
                Section · {label(offering.sectionId)}
              </Text>
              <Text className="text-xs text-slate-500">
                {label(offering.academicYearId)} · {label(offering.semesterId)}
              </Text>
            </View>
            {offering.schedule?.length ? (
              <Text className="mt-3 text-xs font-medium text-slate-600">
                {offering.schedule
                  .map(
                    (slot) =>
                      `${slot.day ?? "Class"} ${slot.startsAt ?? ""}–${slot.endsAt ?? ""}`,
                  )
                  .join(" · ")}
              </Text>
            ) : null}
            {offering.location ? (
              <Text className="mt-1 text-xs text-slate-500">
                {offering.location}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
