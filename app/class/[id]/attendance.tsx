import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  cacheRecords,
  pendingOfflineChanges,
  queueOfflineChange,
  synchronizeOfflineChanges,
} from "../../../services/offline";
import { useAuthStore } from "../../../store/auth";
type Session = { _id: string; date: string; topic?: string };
type RosterEntry = {
  _id: string;
  studentId?: { _id?: string; name?: string; studentNumber?: string };
};
type AttendanceRecord = {
  _id: string;
  studentId?: string | { _id?: string; name?: string };
  sessionId?: string | { _id?: string };
  offeringId?: string;
  status: "present" | "absent" | "late" | "excused";
  updatedAt?: string;
};
type ReviewRequest = {
  _id: string;
  recordId: string;
  recordType: "grade" | "attendance";
  status: string;
  response?: string;
  offeringId?: string | { _id?: string };
};
type Classroom = { sessions: Session[]; records: AttendanceRecord[] };
const STATES: AttendanceRecord["status"][] = [
  "present",
  "absent",
  "late",
  "excused",
];
const COLOR: Record<AttendanceRecord["status"], string> = {
  present: "#15803D",
  absent: "#B91C1C",
  late: "#C2410C",
  excused: "#475569",
};
function idOf(value: AttendanceRecord["studentId"]): string {
  return typeof value === "string" ? value : (value?._id ?? "");
}
export default function AttendanceScreen() {
  const { id, sessionId: routeSessionId } = useLocalSearchParams<{
    id: string;
    sessionId?: string;
  }>();
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const faculty = user?.role === "faculty";
  const manager =
    user?.role === "administrator" || user?.role === "super_admin";
  const canViewClass = faculty || manager;
  const [sessionId, setSessionId] = useState("");
  const [marks, setMarks] = useState<
    Record<string, AttendanceRecord["status"]>
  >({});
  const [reason, setReason] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const gradebook = useQuery<{ roster: RosterEntry[] }>({
    queryKey: ["gradebook", id],
    enabled: faculty && Boolean(id),
    queryFn: async () =>
      (
        await api.get<{ roster: RosterEntry[] }>(
          `/api/class-offerings/${id}/gradebook`,
        )
      ).data,
  });
  const room = useQuery<Classroom>({
    queryKey: ["attendance", id],
    enabled: canViewClass && Boolean(id),
    queryFn: async () =>
      (await api.get<Classroom>(`/api/attendance/class/${id}`)).data,
  });
  const studentAttendance = useQuery<AttendanceRecord[]>({
    queryKey: ["attendance-student", user?.id],
    enabled: user?.role === "student" && Boolean(user.id),
    queryFn: async () =>
      (
        await api.get<{ items: AttendanceRecord[] }>(
          `/api/attendance/student/${user?.id}`,
        )
      ).data.items.filter((item) => item.offeringId === id),
  });
  const studentReviews = useQuery<ReviewRequest[]>({
    queryKey: ["review-requests", user?.id],
    enabled: user?.role === "student",
    queryFn: async () =>
      (await api.get<{ items: ReviewRequest[] }>("/api/review-requests")).data
        .items,
  });
  const records = useMemo(() => room.data?.records ?? [], [room.data?.records]);
  const sessions = room.data?.sessions ?? [];
  const selectedSessionId =
    sessionId || routeSessionId || sessions[0]?._id || "";
  useEffect(() => {
    void pendingOfflineChanges()
      .then((rows) => setPending(rows.length))
      .catch(() => setPending(0));
  }, [busy, message]);
  const createSession = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await api.post<{ item: Session }>(
        "/api/attendance-sessions",
        { offeringId: id, date: new Date().toISOString() },
      );
      setSessionId(response.data.item._id);
      await client.invalidateQueries({ queryKey: ["attendance", id] });
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Could not create an attendance session.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!selectedSessionId) {
      setMessage("Select or create an attendance session first.");
      return;
    }
    const roster = gradebook.data?.roster ?? [];
    const entries = roster
      .map((row) => {
        const studentId = row.studentId?._id ?? "";
        const previous = records.find(
          (item) =>
            idOf(item.studentId) === studentId &&
            (typeof item.sessionId === "string"
              ? item.sessionId
              : item.sessionId?._id) === selectedSessionId,
        );
        return {
          studentId,
          status: marks[studentId] ?? previous?.status ?? "present",
          reason: reason.trim() || undefined,
          previous,
        };
      })
      .filter((row) => Boolean(row.studentId));
    setBusy(true);
    setMessage("");
    try {
      await api.post("/api/attendance/bulk", {
        sessionId: selectedSessionId,
        records: entries.map(({ studentId, status, reason: editReason }) => ({
          studentId,
          status,
          reason: editReason,
        })),
      });
      setMessage("Attendance saved to the official class record.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["attendance", id] }),
        client.invalidateQueries({ queryKey: ["attendance-student"] }),
      ]);
    } catch (e) {
      try {
        for (const entry of entries) {
          if (
            entry.previous &&
            entry.previous.status !== entry.status &&
            !entry.reason
          )
            throw new Error(
              "A reason is required when changing an existing status.",
            );
          await queueOfflineChange(
            "attendance",
            {
              sessionId: selectedSessionId,
              studentId: entry.studentId,
              status: entry.status,
              reason: entry.reason,
            },
            entry.previous?.updatedAt,
          );
        }
        const cached = entries.map((entry) => ({
          id: `${selectedSessionId}:${entry.studentId}`,
          sessionId: selectedSessionId,
          offeringId: id,
          studentId: entry.studentId,
          status: entry.status,
          updatedAt: new Date().toISOString(),
        }));
        await cacheRecords("attendance-drafts", cached);
        const queued = await pendingOfflineChanges();
        setPending(queued.length);
        setMessage(
          "Offline draft saved locally. It is not yet part of the official attendance record.",
        );
      } catch (queueError) {
        setMessage(
          queueError instanceof Error
            ? queueError.message
            : e instanceof Error
              ? e.message
              : "Attendance could not be saved.",
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const result = await synchronizeOfflineChanges();
      setMessage(
        `${result.synced} saved · ${result.conflicts} conflicts · ${result.rejected} rejected. Review conflicts before retrying.`,
      );
      const queued = await pendingOfflineChanges();
      setPending(queued.length);
      await client.invalidateQueries({ queryKey: ["attendance", id] });
    } catch {
      setMessage("Sync needs a working network connection and valid sign-in.");
    } finally {
      setBusy(false);
    }
  };
  const requestReview = async (record: AttendanceRecord) => {
    if (reviewReason.trim().length < 10) {
      setMessage(
        "Please describe the attendance issue in at least 10 characters.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await api.post("/api/review-requests", {
        offeringId: id,
        recordType: "attendance",
        recordId: record._id,
        reason: reviewReason.trim(),
      });
      setReviewReason("");
      setMessage("Attendance review request sent to your faculty member.");
      await client.invalidateQueries({
        queryKey: ["review-requests", user?.id],
      });
    } catch (e) {
      setMessage(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Attendance review request could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };
  const renderStudentAttendance = (record: AttendanceRecord) => {
    const existing = studentReviews.data?.find(
      (item) =>
        item.recordType === "attendance" && item.recordId === record._id,
    );
    return (
      <View key={record._id} className="mt-3 rounded-xl bg-white p-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="font-semibold capitalize text-slate-800">
              {record.status}
            </Text>
            <Text className="mt-1 text-xs text-slate-500">
              {record.updatedAt
                ? new Date(record.updatedAt).toLocaleDateString()
                : "Class session"}
            </Text>
          </View>
          <Text className="text-xs text-slate-400">Class record</Text>
        </View>
        {existing ? (
          <Text className="mt-2 text-xs font-semibold text-blue-700">
            Review {existing.status.replaceAll("_", " ")}
            {existing.response ? ` · ${existing.response}` : ""}
          </Text>
        ) : (
          <>
            <TextInput
              value={reviewReason}
              onChangeText={setReviewReason}
              placeholder="Reason for review (at least 10 characters)"
              multiline
              className="mt-3 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <TouchableOpacity
              onPress={() => void requestReview(record)}
              disabled={busy}
              className="mt-2 self-start"
            >
              <Text className="text-xs font-bold text-[#2563EB]">
                Request attendance review
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };
  const counts = (studentAttendance.data ?? []).reduce(
    (acc, record) => ({
      ...acc,
      [record.status]: (acc[record.status] ?? 0) + 1,
    }),
    { present: 0, absent: 0, late: 0, excused: 0 },
  );
  const total = (studentAttendance.data ?? []).length;
  const rate = total
    ? Math.round(
        ((counts.present + counts.late + counts.excused) / total) * 100,
      )
    : 0;
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
        <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
          CLASS RECORD
        </Text>
        <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
          Attendance
        </Text>
        {faculty ? (
          <>
            <Text className="mt-1 text-sm text-slate-500">
              Record Present, Absent, Late or Excused for each approved student.
            </Text>
            <View className="mt-4 flex-row gap-2">
              <TouchableOpacity
                onPress={() => void createSession()}
                disabled={busy}
                className="flex-1 rounded-xl bg-[#2563EB] py-3"
              >
                <Text className="text-center font-bold text-white">
                  New session
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void sync()}
                disabled={busy || pending === 0}
                className="flex-1 rounded-xl bg-white py-3"
              >
                <Text className="text-center font-bold text-[#142B4A]">
                  Sync drafts ({pending})
                </Text>
              </TouchableOpacity>
            </View>
            {sessions.length ? (
              <View className="mt-4 rounded-2xl bg-white p-4">
                <Text className="font-bold text-slate-900">
                  Attendance session
                </Text>
                {sessions.map((session) => (
                  <TouchableOpacity
                    key={session._id}
                    onPress={() => setSessionId(session._id)}
                    className={`mt-2 rounded-xl p-3 ${selectedSessionId === session._id ? "bg-blue-50" : "bg-slate-50"}`}
                  >
                    <Text className="font-semibold text-slate-800">
                      {new Date(session.date).toLocaleDateString()}{" "}
                      {session.topic ? `· ${session.topic}` : ""}
                    </Text>
                    <Text className="text-xs text-slate-500">
                      {session._id === sessionId ? "Selected" : "Tap to select"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-500">
                Create the first session for today&apos;s class.
              </Text>
            )}
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason for changing a saved status (required for edits)"
              className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
            />
            {gradebook.isLoading || room.isLoading ? (
              <ActivityIndicator className="mt-5" color="#2563EB" />
            ) : (
              gradebook.data?.roster.map((entry) => {
                const studentId = entry.studentId?._id ?? "";
                const previous = records.find(
                  (item) =>
                    idOf(item.studentId) === studentId &&
                    (typeof item.sessionId === "string"
                      ? item.sessionId
                      : item.sessionId?._id) === sessionId,
                );
                const selected =
                  marks[studentId] ?? previous?.status ?? "present";
                return (
                  <View
                    key={entry._id}
                    className="mt-3 rounded-2xl bg-white p-4"
                  >
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text className="font-bold text-slate-900">
                          {entry.studentId?.name ?? "Student"}
                        </Text>
                        <Text className="mt-1 text-xs text-slate-500">
                          {entry.studentId?.studentNumber ?? ""}
                          {previous ? ` · ${previous.status}` : " · New record"}
                        </Text>
                      </View>
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: COLOR[selected] }}
                      >
                        {selected.toUpperCase()}
                      </Text>
                    </View>
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {STATES.map((status) => (
                        <TouchableOpacity
                          key={status}
                          onPress={() =>
                            setMarks((old) => ({ ...old, [studentId]: status }))
                          }
                          className="rounded-lg px-3 py-2"
                          style={{
                            backgroundColor:
                              selected === status ? COLOR[status] : "#F1F5F9",
                          }}
                        >
                          <Text
                            className="text-[11px] font-bold capitalize"
                            style={{
                              color: selected === status ? "white" : "#475569",
                            }}
                          >
                            {status}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                );
              })
            )}
            <TouchableOpacity
              onPress={() => void save()}
              disabled={busy || !gradebook.data?.roster.length}
              className="mt-5 items-center rounded-xl bg-[#2563EB] py-3.5"
            >
              <Text className="font-bold text-white">
                {busy ? "Saving…" : "Save attendance"}
              </Text>
            </TouchableOpacity>
          </>
        ) : user?.role === "student" ? (
          <>
            <View className="mt-5 flex-row flex-wrap gap-2">
              {STATES.map((status) => (
                <View
                  key={status}
                  className="min-w-[46%] flex-1 rounded-2xl bg-white p-4"
                >
                  <Text className="text-xs font-semibold capitalize text-slate-500">
                    {status}
                  </Text>
                  <Text
                    className="mt-1 text-2xl font-extrabold"
                    style={{ color: COLOR[status] }}
                  >
                    {counts[status] ?? 0}
                  </Text>
                </View>
              ))}
            </View>
            <View className="mt-3 rounded-2xl bg-[#142B4A] p-5">
              <Text className="text-sm font-semibold text-blue-100">
                Attendance rate
              </Text>
              <Text className="mt-1 text-3xl font-extrabold text-white">
                {rate}%
              </Text>
            </View>
            {studentAttendance.isLoading ? (
              <ActivityIndicator className="mt-5" color="#2563EB" />
            ) : (
              studentAttendance.data?.map(renderStudentAttendance)
            )}
            {!studentAttendance.isLoading && !studentAttendance.data?.length ? (
              <Text className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-500">
                No attendance records have been published yet.
              </Text>
            ) : null}
          </>
        ) : manager ? (
          <View className="mt-5 rounded-2xl bg-white p-4">
            <Text className="font-bold text-slate-900">
              Read-only attendance monitoring
            </Text>
            <Text className="mt-1 text-xs text-slate-500">
              Administrative view only; attendance changes remain a faculty
              responsibility.
            </Text>
            <Text className="mb-2 mt-4 text-sm font-semibold text-slate-700">
              Sessions · {sessions.length}
            </Text>
            {sessions.map((session) => (
              <View
                key={session._id}
                className="mb-2 rounded-xl bg-slate-50 p-3"
              >
                <Text className="font-semibold text-slate-800">
                  {new Date(session.date).toLocaleDateString()}
                  {session.topic ? ` · ${session.topic}` : ""}
                </Text>
              </View>
            ))}
            <Text className="mb-2 mt-3 text-sm font-semibold text-slate-700">
              Attendance entries · {records.length}
            </Text>
            {records.map((record) => (
              <View
                key={record._id}
                className="mb-2 flex-row items-center justify-between rounded-xl bg-slate-50 p-3"
              >
                <View className="flex-1">
                  <Text className="font-semibold text-slate-800">
                    {typeof record.studentId === "object"
                      ? (record.studentId?.name ?? "Student")
                      : "Student"}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    {record.updatedAt
                      ? new Date(record.updatedAt).toLocaleDateString()
                      : "Session record"}
                  </Text>
                </View>
                <Text
                  className="text-xs font-bold capitalize"
                  style={{ color: COLOR[record.status] }}
                >
                  {record.status}
                </Text>
              </View>
            ))}
            {!records.length ? (
              <Text className="mt-2 text-sm text-slate-500">
                No attendance records have been entered for this class.
              </Text>
            ) : null}
          </View>
        ) : null}
        {message ? (
          <Text className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            {message}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
