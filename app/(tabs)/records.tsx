import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../../services/api";
import { useAuthStore } from "../../store/auth";
type Offering = {
  _id: string;
  subjectId?: { code?: string; name?: string };
  sectionId?: { name?: string };
  enrollmentCode?: string;
  enrollmentEnabled?: boolean;
  approvedCount?: number;
  capacity?: number;
};
type CatalogItem = {
  _id: string;
  name?: string;
  code?: string;
  label?: string;
  current?: boolean;
  academicYearId?: string;
};
type Request = {
  _id: string;
  studentId?: { name?: string; studentNumber?: string };
  offeringId?: { subjectId?: { code?: string; name?: string } };
};
type Review = {
  _id: string;
  studentId?: { name?: string; studentNumber?: string };
  offeringId?: { subjectId?: { code?: string; name?: string } };
  recordType: "grade" | "attendance";
  reason: string;
  status: string;
  response?: string;
};
export default function RecordsScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const [creating, setCreating] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [yearId, setYearId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [day, setDay] = useState("Monday");
  const [startsAt, setStartsAt] = useState("08:00");
  const [endsAt, setEndsAt] = useState("09:00");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("40");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reviewResponse, setReviewResponse] = useState<Record<string, string>>(
    {},
  );
  const [busy, setBusy] = useState("");
  const offerings = useQuery<Offering[]>({
    queryKey: ["class-offerings"],
    queryFn: async () =>
      (await api.get<{ items: Offering[] }>("/api/class-offerings")).data.items,
  });
  const requests = useQuery<Request[]>({
    queryKey: ["enrollments", "pending"],
    enabled: role === "faculty",
    queryFn: async () =>
      (await api.get<{ items: Request[] }>("/api/enrollments/pending")).data
        .items,
  });
  const reviews = useQuery<Review[]>({
    queryKey: ["review-requests"],
    enabled: role === "faculty",
    queryFn: async () =>
      (
        await api.get<{ items: Review[] }>("/api/review-requests")
      ).data.items.filter((item) =>
        ["pending", "under_review"].includes(item.status),
      ),
  });
  const catalogs = useQuery<{
    subjects: CatalogItem[];
    sections: CatalogItem[];
    years: CatalogItem[];
    semesters: CatalogItem[];
  }>({
    queryKey: ["offering-catalog"],
    enabled: creating,
    queryFn: async () => {
      const [subjects, sections, years, semesters] = await Promise.all(
        ["subjects", "sections", "academic-years", "semesters"].map(
          (resource) =>
            api.get<{ items: CatalogItem[] }>(`/api/${resource}`, {
              params: { limit: 100 },
            }),
        ),
      );
      return {
        subjects: subjects.data.items,
        sections: sections.data.items,
        years: years.data.items,
        semesters: semesters.data.items,
      };
    },
  });
  const decide = async (id: string, action: "approve" | "reject") => {
    setError("");
    try {
      await api.patch(`/api/enrollments/${id}/${action}`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["enrollments", "pending"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
        client.invalidateQueries({ queryKey: ["class-offerings"] }),
      ]);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Enrollment decision could not be saved.",
      );
    }
  };
  const createOffering = async () => {
    if (
      !subjectId ||
      !sectionId ||
      !yearId ||
      !semesterId ||
      !day.trim() ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endsAt) ||
      startsAt >= endsAt ||
      !Number.isInteger(Number(capacity)) ||
      Number(capacity) < 1
    ) {
      setError(
        "Choose the subject, section, year and semester, then enter a valid schedule and capacity.",
      );
      return;
    }
    setBusy("create");
    setError("");
    setMessage("");
    try {
      const result = await api.post<{ item: Offering }>(
        "/api/class-offerings",
        {
          subjectId,
          sectionId,
          academicYearId: yearId,
          semesterId,
          schedule: [{ day: day.trim(), startsAt, endsAt }],
          location: location.trim() || undefined,
          capacity: Number(capacity),
        },
      );
      setMessage(
        `Offering created. Enrollment code: ${result.data.item.enrollmentCode ?? "Open class details to view it."}`,
      );
      setCreating(false);
      setSubjectId("");
      setSectionId("");
      setYearId("");
      setSemesterId("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["class-offerings"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "The class offering could not be created.",
      );
    } finally {
      setBusy("");
    }
  };
  const updateReview = async (
    item: Review,
    status: "under_review" | "resolved" | "rejected",
  ) => {
    const response = reviewResponse[item._id]?.trim() ?? "";
    if (response.length < 2) {
      setError("Enter a response before changing this review request.");
      return;
    }
    setBusy(item._id);
    setError("");
    try {
      await api.patch(`/api/review-requests/${item._id}`, { status, response });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["review-requests"] }),
        client.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "The review response could not be saved.",
      );
    } finally {
      setBusy("");
    }
  };
  const option = (
    title: string,
    items: CatalogItem[],
    selected: string,
    setSelected: (value: string) => void,
  ) => (
    <View className="mt-3">
      <Text className="mb-2 text-xs font-semibold text-slate-600">{title}</Text>
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {items.map((item) => {
            const label = item.code
              ? `${item.code} · ${item.name ?? ""}`
              : (item.label ?? item.name ?? "Academic record");
            return (
              <TouchableOpacity
                key={item._id}
                onPress={() => setSelected(item._id)}
                className={`mr-2 rounded-xl px-3 py-2.5 ${selected === item._id ? "bg-[#142B4A]" : "bg-slate-100"}`}
              >
                <Text
                  className={`text-xs font-semibold ${selected === item._id ? "text-white" : "text-slate-700"}`}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <Text className="text-xs text-amber-700">
          No {title.toLowerCase()} in this institution yet. Ask an Administrator
          to configure them.
        </Text>
      )}
    </View>
  );
  return (
    <ScrollView
      className="flex-1 bg-[#F8FAFC]"
      contentContainerStyle={{ padding: 20, paddingBottom: 30 }}
    >
      <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
        FACULTY WORKSPACE
      </Text>
      <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
        Class records
      </Text>
      <Text className="mt-2 text-sm text-slate-500">
        Create offerings, review enrollment requests and manage your official
        class records.
      </Text>
      <TouchableOpacity
        onPress={() => {
          setCreating((value) => !value);
          setMessage("");
          setError("");
        }}
        className="mt-4 items-center rounded-xl bg-[#2563EB] py-3"
      >
        <Text className="font-bold text-white">
          {creating ? "Close offering form" : "+ Create class offering"}
        </Text>
      </TouchableOpacity>
      {creating ? (
        <View className="mt-3 rounded-2xl bg-white p-4">
          <Text className="text-lg font-bold text-slate-900">
            New class offering
          </Text>
          <Text className="mt-1 text-xs leading-5 text-slate-500">
            An offering is a subject assigned to you for one section, year,
            semester and schedule. The system creates its unique enrollment code
            and default 30/50/20 grading categories.
          </Text>
          {catalogs.isLoading ? (
            <ActivityIndicator className="mt-4" color="#2563EB" />
          ) : catalogs.isError ? (
            <Text className="mt-3 text-sm text-rose-700">
              Academic catalogs could not be loaded. Check your institution
              setup.
            </Text>
          ) : catalogs.data ? (
            <>
              {option(
                "Subject",
                catalogs.data.subjects,
                subjectId,
                setSubjectId,
              )}
              {option(
                "Section",
                catalogs.data.sections,
                sectionId,
                setSectionId,
              )}
              {option("Academic year", catalogs.data.years, yearId, setYearId)}
              {option(
                "Semester",
                catalogs.data.semesters,
                semesterId,
                setSemesterId,
              )}
            </>
          ) : null}
          <View className="mt-4 flex-row gap-2">
            <TextInput
              value={day}
              onChangeText={setDay}
              placeholder="Day (e.g. Monday)"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={startsAt}
              onChangeText={setStartsAt}
              placeholder="08:00"
              className="w-20 rounded-xl border border-slate-200 px-2 py-3 text-sm"
            />
            <TextInput
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="09:00"
              className="w-20 rounded-xl border border-slate-200 px-2 py-3 text-sm"
            />
          </View>
          <View className="mt-2 flex-row gap-2">
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Classroom or learning location"
              className="flex-[2] rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="number-pad"
              placeholder="Capacity"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
          </View>
          <TouchableOpacity
            onPress={() => void createOffering()}
            disabled={busy === "create" || catalogs.isLoading}
            className="mt-4 items-center rounded-xl bg-[#2563EB] py-3"
          >
            <Text className="font-bold text-white">
              {busy === "create"
                ? "Creating…"
                : "Create offering & enrollment code"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {message ? (
        <Text className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </Text>
      ) : null}
      {error ? (
        <Text className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </Text>
      ) : null}
      <Text className="mb-3 mt-6 text-lg font-bold text-slate-900">
        Pending enrollment requests
      </Text>
      {requests.isLoading ? (
        <View className="h-16 rounded-xl bg-slate-200" />
      ) : requests.data?.length ? (
        requests.data.map((request) => (
          <View key={request._id} className="mb-3 rounded-2xl bg-white p-4">
            <Text className="font-bold text-slate-900">
              {request.studentId?.name ?? "Student"}
            </Text>
            <Text className="mt-1 text-xs text-slate-500">
              {request.studentId?.studentNumber ?? "Student"} ·{" "}
              {request.offeringId?.subjectId?.code ?? "Class"}
            </Text>
            <View className="mt-3 flex-row gap-2">
              <TouchableOpacity
                onPress={() => void decide(request._id, "approve")}
                className="rounded-xl bg-emerald-600 px-4 py-2.5"
              >
                <Text className="text-xs font-bold text-white">Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void decide(request._id, "reject")}
                className="rounded-xl bg-rose-50 px-4 py-2.5"
              >
                <Text className="text-xs font-bold text-rose-700">Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      ) : (
        <View className="rounded-xl bg-white p-4">
          <Text className="text-sm text-slate-500">No pending requests.</Text>
        </View>
      )}
      {reviews.data?.length ? (
        <>
          <Text className="mb-3 mt-6 text-lg font-bold text-slate-900">
            Grade and attendance review requests
          </Text>
          {reviews.data.map((item) => (
            <View key={item._id} className="mb-3 rounded-2xl bg-white p-4">
              <Text className="font-bold text-slate-900">
                {item.studentId?.name ?? "Student"} · {item.recordType}
              </Text>
              <Text className="mt-1 text-xs text-slate-500">
                {item.offeringId?.subjectId?.code ?? "Class"} ·{" "}
                {item.status.replaceAll("_", " ")}
              </Text>
              <Text className="mt-3 text-sm leading-5 text-slate-700">
                {item.reason}
              </Text>
              <TextInput
                value={reviewResponse[item._id] ?? item.response ?? ""}
                onChangeText={(text) =>
                  setReviewResponse((state) => ({ ...state, [item._id]: text }))
                }
                placeholder="Response or review note"
                multiline
                className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
              <View className="mt-3 flex-row flex-wrap gap-2">
                <TouchableOpacity
                  onPress={() => void updateReview(item, "under_review")}
                  disabled={busy === item._id}
                  className="rounded-xl bg-blue-50 px-3 py-2"
                >
                  <Text className="text-xs font-bold text-blue-700">
                    Under review
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void updateReview(item, "resolved")}
                  disabled={busy === item._id}
                  className="rounded-xl bg-emerald-50 px-3 py-2"
                >
                  <Text className="text-xs font-bold text-emerald-700">
                    Resolve
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void updateReview(item, "rejected")}
                  disabled={busy === item._id}
                  className="rounded-xl bg-rose-50 px-3 py-2"
                >
                  <Text className="text-xs font-bold text-rose-700">
                    Reject
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      ) : null}
      <Text className="mb-3 mt-6 text-lg font-bold text-slate-900">
        Your offerings
      </Text>
      {offerings.isLoading ? (
        [1, 2].map((n) => (
          <View key={n} className="mb-3 h-28 rounded-2xl bg-slate-200" />
        ))
      ) : offerings.data?.length ? (
        offerings.data.map((item) => (
          <TouchableOpacity
            key={item._id}
            onPress={() => router.push(`/class/${item._id}` as Href)}
            className="mb-3 rounded-2xl border border-slate-100 bg-white p-4"
          >
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs font-bold uppercase text-[#2563EB]">
                  {item.subjectId?.code ?? "CLASS"}
                </Text>
                <Text className="mt-1 text-lg font-bold text-slate-900">
                  {item.subjectId?.name ?? "Subject"}
                </Text>
              </View>
              <Text className="text-slate-400">›</Text>
            </View>
            <Text className="mt-2 text-xs text-slate-500">
              Section {item.sectionId?.name ?? "—"} · {item.approvedCount ?? 0}/
              {item.capacity ?? 0} students
            </Text>
            {item.enrollmentCode ? (
              <Text className="mt-3 text-xs text-slate-500">
                Enrollment code{" "}
                <Text className="font-bold tracking-widest text-[#142B4A]">
                  {item.enrollmentCode}
                </Text>{" "}
                · {item.enrollmentEnabled ? "Open" : "Closed"}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))
      ) : (
        <View className="rounded-xl bg-white p-4">
          <Text className="text-sm text-slate-500">
            No class offerings have been assigned yet. Create one above.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
