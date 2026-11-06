import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../services/api";
import { useAuthStore } from "../../store/auth";

type Offering = {
  _id: string;
  subjectId?: { code?: string; name?: string; description?: string };
  facultyId?: { _id?: string; name?: string };
  sectionId?: { name?: string };
  academicYearId?: { label?: string };
  semesterId?: { name?: string };
  schedule?: { day?: string; startsAt?: string; endsAt?: string }[];
  location?: string;
  enrollmentCode?: string;
  enrollmentEnabled?: boolean;
  approvedCount?: number;
  capacity?: number;
  archivedAt?: string;
};
type Gradebook = {
  categories: { _id: string; name: string; weight: number }[];
  assessments: {
    _id: string;
    title: string;
    maxScore: number;
    published: boolean;
    dueAt?: string;
  }[];
  roster: {
    _id: string;
    studentId?: { _id?: string; name?: string; studentNumber?: string };
  }[];
};
type Grade = {
  _id: string;
  offeringId?: { _id?: string };
  finalGrade?: number;
  status: string;
  remarks?: string;
};
type PublishedScore = {
  _id: string;
  offeringId?: string | { _id?: string };
  assessmentId?: {
    title?: string;
    maxScore?: number;
    published?: boolean;
    categoryId?: { name?: string };
  };
  score: number;
  remarks?: string;
  updatedAt?: string;
};
type Review = {
  _id: string;
  offeringId?: string | { _id?: string };
  recordId: string;
  status: string;
  response?: string;
  reason?: string;
};
export default function ClassDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const role = useAuthStore((state) => state.user?.role);
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const [section, setSection] = useState<"overview" | "records">("overview");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [enrollmentMessage, setEnrollmentMessage] = useState("");
  const [confirmCode, setConfirmCode] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [dropEntry, setDropEntry] = useState("");
  const [dropReason, setDropReason] = useState("");
  const classQuery = useQuery<Offering>({
    queryKey: ["class", id],
    queryFn: async () =>
      (await api.get<{ item: Offering }>(`/api/class-offerings/${id}`)).data
        .item,
    enabled: Boolean(id),
  });
  const gradebook = useQuery<Gradebook>({
    queryKey: ["gradebook", id],
    queryFn: async () =>
      (await api.get<Gradebook>(`/api/class-offerings/${id}/gradebook`)).data,
    enabled:
      Boolean(id) &&
      ["faculty", "administrator", "super_admin"].includes(role ?? ""),
  });
  const studentGrades = useQuery<Grade[]>({
    queryKey: ["grades", user?.id],
    queryFn: async () =>
      (await api.get<{ items: Grade[] }>(`/api/students/${user?.id}/grades`))
        .data.items,
    enabled: role === "student" && Boolean(user?.id),
  });
  const studentScores = useQuery<PublishedScore[]>({
    queryKey: ["scores", user?.id],
    queryFn: async () =>
      (
        await api.get<{ items: PublishedScore[] }>(
          `/api/students/${user?.id}/scores`,
        )
      ).data.items,
    enabled: role === "student" && Boolean(user?.id),
  });
  const reviewRequests = useQuery<Review[]>({
    queryKey: ["review-requests", user?.id],
    queryFn: async () =>
      (await api.get<{ items: Review[] }>("/api/review-requests")).data.items,
    enabled: role === "student",
  });
  const offering = classQuery.data;
  const studentGrade = studentGrades.data?.find(
    (item) =>
      (typeof item.offeringId === "object"
        ? item.offeringId?._id
        : item.offeringId) === id,
  );
  const scoresForClass =
    studentScores.data?.filter(
      (item) =>
        (typeof item.offeringId === "object"
          ? item.offeringId?._id
          : item.offeringId) === id,
    ) ?? [];
  const reviewsForClass =
    reviewRequests.data?.filter(
      (item) =>
        (typeof item.offeringId === "object"
          ? item.offeringId?._id
          : item.offeringId) === id,
    ) ?? [];
  const requestGradeReview = async (recordId: string) => {
    if (reviewReason.trim().length < 10) {
      setReviewMessage("Please explain the issue in at least 10 characters.");
      return;
    }
    setReviewMessage("");
    try {
      await api.post("/api/review-requests", {
        offeringId: id,
        recordType: "grade",
        recordId,
        reason: reviewReason.trim(),
      });
      setReviewReason("");
      setReviewMessage("Review request sent to your faculty member.");
      await client.invalidateQueries({
        queryKey: ["review-requests", user?.id],
      });
    } catch (e) {
      setReviewMessage(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Could not send the review request.",
      );
    }
  };
  const title = offering?.subjectId?.name ?? "Class record";
  const createAttendance = async () => {
    try {
      const response = await api.post<{ item: { _id: string } }>(
        "/api/attendance-sessions",
        { offeringId: id, date: new Date().toISOString() },
      );
      await client.invalidateQueries({ queryKey: ["attendance", id] });
      router.push(
        `/class/${id}/attendance?sessionId=${response.data.item._id}` as Href,
      );
    } catch {
      router.push(`/class/${id}/attendance` as Href);
    }
  };
  const toggleEnrollment = async () => {
    try {
      await api.patch(`/api/class-offerings/${id}/enrollment-status`, {
        enabled: !offering?.enrollmentEnabled,
      });
      setEnrollmentMessage(
        `Enrollment ${offering?.enrollmentEnabled ? "closed" : "opened"}.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["class", id] }),
        client.invalidateQueries({ queryKey: ["class-offerings"] }),
      ]);
    } catch {
      setEnrollmentMessage("Enrollment status could not be changed.");
    }
  };
  const regenerateCode = async () => {
    if (!confirmCode) {
      setConfirmCode(true);
      return;
    }
    try {
      const result = await api.post<{ enrollmentCode: string }>(
        `/api/class-offerings/${id}/generate-code`,
        {},
      );
      setEnrollmentMessage(
        `New enrollment code: ${result.data.enrollmentCode}. The previous code is now invalid.`,
      );
      setConfirmCode(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["class", id] }),
        client.invalidateQueries({ queryKey: ["class-offerings"] }),
      ]);
    } catch {
      setEnrollmentMessage("A new enrollment code could not be generated.");
    }
  };
  const archiveOffering = async () => {
    if (!confirmArchive) {
      setConfirmArchive(true);
      return;
    }
    try {
      await api.patch(`/api/class-offerings/${id}/archive`);
      await client.invalidateQueries({ queryKey: ["class-offerings"] });
      router.replace("/(tabs)/records" as Href);
    } catch {
      setEnrollmentMessage("This offering could not be archived.");
      setConfirmArchive(false);
    }
  };
  const dropStudent = async () => {
    if (!dropEntry || dropReason.trim().length < 3) {
      setEnrollmentMessage("A reason is required to drop an enrolled student.");
      return;
    }
    try {
      await api.patch(`/api/enrollments/${dropEntry}/drop`, {
        reason: dropReason.trim(),
      });
      setEnrollmentMessage(
        "Student dropped from the class roster; the action was recorded.",
      );
      setDropEntry("");
      setDropReason("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["gradebook", id] }),
        client.invalidateQueries({ queryKey: ["class-offerings"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (e) {
      setEnrollmentMessage(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Student could not be dropped.",
      );
    }
  };
  const renderRosterEntry = (entry: Gradebook["roster"][number]) => (
    <View key={entry._id} className="mt-3 border-t border-slate-100 pt-3">
      <View className="flex-row items-center">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
          <Text className="font-bold text-[#2563EB]">
            {entry.studentId?.name?.charAt(0) ?? "S"}
          </Text>
        </View>
        <View className="ml-3 flex-1">
          <Text className="font-semibold text-slate-800">
            {entry.studentId?.name ?? "Student"}
          </Text>
          <Text className="text-xs text-slate-500">
            {entry.studentId?.studentNumber ?? "Student number not set"}
          </Text>
        </View>
        {role === "faculty" && entry.studentId?._id ? (
          <TouchableOpacity
            onPress={() =>
              router.push(
                `/messages?peerId=${entry.studentId?._id}&peerName=${encodeURIComponent(entry.studentId?.name ?? "Student")}&offeringId=${id}` as Href,
              )
            }
            className="mr-3"
          >
            <Text className="text-xs font-bold text-[#2563EB]">Message</Text>
          </TouchableOpacity>
        ) : null}
        {role === "faculty" ? (
          <TouchableOpacity
            onPress={() => {
              setDropEntry(entry._id);
              setDropReason("");
            }}
          >
            <Text className="text-xs font-bold text-rose-700">Drop</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {dropEntry === entry._id ? (
        <View className="mt-3 rounded-xl bg-rose-50 p-3">
          <Text className="text-xs font-semibold text-rose-800">
            Provide a reason; this action is audited and removes the student
            from the active roster.
          </Text>
          <TextInput
            value={dropReason}
            onChangeText={setDropReason}
            placeholder="Reason (at least 3 characters)"
            className="mt-2 rounded-lg border border-rose-200 bg-white px-3 py-2.5 text-sm"
          />
          <View className="mt-2 flex-row justify-end gap-4">
            <TouchableOpacity onPress={() => setDropEntry("")}>
              <Text className="text-xs font-semibold text-slate-500">
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void dropStudent()}>
              <Text className="text-xs font-bold text-rose-700">
                Confirm drop
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
  if (classQuery.isLoading)
    return (
      <SafeAreaView className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
        <Text className="mt-3 text-sm text-slate-500">Loading class…</Text>
      </SafeAreaView>
    );
  if (classQuery.isError || !offering)
    return (
      <SafeAreaView className="flex-1 justify-center px-6">
        <Text className="text-center text-lg font-bold text-[#142B4A]">
          Class details unavailable
        </Text>
        <Text className="mt-2 text-center text-sm text-slate-500">
          This class may not be assigned to your account.
        </Text>
      </SafeAreaView>
    );
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          {offering.subjectId?.code ?? "SUBJECT"} ·{" "}
          {offering.sectionId?.name ?? "SECTION"}
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          {title}
        </Text>
        <Text className="mt-2 text-sm text-slate-500">
          {offering.facultyId?.name ?? "Faculty"} ·{" "}
          {offering.academicYearId?.label ?? "Academic year"} ·{" "}
          {offering.semesterId?.name ?? "Semester"}
        </Text>
        {offering.schedule?.length ? (
          <Text className="mt-2 text-sm text-slate-600">
            {offering.schedule
              .map(
                (slot) =>
                  `${slot.day ?? "Class"} ${slot.startsAt ?? ""}–${slot.endsAt ?? ""}`,
              )
              .join(" · ")}
            {offering.location ? ` · ${offering.location}` : ""}
          </Text>
        ) : null}
        <View className="mt-5 flex-row rounded-xl bg-slate-100 p-1">
          <TouchableOpacity
            onPress={() => setSection("overview")}
            className={`flex-1 items-center rounded-lg py-2.5 ${section === "overview" ? "bg-white" : ""}`}
          >
            <Text
              className={`text-sm font-semibold ${section === "overview" ? "text-[#142B4A]" : "text-slate-500"}`}
            >
              Overview
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSection("records")}
            className={`flex-1 items-center rounded-lg py-2.5 ${section === "records" ? "bg-white" : ""}`}
          >
            <Text
              className={`text-sm font-semibold ${section === "records" ? "text-[#142B4A]" : "text-slate-500"}`}
            >
              {role === "student" ? "My grades" : "Class record"}
            </Text>
          </TouchableOpacity>
        </View>
        {section === "overview" ? (
          <>
            <View className="mt-4 rounded-2xl bg-white p-4">
              <Text className="font-bold text-slate-900">
                Class information
              </Text>
              <Text className="mt-2 text-sm leading-6 text-slate-600">
                {offering.subjectId?.description ??
                  "Your class schedule and academic updates are shown here."}
              </Text>
            </View>
            <View className="mt-4 flex-row gap-2">
              <TouchableOpacity
                onPress={() => router.push(`/class/${id}/activities` as Href)}
                className="flex-1 rounded-xl bg-[#2563EB] py-3"
              >
                <Text className="text-center font-bold text-white">
                  Activities
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/class/${id}/attendance` as Href)}
                className="flex-1 rounded-xl bg-white py-3"
              >
                <Text className="text-center font-bold text-[#142B4A]">
                  Attendance
                </Text>
              </TouchableOpacity>
            </View>
            {role === "faculty" ? (
              <TouchableOpacity
                onPress={() => router.push(`/class/${id}/gradebook` as Href)}
                className="mt-2 items-center rounded-xl border border-blue-200 bg-white py-3"
              >
                <Text className="font-bold text-[#2563EB]">Open gradebook</Text>
              </TouchableOpacity>
            ) : null}
            {role === "faculty" || role === "student" ? (
              <TouchableOpacity
                onPress={() =>
                  router.push(`/interventions?offeringId=${id}` as Href)
                }
                className="mt-2 items-center rounded-xl border border-blue-200 bg-white py-3"
              >
                <Text className="font-bold text-[#2563EB]">
                  {role === "faculty"
                    ? "Student support plans"
                    : "My academic support"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {role === "student" && offering.facultyId?._id ? (
              <TouchableOpacity
                onPress={() =>
                  router.push(
                    `/messages?peerId=${offering.facultyId?._id}&peerName=${encodeURIComponent(offering.facultyId?.name ?? "Faculty")}&offeringId=${id}` as Href,
                  )
                }
                className="mt-2 items-center rounded-xl border border-blue-200 bg-white py-3"
              >
                <Text className="font-bold text-[#2563EB]">
                  Message faculty
                </Text>
              </TouchableOpacity>
            ) : null}
            {role === "faculty" ? (
              <View className="mt-4 rounded-2xl bg-[#142B4A] p-4">
                <Text className="font-bold text-white">Enrollment code</Text>
                <Text className="mt-2 text-xs text-blue-100">
                  Share this code with eligible students so they can request
                  enrollment.
                </Text>
                <Text className="mt-2 text-xl font-extrabold tracking-[3px] text-[#F5C542]">
                  {offering.enrollmentCode ?? "Open Class Records"}
                </Text>
                <Text className="mt-1 text-xs text-blue-100">
                  {offering.enrollmentEnabled
                    ? "Enrollment is open"
                    : "Enrollment is closed"}{" "}
                  · {offering.approvedCount ?? 0}/{offering.capacity ?? "—"}{" "}
                  seats
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    void Share.share({
                      message: `Join ${title} (${offering.subjectId?.code ?? "class"}) with enrollment code ${offering.enrollmentCode ?? ""}.`,
                    })
                  }
                  className="mt-3 items-center rounded-xl bg-white py-2.5"
                >
                  <Text className="font-bold text-[#142B4A]">Share code</Text>
                </TouchableOpacity>
                <View className="mt-2 flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => void toggleEnrollment()}
                    className="flex-1 rounded-xl border border-white/30 py-2.5"
                  >
                    <Text className="text-center text-xs font-bold text-white">
                      {offering.enrollmentEnabled
                        ? "Close enrollment"
                        : "Open enrollment"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void regenerateCode()}
                    className="flex-1 rounded-xl border border-white/30 py-2.5"
                  >
                    <Text className="text-center text-xs font-bold text-white">
                      {confirmCode ? "Confirm new code" : "Regenerate code"}
                    </Text>
                  </TouchableOpacity>
                </View>
                {confirmCode ? (
                  <TouchableOpacity
                    onPress={() => setConfirmCode(false)}
                    className="mt-2 self-end"
                  >
                    <Text className="text-xs text-blue-100">
                      Cancel code replacement
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {enrollmentMessage ? (
                  <Text className="mt-2 text-xs text-blue-100">
                    {enrollmentMessage}
                  </Text>
                ) : null}
                <TouchableOpacity
                  onPress={() => void archiveOffering()}
                  className="mt-3 items-center rounded-xl bg-rose-500/20 py-2.5"
                >
                  <Text className="text-xs font-bold text-rose-100">
                    {confirmArchive
                      ? "Confirm archive offering"
                      : "Archive completed offering"}
                  </Text>
                </TouchableOpacity>
                {confirmArchive ? (
                  <TouchableOpacity
                    onPress={() => setConfirmArchive(false)}
                    className="mt-2 self-center"
                  >
                    <Text className="text-xs text-blue-100">
                      Keep this offering
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {role === "faculty" ? (
              <TouchableOpacity
                onPress={() => void createAttendance()}
                className="mt-4 items-center rounded-xl bg-[#2563EB] py-3.5"
              >
                <Text className="font-bold text-white">
                  Start attendance session
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : role === "student" ? (
          <>
            <View className="mt-4 rounded-2xl bg-white p-4">
              <Text className="font-bold text-slate-900">Published grades</Text>
              {studentGrades.isLoading ? (
                <ActivityIndicator className="mt-4" color="#2563EB" />
              ) : studentGrade?.status === "published" ||
                studentGrade?.status === "finalized" ? (
                <Text className="mt-3 text-3xl font-extrabold text-[#2563EB]">
                  {studentGrade.finalGrade?.toFixed(2)}%
                </Text>
              ) : (
                <Text className="mt-3 text-sm text-slate-500">
                  Grades stay private until your faculty member publishes them.
                </Text>
              )}
              {studentGrade?.remarks ? (
                <Text className="mt-2 text-sm text-slate-600">
                  {studentGrade.remarks}
                </Text>
              ) : null}
            </View>
            <View className="mt-3 rounded-2xl bg-white p-4">
              <Text className="font-bold text-slate-900">
                Published assessment results
              </Text>
              {studentScores.isLoading ? (
                <ActivityIndicator className="mt-3" color="#2563EB" />
              ) : scoresForClass.length ? (
                scoresForClass.map((score) => {
                  const prior = reviewsForClass.find(
                    (request) => request.recordId === score._id,
                  );
                  return (
                    <View
                      key={score._id}
                      className="mt-3 border-t border-slate-100 pt-3"
                    >
                      <Text className="font-semibold text-slate-800">
                        {score.assessmentId?.title ?? "Assessment"}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-500">
                        {score.assessmentId?.categoryId?.name ?? "Class work"} ·{" "}
                        {score.score}/{score.assessmentId?.maxScore ?? "—"}
                      </Text>
                      {score.remarks ? (
                        <Text className="mt-1 text-xs text-slate-600">
                          {score.remarks}
                        </Text>
                      ) : null}
                      {prior ? (
                        <Text className="mt-2 text-xs font-semibold text-blue-700">
                          Review {prior.status.replaceAll("_", " ")}
                          {prior.response ? ` · ${prior.response}` : ""}
                        </Text>
                      ) : (
                        <TouchableOpacity
                          onPress={() => void requestGradeReview(score._id)}
                          className="mt-2 self-start"
                        >
                          <Text className="text-xs font-bold text-[#2563EB]">
                            Request grade review
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })
              ) : (
                <Text className="mt-2 text-sm text-slate-500">
                  No published assessment scores yet.
                </Text>
              )}
              <TextInput
                value={reviewReason}
                onChangeText={setReviewReason}
                placeholder="Reason for review (at least 10 characters)"
                multiline
                className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
              {reviewMessage ? (
                <Text className="mt-2 text-xs text-blue-700">
                  {reviewMessage}
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <View className="mt-4 rounded-2xl bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-bold text-slate-900">Official roster</Text>
              <Text className="text-xs font-semibold text-slate-500">
                {gradebook.data?.roster.length ?? 0} approved
              </Text>
            </View>
            {gradebook.isLoading ? (
              <ActivityIndicator className="mt-4" color="#2563EB" />
            ) : (
              gradebook.data?.roster.map(renderRosterEntry)
            )}
          </View>
        )}
        {role !== "student" && section === "records" ? (
          <View className="mt-4 rounded-2xl bg-white p-4">
            <Text className="font-bold text-slate-900">Grading categories</Text>
            {gradebook.data?.categories.map((category) => (
              <View
                key={category._id}
                className="mt-3 flex-row justify-between border-b border-slate-100 pb-2"
              >
                <Text className="text-sm text-slate-700">{category.name}</Text>
                <Text className="text-sm font-bold text-[#142B4A]">
                  {category.weight}%
                </Text>
              </View>
            ))}
            <Text className="mb-1 mt-5 font-bold text-slate-900">
              Assessments
            </Text>
            {gradebook.data?.assessments.map((assessment) => (
              <View
                key={assessment._id}
                className="mt-2 rounded-xl bg-[#F8FAFC] p-3"
              >
                <Text className="font-semibold text-slate-800">
                  {assessment.title}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  Maximum {assessment.maxScore} ·{" "}
                  {assessment.published ? "Published" : "Draft"}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
