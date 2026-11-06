import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "../../services/api";
import { useAuthStore } from "../../store/auth";
type Offering = {
  _id: string;
  subjectId?: { code?: string; name?: string };
  sectionId?: { name?: string };
};
type Report = {
  title: string;
  detail: string;
  endpoint: string;
  filename: string;
  mimeType: string;
};
const reports: Report[] = [
  {
    title: "Class record",
    detail: "Approved roster and published grade summary · Excel",
    endpoint: "/api/reports/class-record",
    filename: "classtrack-class-record.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    title: "Attendance report",
    detail: "Session-by-session presence and absence · PDF",
    endpoint: "/api/reports/attendance",
    filename: "classtrack-attendance.pdf",
    mimeType: "application/pdf",
  },
  {
    title: "Student performance",
    detail: "Published standing and academic indicators · Excel",
    endpoint: "/api/reports/student-performance",
    filename: "classtrack-performance.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    title: "Final grades",
    detail: "Published and finalized grades by class · Excel",
    endpoint: "/api/reports/final-grades",
    filename: "classtrack-final-grades.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    title: "Enrollment roster",
    detail: "Pending and approved requests with student details · Excel",
    endpoint: "/api/reports/enrollment",
    filename: "classtrack-enrollment.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    title: "Missing activities",
    detail: "Roster students without submissions and overdue work · Excel",
    endpoint: "/api/reports/missing-activities",
    filename: "classtrack-missing-activities.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    title: "Grade submission status",
    detail: "Calculated, published and outstanding final grades · Excel",
    endpoint: "/api/reports/grade-submission",
    filename: "classtrack-grade-submission.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    title: "Faculty workload",
    detail: "Active offerings and approved student counts · Excel",
    endpoint: "/api/reports/faculty-workload",
    filename: "classtrack-faculty-workload.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
];
export default function ReportsScreen() {
  const role = useAuthStore((state) => state.user?.role);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const classes = useQuery<Offering[]>({
    queryKey: ["class-offerings"],
    queryFn: async () =>
      (
        await api.get<{ items: Offering[] }>("/api/class-offerings", {
          params: { limit: 100 },
        })
      ).data.items,
  });
  const selectedOfferingId = selected || classes.data?.[0]?._id || "";
  const download = async (report: Report) => {
    const needsOffering = report.endpoint !== "/api/reports/faculty-workload";
    if (needsOffering && !selectedOfferingId) {
      setNotice("Choose an authorized class before generating a report.");
      return;
    }
    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) {
      setNotice("Your secure session has expired. Sign in again.");
      return;
    }
    setBusy(report.title);
    setNotice("");
    const uri = api.getUri({
      url: report.endpoint,
      params: needsOffering ? { offeringId: selectedOfferingId } : {},
    });
    try {
      if (Platform.OS === "web") {
        const response = await fetch(uri, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body.error ?? `Report request failed (${response.status}).`,
          );
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = report.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } else {
        const root = FileSystem.cacheDirectory;
        if (!root)
          throw new Error(
            "Temporary file storage is unavailable on this device.",
          );
        const fileUri = `${root}${report.filename}`;
        const result = await FileSystem.downloadAsync(uri, fileUri, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (result.status < 200 || result.status >= 300)
          throw new Error(`Report request failed (${result.status}).`);
        if (await Sharing.isAvailableAsync())
          await Sharing.shareAsync(result.uri, {
            mimeType: report.mimeType,
            dialogTitle: `Share ${report.title}`,
          });
        else setNotice(`Saved to ${result.uri}`);
      }
      setNotice(
        `${report.title} generated${needsOffering ? ` for ${classes.data?.find((item) => item._id === selectedOfferingId)?.subjectId?.name ?? "your class"}` : ""}.`,
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "The report could not be generated.",
      );
    } finally {
      setBusy("");
    }
  };
  const canExport = role !== "student";
  return (
    <ScrollView
      className="flex-1 bg-[#F8FAFC]"
      contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
    >
      <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
        ACADEMIC INSIGHTS
      </Text>
      <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
        Reports
      </Text>
      <Text className="mt-2 text-sm leading-5 text-slate-500">
        Secure PDF and Excel exports are generated from the official class
        record.
      </Text>
      {classes.isLoading ? (
        <ActivityIndicator className="mt-4" color="#2563EB" />
      ) : classes.isError ? (
        <Text className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          No class offerings are available for your account.
        </Text>
      ) : (
        <View className="mt-4 rounded-2xl bg-white p-4">
          <Text className="font-bold text-slate-900">Choose a class</Text>
          {classes.data?.length ? (
            classes.data.map((offering) => (
              <TouchableOpacity
                key={offering._id}
                onPress={() => setSelected(offering._id)}
                className={`mt-2 rounded-xl p-3 ${(selected || classes.data?.[0]?._id) === offering._id ? "bg-blue-50" : "bg-slate-50"}`}
              >
                <Text className="font-semibold text-slate-800">
                  {offering.subjectId?.code ?? "Subject"} ·{" "}
                  {offering.subjectId?.name ?? "Class"}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {offering.sectionId?.name ?? "Section not set"} ·{" "}
                  {(selected || classes.data?.[0]?._id) === offering._id
                    ? "Selected"
                    : "Tap to select"}
                </Text>
              </TouchableOpacity>
            ))
          ) : (
            <Text className="mt-2 text-sm text-slate-500">
              No class record is available to export.
            </Text>
          )}
        </View>
      )}
      {reports.map((report) => (
        <View
          key={report.title}
          className="mt-3 rounded-2xl border border-slate-100 bg-white p-4"
        >
          <Text className="font-bold text-slate-900">{report.title}</Text>
          <Text className="mt-1 text-xs leading-5 text-slate-500">
            {report.detail}
          </Text>
          {canExport ? (
            report.endpoint === "/api/reports/faculty-workload" &&
            role === "faculty" ? (
              <Text className="mt-3 text-xs text-slate-500">
                Faculty workload exports require an Administrator or Super Admin
                account.
              </Text>
            ) : (
              <TouchableOpacity
                onPress={() => void download(report)}
                disabled={
                  Boolean(busy) ||
                  (report.endpoint !== "/api/reports/faculty-workload" &&
                    !selectedOfferingId)
                }
                className="mt-3 self-start rounded-xl bg-[#2563EB] px-4 py-2.5"
              >
                <Text className="text-xs font-bold text-white">
                  {busy === report.title
                    ? "Preparing export…"
                    : "Generate & export"}
                </Text>
              </TouchableOpacity>
            )
          ) : (
            <Text className="mt-3 text-xs text-slate-500">
              Ask your faculty or administrator for an authorized report.
            </Text>
          )}
        </View>
      ))}
      {notice ? (
        <Text className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
          {notice}
        </Text>
      ) : null}
      <View className="mt-4 rounded-2xl bg-[#EAF1FF] p-4">
        <Text className="text-sm font-bold text-[#142B4A]">
          Institution-scoped
        </Text>
        <Text className="mt-1 text-xs leading-5 text-slate-600">
          Every export is checked against your role, institution and class
          ownership on the server.
        </Text>
      </View>
    </ScrollView>
  );
}
