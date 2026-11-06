import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../services/api";
import { useAuthStore } from "../../../store/auth";

type Activity = {
  _id: string;
  title: string;
  description?: string;
  kind: string;
  maxScore: number;
  dueAt?: string;
  published: boolean;
  allowSubmission: boolean;
  referenceFile?: { key: string; name: string; mimeType: string; size: number };
};
type Category = { _id: string; name: string };
type Submission = {
  _id: string;
  assessmentId: string;
  studentId?: { name?: string; studentNumber?: string };
  file?: { key: string; name: string; mimeType: string; size: number };
  score?: number;
  feedback?: string;
  status: string;
};

export default function ActivitiesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const faculty = user?.role === "faculty";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<Activity["kind"]>("assignment");
  const [categoryId, setCategoryId] = useState("");
  const [referenceFile, setReferenceFile] =
    useState<Activity["referenceFile"]>();
  const [openActivity, setOpenActivity] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [score, setScore] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const activitiesQuery = useQuery<Activity[]>({
    queryKey: ["activities", id],
    enabled: Boolean(id),
    queryFn: async () =>
      (
        await api.get<{ items: Activity[] }>("/api/activities", {
          params: { offeringId: id },
        })
      ).data.items,
  });
  const gradebook = useQuery<{ categories: Category[] }>({
    queryKey: ["gradebook", id],
    enabled: faculty && Boolean(id),
    queryFn: async () =>
      (
        await api.get<{ categories: Category[] }>(
          `/api/class-offerings/${id}/gradebook`,
        )
      ).data,
  });
  const submissionsQuery = useQuery<Submission[]>({
    queryKey: ["submissions", openActivity],
    enabled: faculty && Boolean(openActivity),
    queryFn: async () =>
      (
        await api.get<{ items: Submission[] }>("/api/submissions", {
          params: { assessmentId: openActivity },
        })
      ).data.items,
  });
  const studentSubmissions = useQuery<Submission[]>({
    queryKey: ["student-submissions", id],
    enabled: user?.role === "student" && Boolean(id),
    queryFn: async () =>
      (
        await api.get<{ items: Submission[] }>("/api/submissions", {
          params: { offeringId: id },
        })
      ).data.items,
  });
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["activities", id] }),
      client.invalidateQueries({ queryKey: ["submissions"] }),
      client.invalidateQueries({ queryKey: ["student-submissions", id] }),
    ]);
  };
  const createActivity = async () => {
    const chosenCategoryId = categoryId || gradebook.data?.categories[0]?._id;
    if (
      !title.trim() ||
      !chosenCategoryId ||
      !Number.isFinite(Number(maxScore)) ||
      Number(maxScore) <= 0
    ) {
      setError(
        "Enter an activity title, valid maximum score and make sure this class has a grading category.",
      );
      return;
    }
    setBusy("create");
    setError("");
    try {
      const item = (
        await api.post<{ item: Activity }>("/api/assessments", {
          offeringId: id,
          categoryId: chosenCategoryId,
          title: title.trim(),
          description: description.trim(),
          kind,
          maxScore: Number(maxScore),
          dueAt: dueDate ? new Date(dueDate).toISOString() : undefined,
          allowSubmission: true,
          referenceFile,
        })
      ).data.item;
      await api.post(`/api/assessments/${item._id}/publish`);
      setTitle("");
      setDescription("");
      setDueDate("");
      setKind("assignment");
      setReferenceFile(undefined);
      await invalidate();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The activity could not be created.",
      );
    } finally {
      setBusy("");
    }
  };
  const pickReferenceFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const file = picked.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) {
      Alert.alert(
        "File too large",
        "Reference files must be 10 MB or smaller.",
      );
      return;
    }
    setBusy("reference");
    setError("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      const uploaded = (
        await api.post<{ file: Activity["referenceFile"] }>(
          "/api/uploads",
          form,
          { headers: { "Content-Type": "multipart/form-data" } },
        )
      ).data.file;
      if (!uploaded)
        throw new Error("The reference upload response was incomplete.");
      setReferenceFile(uploaded);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The reference file could not be uploaded.",
      );
    } finally {
      setBusy("");
    }
  };
  const downloadReference = async (activity: Activity) => {
    if (!activity.referenceFile) return;
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      setError("Your session expired. Sign in again to download this file.");
      return;
    }
    const url = api.getUri({
      url: `/api/uploads/${activity.referenceFile.key}`,
    });
    try {
      if (Platform.OS === "web") {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
          throw new Error(`Download failed (${response.status}).`);
        const objectUrl = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = activity.referenceFile.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } else {
        const root = FileSystem.cacheDirectory;
        if (!root) throw new Error("Temporary file storage is unavailable.");
        const result = await FileSystem.downloadAsync(
          url,
          `${root}${activity.referenceFile.name}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (result.status < 200 || result.status >= 300)
          throw new Error(`Download failed (${result.status}).`);
        if (await Sharing.isAvailableAsync())
          await Sharing.shareAsync(result.uri, {
            mimeType: activity.referenceFile.mimeType,
            dialogTitle: "Open activity reference",
          });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The reference file could not be downloaded.",
      );
    }
  };
  const submitActivity = async (activity: Activity) => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const file = picked.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) {
      Alert.alert("File too large", "Files must be 10 MB or smaller.");
      return;
    }
    setBusy(activity._id);
    setError("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      const uploaded = (
        await api.post<{ file: Submission["file"] }>("/api/uploads", form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
      ).data.file;
      if (!uploaded) throw new Error("The upload response was incomplete.");
      await api.post("/api/submissions", {
        assessmentId: activity._id,
        file: uploaded,
      });
      await invalidate();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The file could not be submitted.",
      );
    } finally {
      setBusy("");
    }
  };
  const gradeSubmission = async (
    submission: Submission,
    activity: Activity,
  ) => {
    const value = Number(score[submission._id]);
    if (!Number.isFinite(value) || value < 0 || value > activity.maxScore) {
      setError(`Enter a score between 0 and ${activity.maxScore}.`);
      return;
    }
    setBusy(submission._id);
    setError("");
    try {
      await api.patch(`/api/submissions/${submission._id}/grade`, {
        score: value,
        feedback: feedback[submission._id] ?? "",
      });
      await invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feedback could not be saved.");
    } finally {
      setBusy("");
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          CLASS WORK
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          Activities
        </Text>
        <Text className="mt-1 text-sm text-slate-500">
          Assignments, instructions, deadlines, submissions and feedback.
        </Text>
        {faculty ? (
          <View className="mt-5 rounded-2xl bg-white p-4">
            <Text className="font-bold text-slate-900">
              Create class activity
            </Text>
            <Text className="mt-3 text-xs font-semibold text-slate-500">
              Activity type
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {(
                [
                  ["assignment", "Assignment"],
                  ["quiz", "Quiz"],
                  ["exam", "Examination"],
                  ["performance_task", "Performance task"],
                ] as const
              ).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setKind(value)}
                  className={`rounded-full px-3 py-2 ${kind === value ? "bg-blue-100" : "bg-slate-100"}`}
                >
                  <Text
                    className={`text-xs font-semibold ${kind === value ? "text-blue-800" : "text-slate-600"}`}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="mt-3 text-xs font-semibold text-slate-500">
              Grading category
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {gradebook.data?.categories.map((category) => (
                <TouchableOpacity
                  key={category._id}
                  onPress={() => setCategoryId(category._id)}
                  className={`rounded-full px-3 py-2 ${(categoryId || gradebook.data?.categories[0]?._id) === category._id ? "bg-blue-100" : "bg-slate-100"}`}
                >
                  <Text
                    className={`text-xs font-semibold ${(categoryId || gradebook.data?.categories[0]?._id) === category._id ? "text-blue-800" : "text-slate-600"}`}
                  >
                    {category.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Instructions"
              multiline
              className="mt-2 min-h-20 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <View className="mt-2 flex-row gap-2">
              <TextInput
                value={maxScore}
                onChangeText={setMaxScore}
                keyboardType="decimal-pad"
                placeholder="Max score"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
              <TextInput
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="Deadline (YYYY-MM-DD)"
                className="flex-[2] rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
            </View>
            <TouchableOpacity
              onPress={() => void pickReferenceFile()}
              disabled={busy === "reference"}
              className="mt-3 rounded-xl bg-slate-50 p-3"
            >
              <Text className="text-sm font-semibold text-[#2563EB]">
                {busy === "reference"
                  ? "Uploading reference…"
                  : referenceFile
                    ? `Reference: ${referenceFile.name} · Tap to replace`
                    : "Attach reference file (optional)"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void createActivity()}
              disabled={busy === "create"}
              className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
            >
              <Text className="font-bold text-white">
                {busy === "create" ? "Publishing…" : "Create and publish"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {error ? (
          <Text className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </Text>
        ) : null}
        {activitiesQuery.isLoading ? (
          <View className="mt-5 items-center">
            <ActivityIndicator color="#2563EB" />
            <Text className="mt-2 text-sm text-slate-500">
              Loading activities…
            </Text>
          </View>
        ) : activitiesQuery.isError ? (
          <Text className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
            Activities could not be loaded.
          </Text>
        ) : activitiesQuery.data?.length ? (
          activitiesQuery.data.map((activity) => (
            <View
              key={activity._id}
              className="mt-3 rounded-2xl border border-slate-100 bg-white p-4"
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-base font-bold text-slate-900">
                    {activity.title}
                  </Text>
                  <Text className="mt-1 text-xs capitalize text-[#2563EB]">
                    {activity.kind} · Max {activity.maxScore}
                  </Text>
                </View>
                <Text className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#2563EB]">
                  {activity.published ? "Published" : "Draft"}
                </Text>
              </View>
              {activity.description ? (
                <Text className="mt-3 text-sm leading-5 text-slate-600">
                  {activity.description}
                </Text>
              ) : null}
              {activity.referenceFile ? (
                <TouchableOpacity
                  onPress={() => void downloadReference(activity)}
                  className="mt-3 self-start rounded-xl bg-blue-50 px-3 py-2"
                >
                  <Text className="text-xs font-semibold text-blue-800">
                    Download reference · {activity.referenceFile.name}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <Text className="mt-3 text-xs text-slate-500">
                Due{" "}
                {activity.dueAt
                  ? new Date(activity.dueAt).toLocaleString()
                  : "No deadline"}
              </Text>
              {user?.role === "student"
                ? (() => {
                    const submitted = studentSubmissions.data?.find(
                      (item) => item.assessmentId === activity._id,
                    );
                    return submitted ? (
                      <View className="mt-3 rounded-xl bg-blue-50 p-3">
                        <Text className="text-xs font-bold capitalize text-blue-800">
                          Submission {submitted.status.replaceAll("_", " ")}
                        </Text>
                        <Text className="mt-1 text-xs text-slate-600">
                          {submitted.file?.name ?? "File submitted"}
                          {submitted.score !== undefined
                            ? ` · Score ${submitted.score}/${activity.maxScore}`
                            : " · Awaiting faculty review"}
                        </Text>
                        {submitted.feedback ? (
                          <Text className="mt-2 text-xs leading-5 text-slate-700">
                            {submitted.feedback}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <Text className="mt-2 text-xs text-amber-700">
                        No submission recorded yet.
                      </Text>
                    );
                  })()
                : null}
              {user?.role === "student" ? (
                <TouchableOpacity
                  onPress={() => void submitActivity(activity)}
                  disabled={busy === activity._id || !activity.allowSubmission}
                  className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
                >
                  <Text className="font-bold text-white">
                    {busy === activity._id
                      ? "Uploading…"
                      : "Choose file and submit"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {faculty ? (
                <TouchableOpacity
                  onPress={() =>
                    setOpenActivity(
                      openActivity === activity._id ? "" : activity._id,
                    )
                  }
                  className="mt-3 rounded-xl bg-slate-50 py-3"
                >
                  <Text className="text-center text-sm font-bold text-[#142B4A]">
                    {openActivity === activity._id
                      ? "Hide submissions"
                      : "Review submissions"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {faculty && openActivity === activity._id ? (
                submissionsQuery.isLoading ? (
                  <ActivityIndicator className="mt-3" color="#2563EB" />
                ) : submissionsQuery.data?.length ? (
                  submissionsQuery.data.map((submission) => (
                    <View
                      key={submission._id}
                      className="mt-3 border-t border-slate-100 pt-3"
                    >
                      <Text className="font-semibold text-slate-800">
                        {submission.studentId?.name ?? "Student"}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-500">
                        {submission.file?.name ?? "No attachment"} ·{" "}
                        {submission.status}
                      </Text>
                      <TextInput
                        value={
                          score[submission._id] ??
                          (submission.score === undefined
                            ? ""
                            : String(submission.score))
                        }
                        onChangeText={(text) =>
                          setScore((old) => ({
                            ...old,
                            [submission._id]: text,
                          }))
                        }
                        keyboardType="decimal-pad"
                        placeholder={`Score / ${activity.maxScore}`}
                        className="mt-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      />
                      <TextInput
                        value={
                          feedback[submission._id] ?? submission.feedback ?? ""
                        }
                        onChangeText={(text) =>
                          setFeedback((old) => ({
                            ...old,
                            [submission._id]: text,
                          }))
                        }
                        placeholder="Feedback for student"
                        multiline
                        className="mt-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      />
                      <TouchableOpacity
                        onPress={() =>
                          void gradeSubmission(submission, activity)
                        }
                        className="mt-2 self-start rounded-lg bg-emerald-600 px-4 py-2"
                      >
                        <Text className="text-xs font-bold text-white">
                          Save score & feedback
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))
                ) : (
                  <Text className="mt-3 text-xs text-slate-500">
                    No submissions yet.
                  </Text>
                )
              ) : null}
            </View>
          ))
        ) : (
          <View className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-5">
            <Text className="font-bold text-[#142B4A]">No activities yet</Text>
            <Text className="mt-1 text-sm text-slate-500">
              Activities for this class will appear here when published.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
