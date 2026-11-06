import { useLocalSearchParams } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../services/api";
import {
  discardOfflineChange,
  listOfflineChanges,
  queueOfflineChange,
  synchronizeOfflineChanges,
} from "../../../services/offline";
import { useAuthStore } from "../../../store/auth";
type Category = {
  _id: string;
  name: string;
  weight: number;
  calculationMethod?: "points" | "equal_average";
};
type Assessment = {
  _id: string;
  title: string;
  maxScore: number;
  categoryId: string;
  published: boolean;
};
type RosterEntry = {
  _id: string;
  studentId?: { _id?: string; name?: string; studentNumber?: string };
};
type Score = {
  _id: string;
  assessmentId: string;
  studentId: string;
  score: number;
  remarks?: string;
  updatedAt?: string;
};
type Gradebook = {
  categories: Category[];
  assessments: Assessment[];
  roster: RosterEntry[];
  scores: Score[];
};
export default function GradebookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useAuthStore((state) => state.user?.role);
  const client = useQueryClient();
  const canEdit = role === "faculty";
  const [values, setValues] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState("final");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryWeight, setNewCategoryWeight] = useState("0");
  const [newCalculationMethod, setNewCalculationMethod] = useState<
    "points" | "equal_average"
  >("points");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const query = useQuery<Gradebook>({
    queryKey: ["gradebook", id],
    enabled: Boolean(id),
    queryFn: async () =>
      (await api.get<Gradebook>(`/api/class-offerings/${id}/gradebook`)).data,
  });
  const offlineQueue = useQuery({
    queryKey: ["offline-queue"],
    enabled: canEdit,
    queryFn: listOfflineChanges,
  });
  const book = query.data;
  const key = (assessmentId: string, studentId: string) =>
    `${assessmentId}:${studentId}`;
  const previous = (assessmentId: string, studentId: string) =>
    book?.scores.find(
      (item) =>
        String(item.assessmentId) === assessmentId &&
        String(item.studentId) === studentId,
    );
  const saveScore = async (assessment: Assessment, studentId: string) => {
    const rowKey = key(assessment._id, studentId);
    const value = Number(values[rowKey]);
    const old = previous(assessment._id, studentId);
    if (!Number.isFinite(value) || value < 0 || value > assessment.maxScore) {
      setMessage(`Score must be between 0 and ${assessment.maxScore}.`);
      return;
    }
    if (old && !reasons[rowKey]?.trim()) {
      setMessage("A reason is required for changes to saved scores.");
      return;
    }
    const payload = {
      assessmentId: assessment._id,
      studentId,
      score: value,
      reason: reasons[rowKey]?.trim() || undefined,
    };
    setBusy(rowKey);
    setMessage("");
    try {
      await api.post("/api/scores", payload);
      setMessage("Score saved to the official class record.");
      setReasons((state) => ({ ...state, [rowKey]: "" }));
      await client.invalidateQueries({ queryKey: ["gradebook", id] });
    } catch {
      try {
        await queueOfflineChange("score", payload, old?.updatedAt);
        setMessage(
          "Score draft saved offline. It is not an official grade until synced and validated by the server.",
        );
      } catch {
        setMessage("The score could not be saved or queued.");
      }
    } finally {
      setBusy("");
    }
  };
  const createCategory = async () => {
    const weight = Number(newCategoryWeight);
    if (
      newCategoryName.trim().length < 2 ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 100
    ) {
      setMessage("Enter a category name and a valid weight from 0–100%.");
      return;
    }
    setBusy("category");
    try {
      await api.post(`/api/class-offerings/${id}/grading-categories`, {
        name: newCategoryName.trim(),
        weight,
        calculationMethod: newCalculationMethod,
      });
      setNewCategoryName("");
      setNewCategoryWeight("0");
      setMessage("Grading category created and audited.");
      await client.invalidateQueries({ queryKey: ["gradebook", id] });
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Category could not be created.",
      );
    } finally {
      setBusy("");
    }
  };
  const saveWeights = async () => {
    if (!book?.categories.length) return;
    const total = book.categories.reduce(
      (sum, cat) => sum + Number(weights[cat._id] ?? cat.weight),
      0,
    );
    if (Math.abs(total - 100) > 0.001) {
      setMessage("Category weights must add up to exactly 100%.");
      return;
    }
    setBusy("weights");
    try {
      for (const category of book.categories)
        await api.put(`/api/grading-categories/${category._id}`, {
          weight: Number(weights[category._id] ?? category.weight),
        });
      await client.invalidateQueries({ queryKey: ["gradebook", id] });
      setMessage("Grading weights updated.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Weights could not be updated.",
      );
    } finally {
      setBusy("");
    }
  };
  const publish = async () => {
    setBusy("publish");
    setMessage("");
    try {
      const result = await api.post<{ published: number; incomplete: number }>(
        "/api/grades/publish",
        { offeringId: id, period },
      );
      setMessage(
        `${result.data.published} grades published · ${result.data.incomplete} incomplete under the institutional missing-score policy.`,
      );
      await client.invalidateQueries({ queryKey: ["gradebook", id] });
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Grades could not be published.",
      );
    } finally {
      setBusy("");
    }
  };
  const finalize = async () => {
    setBusy("finalize");
    try {
      const result = await api.post<{ finalized: number }>(
        "/api/grades/finalize",
        { offeringId: id, period },
      );
      setMessage(`${result.data.finalized} published grades finalized.`);
      await client.invalidateQueries({ queryKey: ["gradebook", id] });
    } catch {
      setMessage("Grades could not be finalized.");
    } finally {
      setBusy("");
    }
  };
  const sync = async () => {
    setBusy("sync");
    try {
      const result = await synchronizeOfflineChanges();
      setMessage(
        `${result.synced} drafts synced · ${result.conflicts} conflicts · ${result.rejected} rejected. Conflicts need review before retrying.`,
      );
      await client.invalidateQueries({ queryKey: ["gradebook", id] });
      await client.invalidateQueries({ queryKey: ["offline-queue"] });
    } catch {
      setMessage(
        "Sync requires a working network connection and valid sign-in.",
      );
    } finally {
      setBusy("");
    }
  };
  const discardDraft = async (draftId: string) => {
    try {
      await discardOfflineChange(draftId);
      await client.invalidateQueries({ queryKey: ["offline-queue"] });
      setMessage(
        "Draft removed. Review the current server record before re-entering the score or attendance change.",
      );
    } catch {
      setMessage("The offline draft could not be removed from this device.");
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          CLASS RECORD
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          Gradebook
        </Text>
        {canEdit && offlineQueue.data?.length ? (
          <View className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <Text className="font-bold text-amber-900">
              Offline drafts · {offlineQueue.data.length}
            </Text>
            <Text className="mt-1 text-xs leading-5 text-amber-800">
              Conflicts and server-rejected drafts are held for review and are
              not retried automatically. Compare with the current server record;
              discard a stale draft before entering a corrected value. Pending
              drafts remain unofficial until sync validation succeeds.
            </Text>
            {offlineQueue.data.map((draft) => (
              <View
                key={draft.id}
                className="mt-3 flex-row items-center justify-between rounded-xl bg-white p-3"
              >
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-semibold capitalize text-slate-800">
                    {draft.kind} draft · {draft.sync_status}
                  </Text>
                  <Text className="mt-1 text-[10px] text-slate-500">
                    Saved {new Date(draft.created_at).toLocaleString()}
                  </Text>
                  {draft.sync_status !== "pending" ? (
                    <Text className="mt-1 text-[10px] text-amber-800">
                      {draft.sync_status === "conflict"
                        ? "Server record changed since this draft was made."
                        : "Server validation rejected this draft."}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => void discardDraft(draft.id)}
                  className="rounded-lg bg-amber-100 px-3 py-2"
                >
                  <Text className="text-xs font-bold text-amber-900">
                    Discard
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
        {query.isLoading ? (
          <ActivityIndicator className="mt-6" color="#2563EB" />
        ) : query.isError || !book ? (
          <Text className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
            Gradebook could not be loaded for this class.
          </Text>
        ) : (
          <>
            <View className="mt-4 rounded-2xl bg-white p-4">
              <Text className="font-bold text-slate-900">
                Grading categories
              </Text>
              <Text className="mt-1 text-xs text-slate-500">
                Category weights must total 100%; official grades are computed
                on the server.
              </Text>
              {canEdit ? (
                <View className="mt-3 rounded-xl bg-slate-50 p-3">
                  <Text className="text-xs font-bold text-slate-700">
                    Add grading category
                  </Text>
                  <TextInput
                    value={newCategoryName}
                    onChangeText={setNewCategoryName}
                    placeholder="Category name"
                    className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  />
                  <View className="mt-2 flex-row items-center gap-2">
                    <TextInput
                      value={newCategoryWeight}
                      onChangeText={setNewCategoryWeight}
                      keyboardType="decimal-pad"
                      placeholder="Weight %"
                      className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                    />
                    <TouchableOpacity
                      onPress={() => setNewCalculationMethod("points")}
                      className={`rounded-full px-3 py-2 ${newCalculationMethod === "points" ? "bg-[#142B4A]" : "bg-white"}`}
                    >
                      <Text
                        className={`text-xs font-semibold ${newCalculationMethod === "points" ? "text-white" : "text-slate-600"}`}
                      >
                        Points
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setNewCalculationMethod("equal_average")}
                      className={`rounded-full px-3 py-2 ${newCalculationMethod === "equal_average" ? "bg-[#142B4A]" : "bg-white"}`}
                    >
                      <Text
                        className={`text-xs font-semibold ${newCalculationMethod === "equal_average" ? "text-white" : "text-slate-600"}`}
                      >
                        Equal average
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => void createCategory()}
                    disabled={busy === "category"}
                    className="mt-2 self-start rounded-lg bg-blue-50 px-4 py-2"
                  >
                    <Text className="text-xs font-bold text-[#2563EB]">
                      {busy === "category" ? "Saving…" : "Add category"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {book.categories.map((category) => (
                <View
                  key={category._id}
                  className="mt-3 flex-row items-center justify-between"
                >
                  <View className="flex-1">
                    <Text className="text-sm text-slate-700">
                      {category.name}
                    </Text>
                    <Text className="mt-0.5 text-[10px] capitalize text-slate-400">
                      {category.calculationMethod === "equal_average"
                        ? "Equal assessment average"
                        : "Points-based average"}
                    </Text>
                  </View>
                  {canEdit ? (
                    <TextInput
                      value={weights[category._id] ?? String(category.weight)}
                      onChangeText={(text) =>
                        setWeights((state) => ({
                          ...state,
                          [category._id]: text,
                        }))
                      }
                      keyboardType="decimal-pad"
                      className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                    />
                  ) : (
                    <Text className="font-bold text-[#142B4A]">
                      {category.weight}%
                    </Text>
                  )}
                </View>
              ))}
              {canEdit ? (
                <TouchableOpacity
                  onPress={() => void saveWeights()}
                  disabled={busy === "weights"}
                  className="mt-3 items-center rounded-lg bg-slate-100 py-2.5"
                >
                  <Text className="text-sm font-bold text-[#142B4A]">
                    {busy === "weights" ? "Saving…" : "Save category weights"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {book.roster.map((entry) => {
              const studentId = entry.studentId?._id ?? "";
              return (
                <View key={entry._id} className="mt-4 rounded-2xl bg-white p-4">
                  <Text className="text-base font-bold text-[#142B4A]">
                    {entry.studentId?.name ?? "Student"}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    {entry.studentId?.studentNumber ?? "Approved roster"}
                  </Text>
                  {book.assessments.map((assessment) => {
                    const rowKey = key(assessment._id, studentId);
                    const old = previous(assessment._id, studentId);
                    return (
                      <View
                        key={assessment._id}
                        className="mt-3 border-t border-slate-100 pt-3"
                      >
                        <View className="flex-row items-center justify-between">
                          <Text className="flex-1 font-semibold text-slate-800">
                            {assessment.title}
                          </Text>
                          <Text className="text-xs text-slate-500">
                            /{assessment.maxScore}
                          </Text>
                        </View>
                        <View className="mt-2 flex-row gap-2">
                          <TextInput
                            value={
                              values[rowKey] ?? (old ? String(old.score) : "")
                            }
                            onChangeText={(text) =>
                              setValues((state) => ({
                                ...state,
                                [rowKey]: text,
                              }))
                            }
                            editable={canEdit}
                            keyboardType="decimal-pad"
                            placeholder="Score"
                            className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                          />
                          {canEdit ? (
                            <TouchableOpacity
                              onPress={() =>
                                void saveScore(assessment, studentId)
                              }
                              disabled={busy === rowKey}
                              className="rounded-lg bg-[#2563EB] px-4 py-2.5"
                            >
                              <Text className="text-xs font-bold text-white">
                                {busy === rowKey ? "…" : "Save"}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                        {canEdit && old ? (
                          <TextInput
                            value={reasons[rowKey] ?? ""}
                            onChangeText={(text) =>
                              setReasons((state) => ({
                                ...state,
                                [rowKey]: text,
                              }))
                            }
                            placeholder="Reason for score edit"
                            className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                          />
                        ) : null}
                      </View>
                    );
                  })}
                  {!book.assessments.length ? (
                    <Text className="mt-3 text-sm text-slate-500">
                      No assessments are configured yet.
                    </Text>
                  ) : null}
                </View>
              );
            })}
            {canEdit ? (
              <View className="mt-4 rounded-2xl bg-[#142B4A] p-4">
                <Text className="font-bold text-white">Grade publication</Text>
                <TextInput
                  value={period}
                  onChangeText={setPeriod}
                  placeholder="Period (e.g. midterm or final)"
                  className="mt-3 rounded-lg bg-white px-3 py-3 text-sm"
                />
                <TouchableOpacity
                  onPress={() => void publish()}
                  disabled={busy === "publish" || !period.trim()}
                  className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
                >
                  <Text className="font-bold text-white">
                    {busy === "publish"
                      ? "Publishing…"
                      : "Calculate & publish grades"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void finalize()}
                  disabled={busy === "finalize"}
                  className="mt-2 items-center rounded-xl border border-white/30 py-3"
                >
                  <Text className="font-bold text-white">
                    {busy === "finalize"
                      ? "Finalizing…"
                      : "Finalize published grades"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void sync()}
                  disabled={busy === "sync"}
                  className="mt-2 items-center rounded-xl bg-white py-3"
                >
                  <Text className="font-bold text-[#142B4A]">
                    {busy === "sync" ? "Syncing…" : "Sync offline drafts"}
                  </Text>
                </TouchableOpacity>
                <Text className="mt-2 text-xs text-blue-100">
                  Unpublished grades remain private. Drafts must sync online
                  before official computation/publication.
                </Text>
              </View>
            ) : null}
          </>
        )}
        {message ? (
          <Text className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            {message}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
