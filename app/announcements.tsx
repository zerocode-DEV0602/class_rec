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
import { api } from "../services/api";
import { useAuthStore } from "../store/auth";
type Announcement = {
  _id: string;
  title: string;
  body: string;
  publishedAt?: string;
  authorId?: { name?: string };
};
type Offering = { _id: string; subjectId?: { code?: string; name?: string } };
const audienceOptions = ["all", "faculty", "student", "administrator"] as const;
export default function AnnouncementsScreen() {
  const client = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const canPublish =
    role === "super_admin" || role === "administrator" || role === "faculty";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<string[]>([
    role === "faculty" ? "student" : "all",
  ]);
  const [offeringId, setOfferingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const feed = useQuery<Announcement[]>({
    queryKey: ["announcements"],
    queryFn: async () =>
      (await api.get<{ items: Announcement[] }>("/api/announcements")).data
        .items,
  });
  const offerings = useQuery<Offering[]>({
    queryKey: ["class-offerings"],
    enabled: role === "faculty",
    queryFn: async () =>
      (await api.get<{ items: Offering[] }>("/api/class-offerings")).data.items,
  });
  const publish = async () => {
    if (
      title.trim().length < 3 ||
      body.trim().length < 2 ||
      !audience.length ||
      (role === "faculty" && !offeringId)
    ) {
      setError(
        "Enter a title and message, choose an audience and select a class for faculty announcements.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.post<{ notified: number }>(
        "/api/announcements",
        {
          title: title.trim(),
          body: body.trim(),
          audience: role === "faculty" ? ["student"] : audience,
          ...(role === "faculty" ? { offeringId } : {}),
        },
      );
      setTitle("");
      setBody("");
      setMessage(
        `Announcement published. ${result.data.notified} account(s) were notified.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["announcements"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Announcement could not be published.",
      );
    } finally {
      setBusy(false);
    }
  };
  const toggleAudience = (value: string) => {
    setAudience((current) =>
      value === "all"
        ? current.includes("all")
          ? []
          : ["all"]
        : current.filter((item) => item !== "all").includes(value)
          ? current.filter((item) => item !== value)
          : [...current.filter((item) => item !== "all"), value],
    );
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          CLASS UPDATES
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          Announcements
        </Text>
        {canPublish ? (
          <View className="mt-4 rounded-2xl bg-white p-4">
            <Text className="text-lg font-bold text-slate-900">
              Publish an announcement
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Announcement title"
              className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Message"
              multiline
              className="mt-2 min-h-24 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            {role === "faculty" ? (
              <>
                <Text className="mb-2 mt-3 text-xs font-semibold text-slate-600">
                  Target class (student audience only)
                </Text>
                {offerings.data?.map((item) => (
                  <TouchableOpacity
                    key={item._id}
                    onPress={() => setOfferingId(item._id)}
                    className={`mb-2 rounded-xl p-3 ${offeringId === item._id ? "bg-blue-50" : "bg-slate-50"}`}
                  >
                    <Text className="font-semibold text-slate-800">
                      {item.subjectId?.code ?? "Class"} ·{" "}
                      {item.subjectId?.name ?? "Subject"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              <>
                <Text className="mb-2 mt-3 text-xs font-semibold text-slate-600">
                  Audience
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {audienceOptions.map((value) => (
                    <TouchableOpacity
                      key={value}
                      onPress={() => toggleAudience(value)}
                      className={`rounded-full px-3 py-2 ${audience.includes(value) ? "bg-[#142B4A]" : "bg-slate-100"}`}
                    >
                      <Text
                        className={`text-xs font-semibold capitalize ${audience.includes(value) ? "text-white" : "text-slate-600"}`}
                      >
                        {value === "all" ? "Everyone" : value}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {error ? (
              <Text className="mt-3 text-sm text-rose-700">{error}</Text>
            ) : null}
            {message ? (
              <Text className="mt-3 text-sm text-emerald-700">{message}</Text>
            ) : null}
            <TouchableOpacity
              onPress={() => void publish()}
              disabled={busy}
              className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
            >
              <Text className="font-bold text-white">
                {busy ? "Publishing…" : "Publish announcement"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <Text className="mt-6 text-lg font-bold text-slate-900">
          Recent updates
        </Text>
        {feed.isLoading ? (
          <ActivityIndicator className="mt-4" color="#2563EB" />
        ) : feed.data?.length ? (
          feed.data.map((item) => (
            <View
              key={item._id}
              className="mt-3 rounded-2xl border border-slate-100 bg-white p-4"
            >
              <Text className="text-base font-bold text-slate-900">
                {item.title}
              </Text>
              <Text className="mt-2 text-sm leading-6 text-slate-600">
                {item.body}
              </Text>
              <Text className="mt-3 text-xs text-slate-400">
                {item.authorId?.name ?? "ClassTrack"}
                {item.publishedAt
                  ? ` · ${new Date(item.publishedAt).toLocaleDateString()}`
                  : ""}
              </Text>
            </View>
          ))
        ) : !feed.isError ? (
          <View className="mt-5 rounded-2xl bg-white p-5">
            <Text className="font-semibold text-slate-700">
              No announcements yet.
            </Text>
          </View>
        ) : null}
        {feed.isError ? (
          <Text className="mt-4 text-sm text-rose-700">
            Could not load your announcements.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
