import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth";

type Offering = { _id: string; subjectId?: { code?: string; name?: string } };
type RosterEntry = {
  studentId?: { _id?: string; name?: string; studentNumber?: string };
};
type Intervention = {
  _id: string;
  note: string;
  recommendation?: string;
  needsAssistance?: boolean;
  followUpAt?: string;
  studentId?: string | { _id?: string; name?: string; studentNumber?: string };
  offeringId?:
    | string
    | { _id?: string; subjectId?: { name?: string; code?: string } };
};
export default function InterventionsScreen() {
  const params = useLocalSearchParams<{ offeringId?: string }>();
  const role = useAuthStore((state) => state.user?.role);
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const faculty = role === "faculty";
  const [offeringId, setOfferingId] = useState(params.offeringId ?? "");
  const [studentId, setStudentId] = useState("");
  const [note, setNote] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const offerings = useQuery<Offering[]>({
    queryKey: ["class-offerings"],
    enabled: faculty,
    queryFn: async () =>
      (
        await api.get<{ items: Offering[] }>("/api/class-offerings", {
          params: { limit: 100 },
        })
      ).data.items,
  });
  const selected = offeringId || offerings.data?.[0]?._id || "";
  const gradebook = useQuery<{ roster: RosterEntry[] }>({
    queryKey: ["gradebook", selected],
    enabled: faculty && Boolean(selected),
    queryFn: async () =>
      (
        await api.get<{ roster: RosterEntry[] }>(
          `/api/class-offerings/${selected}/gradebook`,
        )
      ).data,
  });
  const items = useQuery<Intervention[]>({
    queryKey: ["interventions", user?.id],
    queryFn: async () =>
      (await api.get<{ items: Intervention[] }>("/api/interventions")).data
        .items,
  });
  const create = async () => {
    if (!selected || !studentId || note.trim().length < 3) {
      setNotice(
        "Choose a student and enter a support note of at least 3 characters.",
      );
      return;
    }
    setBusy("create");
    setNotice("");
    try {
      await api.post("/api/interventions", {
        offeringId: selected,
        studentId,
        note: note.trim(),
        recommendation: recommendation.trim() || undefined,
        followUpAt: followUp ? new Date(followUp).toISOString() : undefined,
      });
      setNote("");
      setRecommendation("");
      setFollowUp("");
      setNotice("Support plan saved and student notified.");
      await client.invalidateQueries({ queryKey: ["interventions"] });
    } catch (e) {
      setNotice(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Could not save the support plan.",
      );
    } finally {
      setBusy("");
    }
  };
  const toggleAssistance = async (item: Intervention) => {
    setBusy(item._id);
    setNotice("");
    try {
      await api.patch(`/api/interventions/${item._id}`, {
        needsAssistance: !item.needsAssistance,
      });
      await client.invalidateQueries({ queryKey: ["interventions"] });
    } catch {
      setNotice("Support status could not be updated.");
    } finally {
      setBusy("");
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          STUDENT SUPPORT
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          Interventions
        </Text>
        <Text className="mt-2 text-sm leading-5 text-slate-500">
          Track academic support, recommendations and follow-up while keeping
          each record scoped to the student and class.
        </Text>
        {faculty ? (
          <View className="mt-4 rounded-2xl bg-white p-4">
            <Text className="font-bold text-slate-900">
              Create a support plan
            </Text>
            <Text className="mt-1 text-xs text-slate-500">
              Choose an assigned class and an approved roster student.
            </Text>
            {offerings.data?.map((offering) => (
              <TouchableOpacity
                key={offering._id}
                onPress={() => {
                  setOfferingId(offering._id);
                  setStudentId("");
                }}
                className={`mt-2 rounded-xl p-3 ${selected === offering._id ? "bg-blue-50" : "bg-slate-50"}`}
              >
                <Text className="text-sm font-semibold text-[#142B4A]">
                  {offering.subjectId?.code} ·{" "}
                  {offering.subjectId?.name ?? "Class"}
                  {selected === offering._id ? " · Selected" : ""}
                </Text>
              </TouchableOpacity>
            ))}
            {gradebook.data?.roster?.map((row) => {
              const person = row.studentId;
              const id = person?._id ?? "";
              return (
                <TouchableOpacity
                  key={id}
                  onPress={() => setStudentId(id)}
                  className={`mt-2 rounded-xl border p-3 ${studentId === id ? "border-blue-300 bg-blue-50" : "border-slate-100"}`}
                >
                  <Text className="text-sm font-medium text-slate-800">
                    {person?.name ?? "Student"} ·{" "}
                    {person?.studentNumber ?? "No student number"}
                    {studentId === id ? " · Selected" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Faculty note and observed concern"
              multiline
              className="mt-3 min-h-20 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={recommendation}
              onChangeText={setRecommendation}
              placeholder="Recommendation or next steps"
              multiline
              className="mt-2 min-h-16 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={followUp}
              onChangeText={setFollowUp}
              placeholder="Optional follow-up date (YYYY-MM-DD)"
              className="mt-2 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TouchableOpacity
              onPress={() => void create()}
              disabled={busy === "create"}
              className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
            >
              <Text className="font-bold text-white">
                {busy === "create" ? "Saving…" : "Save support plan & notify"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {items.isLoading ? (
          <ActivityIndicator className="mt-5" color="#2563EB" />
        ) : items.isError ? (
          <Text className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
            Support records could not be loaded.
          </Text>
        ) : items.data?.length ? (
          items.data.map((item) => {
            const student =
              typeof item.studentId === "object" ? item.studentId : undefined;
            const offering =
              typeof item.offeringId === "object" ? item.offeringId : undefined;
            return (
              <View
                key={item._id}
                className="mt-3 rounded-2xl border border-slate-100 bg-white p-4"
              >
                <Text className="font-bold text-slate-900">
                  {role === "student"
                    ? "Faculty support plan"
                    : (student?.name ?? "Student support")}
                </Text>
                <Text className="mt-1 text-xs text-[#2563EB]">
                  {offering?.subjectId?.code ?? "Class"} ·{" "}
                  {offering?.subjectId?.name ?? "Academic support"}
                </Text>
                <Text className="mt-3 text-sm leading-5 text-slate-700">
                  {item.note}
                </Text>
                {item.recommendation ? (
                  <Text className="mt-2 text-sm leading-5 text-slate-600">
                    Next steps: {item.recommendation}
                  </Text>
                ) : null}
                <Text className="mt-2 text-xs text-slate-500">
                  {item.followUpAt
                    ? `Follow-up ${new Date(item.followUpAt).toLocaleDateString()}`
                    : "No follow-up date set"}
                </Text>
                <Text
                  className={`mt-2 text-xs font-bold ${item.needsAssistance === false ? "text-emerald-700" : "text-amber-700"}`}
                >
                  {item.needsAssistance === false
                    ? "Support follow-up complete"
                    : "Assistance in progress"}
                </Text>
                {faculty ? (
                  <TouchableOpacity
                    onPress={() => void toggleAssistance(item)}
                    disabled={busy === item._id}
                    className="mt-3 self-start rounded-xl bg-slate-100 px-3 py-2"
                  >
                    <Text className="text-xs font-semibold text-[#142B4A]">
                      {item.needsAssistance === false
                        ? "Reopen follow-up"
                        : "Mark follow-up complete"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })
        ) : (
          <View className="mt-4 rounded-xl bg-white p-4">
            <Text className="text-sm text-slate-500">
              No support plans are recorded for your account.
            </Text>
          </View>
        )}
        {notice ? (
          <Text className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            {notice}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
