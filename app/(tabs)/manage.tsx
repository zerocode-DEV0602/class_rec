import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../../services/api";
import { useAuthStore } from "../../store/auth";

const schema = z.object({
  name: z.string().min(2, "Enter a name."),
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
  role: z.enum(["administrator", "faculty", "student"]),
  institutionId: z.string().optional(),
  departmentId: z.string().optional(),
  programId: z.string().optional(),
  sectionId: z.string().optional(),
  studentNumber: z.string().max(50).optional(),
});
type Values = z.infer<typeof schema>;
type Person = {
  _id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  institutionId?: string;
  departmentId?: string;
  programId?: string;
  sectionId?: string;
  studentNumber?: string;
};
type Institution = {
  _id: string;
  name: string;
  code: string;
  address?: string;
  active: boolean;
};
type RecordItem = {
  _id: string;
  name?: string;
  code?: string;
  label?: string;
  archivedAt?: string;
  [key: string]: unknown;
};
type Audit = {
  _id: string;
  action: string;
  targetType?: string;
  targetId?: string;
  createdAt?: string;
  actorId?: { name?: string; email?: string };
};
type Setting = { _id: string; key: string; value: unknown };
type ManagedOffering = {
  _id: string;
  subjectId?: { code?: string; name?: string };
  facultyId?: { name?: string };
  sectionId?: { name?: string };
  academicYearId?: { label?: string };
  semesterId?: { name?: string };
  capacity?: number;
  approvedCount?: number;
  enrollmentEnabled?: boolean;
  schedule?: { day?: string; startsAt?: string; endsAt?: string }[];
};
const fieldsByType: Record<
  string,
  {
    key: string;
    label: string;
    numeric?: boolean;
    date?: boolean;
    toggle?: boolean;
  }[]
> = {
  departments: [
    { key: "name", label: "Department name" },
    { key: "code", label: "Department code" },
  ],
  programs: [
    { key: "name", label: "Program name" },
    { key: "code", label: "Program code" },
    { key: "departmentId", label: "Department ID" },
  ],
  sections: [
    { key: "name", label: "Section name" },
    { key: "programId", label: "Program ID" },
    { key: "academicYearId", label: "Academic year ID" },
    { key: "capacity", label: "Capacity", numeric: true },
  ],
  "academic-years": [
    { key: "label", label: "Year label (e.g. 2026–2027)" },
    { key: "startsAt", label: "Start date (YYYY-MM-DD)", date: true },
    { key: "endsAt", label: "End date (YYYY-MM-DD)", date: true },
    { key: "current", label: "Current academic year", toggle: true },
  ],
  semesters: [
    { key: "name", label: "Semester name" },
    { key: "academicYearId", label: "Academic year ID" },
    { key: "startsAt", label: "Start date (YYYY-MM-DD)", date: true },
    { key: "endsAt", label: "End date (YYYY-MM-DD)", date: true },
    {
      key: "enrollmentStartsAt",
      label: "Enrollment opens at (YYYY-MM-DD)",
      date: true,
    },
    {
      key: "enrollmentEndsAt",
      label: "Enrollment closes at (YYYY-MM-DD)",
      date: true,
    },
    { key: "enrollmentOpen", label: "Enrollment open", toggle: true },
  ],
  subjects: [
    { key: "code", label: "Subject code" },
    { key: "name", label: "Subject name" },
    { key: "description", label: "Description" },
    { key: "units", label: "Units", numeric: true },
  ],
};
const academicTypes = Object.keys(fieldsByType);

export default function ManageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ panel?: string }>();
  const client = useQueryClient();
  const currentRole = useAuthStore((state) => state.user?.role);
  const superAdmin = currentRole === "super_admin";
  const institutionRole = currentRole === "administrator" || superAdmin;
  const [panel, setPanel] = useState<
    "people" | "institutions" | "academic" | "classes" | "system"
  >(() => (params.panel === "system" && institutionRole ? "system" : "people"));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState<Values["role"]>(
    superAdmin ? "administrator" : "faculty",
  );
  const [selectedInstitution, setSelectedInstitution] = useState("");
  const [search, setSearch] = useState("");
  const [peopleRole, setPeopleRole] = useState("all");
  const [institutionName, setInstitutionName] = useState("");
  const [institutionCode, setInstitutionCode] = useState("");
  const [institutionAddress, setInstitutionAddress] = useState("");
  const [editingInstitutionId, setEditingInstitutionId] = useState("");
  const [academicType, setAcademicType] = useState("subjects");
  const [academicValues, setAcademicValues] = useState<
    Record<string, string | boolean>
  >({ current: false, enrollmentOpen: true });
  const [academicBusy, setAcademicBusy] = useState(false);
  const [editingAcademicId, setEditingAcademicId] = useState("");
  const [archiveAcademicId, setArchiveAcademicId] = useState("");
  const [systemKey, setSystemKey] = useState("gradingPolicy");
  const [systemValue, setSystemValue] = useState(
    '{"decimals":2,"missingScorePolicy":"exclude"}',
  );
  const [loginOnly, setLoginOnly] = useState(false);
  const institutions = useQuery<Institution[]>({
    queryKey: ["institutions"],
    enabled: superAdmin,
    queryFn: async () =>
      (await api.get<{ items: Institution[] }>("/api/institutions")).data.items,
  });
  const people = useQuery<Person[]>({
    queryKey: ["users", search, peopleRole, selectedInstitution],
    queryFn: async () =>
      (
        await api.get<{ items: Person[] }>("/api/users", {
          params: {
            limit: 50,
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(peopleRole !== "all" ? { role: peopleRole } : {}),
            ...(superAdmin && selectedInstitution
              ? { institutionId: selectedInstitution }
              : {}),
          },
        })
      ).data.items,
  });
  const academic = useQuery<RecordItem[]>({
    queryKey: ["academic", academicType],
    enabled: institutionRole && panel === "academic",
    queryFn: async () =>
      (
        await api.get<{ items: RecordItem[] }>(`/api/${academicType}`, {
          params: { limit: 50 },
        })
      ).data.items,
  });
  const monitoredClasses = useQuery<ManagedOffering[]>({
    queryKey: ["class-offerings", "admin-monitor"],
    enabled: institutionRole && panel === "classes",
    queryFn: async () =>
      (
        await api.get<{ items: ManagedOffering[] }>("/api/class-offerings", {
          params: { limit: 50 },
        })
      ).data.items,
  });
  const academicEditGrant = useQuery<{ academicRecordEditingEnabled: boolean }>(
    {
      queryKey: ["academic-edit-grant"],
      enabled: currentRole === "administrator",
      queryFn: async () =>
        (
          await api.get<{ academicRecordEditingEnabled: boolean }>(
            "/api/system-settings",
          )
        ).data,
    },
  );
  const canEditAcademic =
    superAdmin || academicEditGrant.data?.academicRecordEditingEnabled === true;
  const settings = useQuery<Setting[]>({
    queryKey: ["system-settings"],
    enabled: institutionRole && panel === "system",
    queryFn: async () =>
      (await api.get<{ items: Setting[] }>("/api/system-settings")).data.items,
  });
  const auditLogs = useQuery<Audit[]>({
    queryKey: ["audit-logs", loginOnly],
    enabled: institutionRole && panel === "system",
    queryFn: async () =>
      (
        await api.get<{ items: Audit[] }>("/api/audit-logs", {
          params: { limit: 30, ...(loginOnly ? { action: "login" } : {}) },
        })
      ).data.items,
  });
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: superAdmin ? "administrator" : "faculty",
    },
  });
  const create = handleSubmit(async (values) => {
    setMessage("");
    setError("");
    try {
      const institutionId = superAdmin ? selectedInstitution : undefined;
      await api.post("/api/users", {
        ...values,
        role,
        ...(institutionId ? { institutionId } : {}),
      });
      setMessage(
        "Account created. Share the temporary credentials through a secure channel.",
      );
      reset({ name: "", email: "", password: "", role });
      await client.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Could not create account.",
      );
    }
  });
  const toggle = async (person: Person) => {
    setError("");
    try {
      await api.patch(`/api/users/${person._id}/status`, {
        active: !person.active,
      });
      await client.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Account status could not be changed.",
      );
    }
  };
  const createInstitution = async () => {
    if (!institutionName.trim() || !institutionCode.trim()) {
      setError("Institution name and code are required.");
      return;
    }
    setError("");
    try {
      const payload = {
        name: institutionName.trim(),
        code: institutionCode.trim(),
        address: institutionAddress.trim() || undefined,
      };
      if (editingInstitutionId)
        await api.put(`/api/institutions/${editingInstitutionId}`, payload);
      else await api.post("/api/institutions", payload);
      setInstitutionName("");
      setInstitutionCode("");
      setInstitutionAddress("");
      setMessage(
        editingInstitutionId
          ? "Institution details updated."
          : "Institution created.",
      );
      setEditingInstitutionId("");
      await client.invalidateQueries({ queryKey: ["institutions"] });
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Institution could not be saved.",
      );
    }
  };
  const createAcademic = async () => {
    const fields = fieldsByType[academicType];
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = academicValues[field.key];
      if (field.toggle) payload[field.key] = Boolean(value);
      else if (typeof value === "string" && value.trim())
        payload[field.key] = field.numeric
          ? Number(value)
          : field.date
            ? new Date(value).toISOString()
            : value.trim();
      else if (
        [
          "name",
          "code",
          "label",
          "departmentId",
          "programId",
          "academicYearId",
        ].includes(field.key)
      ) {
        setError(`${field.label} is required.`);
        return;
      }
    }
    if (superAdmin) {
      if (!selectedInstitution) {
        setError("Select the institution for this academic record first.");
        return;
      }
      if (!editingAcademicId) payload.institutionId = selectedInstitution;
    }
    setAcademicBusy(true);
    setError("");
    try {
      if (editingAcademicId)
        await api.put(`/api/${academicType}/${editingAcademicId}`, payload);
      else await api.post(`/api/${academicType}`, payload);
      setMessage(
        `${academicType.replaceAll("-", " ")} record ${editingAcademicId ? "updated" : "created"}.`,
      );
      setEditingAcademicId("");
      setAcademicValues({ current: false, enrollmentOpen: true });
      await client.invalidateQueries({ queryKey: ["academic", academicType] });
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ??
          "Record could not be saved. Check required relationship IDs.",
      );
    } finally {
      setAcademicBusy(false);
    }
  };
  const editAcademic = (item: RecordItem) => {
    const values: Record<string, string | boolean> = {};
    for (const field of fieldsByType[academicType]) {
      const raw = item[field.key];
      values[field.key] = field.toggle
        ? Boolean(raw)
        : field.date && raw
          ? new Date(String(raw)).toISOString().slice(0, 10)
          : raw === undefined
            ? ""
            : String(raw);
    }
    setEditingAcademicId(item._id);
    setAcademicValues(values);
    setError("");
    setMessage("");
  };
  const archiveAcademic = async (item: RecordItem) => {
    try {
      await api.delete(`/api/${academicType}/${item._id}`);
      setArchiveAcademicId("");
      setMessage(`${academicType.replaceAll("-", " ")} archived.`);
      await client.invalidateQueries({ queryKey: ["academic", academicType] });
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Record could not be archived.",
      );
    }
  };
  const saveSystemSetting = async () => {
    if (!systemKey.trim()) {
      setError("Enter a setting key.");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(systemValue);
    } catch {
      setError("Setting value must be valid JSON.");
      return;
    }
    setError("");
    try {
      await api.put(
        `/api/system-settings/${encodeURIComponent(systemKey.trim())}`,
        { value },
      );
      setMessage("System setting saved and audited.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["system-settings"] }),
        client.invalidateQueries({ queryKey: ["academic-edit-grant"] }),
      ]);
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Setting could not be saved.",
      );
    }
  };

  const [userEdit, setUserEdit] = useState<{
    id: string;
    name: string;
    email: string;
    institutionId: string;
    departmentId: string;
    programId: string;
    sectionId: string;
    studentNumber: string;
  } | null>(null);
  const [resetUserId, setResetUserId] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const beginUserEdit = async (person: Person) => {
    try {
      const item = (await api.get<{ item: Person }>(`/api/users/${person._id}`))
        .data.item;
      setUserEdit({
        id: person._id,
        name: item.name ?? "",
        email: item.email ?? "",
        institutionId: item.institutionId ?? "",
        departmentId: item.departmentId ?? "",
        programId: item.programId ?? "",
        sectionId: item.sectionId ?? "",
        studentNumber: item.studentNumber ?? "",
      });
      setMessage("");
      setError("");
    } catch {
      setError("Account details could not be loaded.");
    }
  };
  const saveUserEdit = async () => {
    if (!userEdit || userEdit.name.trim().length < 2) {
      setError("Enter a name of at least two characters.");
      return;
    }
    try {
      await api.put(`/api/users/${userEdit.id}`, {
        name: userEdit.name.trim(),
        ...(superAdmin
          ? {
              email: userEdit.email.trim(),
              institutionId: userEdit.institutionId || undefined,
            }
          : {}),
        departmentId: userEdit.departmentId.trim() || undefined,
        programId: userEdit.programId.trim() || undefined,
        sectionId: userEdit.sectionId.trim() || undefined,
        studentNumber: userEdit.studentNumber.trim() || undefined,
      });
      setUserEdit(null);
      setMessage("Account details updated and audited.");
      await client.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Account details could not be updated.",
      );
    }
  };
  const resetUserPassword = async () => {
    if (resetPasswordValue.length < 8) {
      setError("Use at least 8 characters for the temporary password.");
      return;
    }
    try {
      await api.patch(`/api/users/${resetUserId}/reset-password`, {
        password: resetPasswordValue,
      });
      setResetUserId("");
      setResetPasswordValue("");
      setMessage("Temporary password reset and audited. Share it securely.");
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Password could not be reset.",
      );
    }
  };
  const renderPerson = (person: Person) => (
    <View key={person._id} className="mb-2 rounded-xl bg-white p-4">
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="font-bold text-slate-900">{person.name}</Text>
          <Text className="mt-1 text-xs text-slate-500">
            {person.email} · {person.role.replaceAll("_", " ")}
            {person.studentNumber ? ` · ${person.studentNumber}` : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void toggle(person)}
          className={`rounded-full px-3 py-2 ${person.active ? "bg-emerald-50" : "bg-slate-100"}`}
        >
          <Text
            className={`text-xs font-bold ${person.active ? "text-emerald-700" : "text-slate-500"}`}
          >
            {person.active ? "Active" : "Inactive"}
          </Text>
        </TouchableOpacity>
      </View>
      <View className="mt-3 flex-row gap-4">
        <TouchableOpacity onPress={() => void beginUserEdit(person)}>
          <Text className="text-xs font-bold text-[#2563EB]">Edit account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setResetUserId(person._id);
            setResetPasswordValue("");
          }}
        >
          <Text className="text-xs font-bold text-amber-700">
            Reset password
          </Text>
        </TouchableOpacity>
      </View>
      {userEdit?.id === person._id ? (
        <View className="mt-3 rounded-xl bg-slate-50 p-3">
          {superAdmin ? (
            <>
              <TextInput
                value={userEdit.email}
                onChangeText={(email) =>
                  setUserEdit((state) => (state ? { ...state, email } : state))
                }
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Administrator email"
                className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
              />
              <Text className="mb-1 text-xs font-semibold text-slate-600">
                Assign institution
              </Text>
              {institutions.data?.map((institution) => (
                <TouchableOpacity
                  key={institution._id}
                  onPress={() =>
                    setUserEdit((state) =>
                      state
                        ? { ...state, institutionId: institution._id }
                        : state,
                    )
                  }
                  className={`mb-1 rounded-lg px-3 py-2.5 ${userEdit.institutionId === institution._id ? "bg-blue-100" : "bg-white"}`}
                >
                  <Text className="text-xs font-medium text-slate-700">
                    {institution.name}
                    {userEdit.institutionId === institution._id
                      ? " · Selected"
                      : ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : null}
          {(
            (superAdmin && person.role === "administrator"
              ? ["name"]
              : [
                  "name",
                  "departmentId",
                  "programId",
                  "sectionId",
                  "studentNumber",
                ]) as (keyof typeof userEdit)[]
          ).map((field) => (
            <TextInput
              key={field}
              value={userEdit[field]}
              onChangeText={(value) =>
                setUserEdit((state) =>
                  state ? { ...state, [field]: value } : state,
                )
              }
              placeholder={
                field === "name"
                  ? "Full name"
                  : `${field.replace("Id", " ID")} (optional)`
              }
              className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
            />
          ))}
          <View className="flex-row justify-end gap-4">
            <TouchableOpacity onPress={() => setUserEdit(null)}>
              <Text className="text-xs text-slate-500">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void saveUserEdit()}>
              <Text className="text-xs font-bold text-[#2563EB]">
                Save account
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {resetUserId === person._id ? (
        <View className="mt-3 rounded-xl bg-amber-50 p-3">
          <TextInput
            value={resetPasswordValue}
            onChangeText={setResetPasswordValue}
            secureTextEntry
            placeholder="New temporary password (8+ characters)"
            className="rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm"
          />
          <View className="mt-2 flex-row justify-end gap-4">
            <TouchableOpacity onPress={() => setResetUserId("")}>
              <Text className="text-xs text-slate-500">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void resetUserPassword()}>
              <Text className="text-xs font-bold text-amber-800">
                Set temporary password
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
  const visibleRoles: Values["role"][] = superAdmin
    ? ["administrator", "faculty", "student"]
    : ["faculty", "student"];
  const tabs: {
    key: "people" | "institutions" | "academic" | "classes" | "system";
    title: string;
  }[] = [
    { key: "people", title: "People" },
    ...(superAdmin
      ? [{ key: "institutions" as const, title: "Institutions" }]
      : []),
    ...(institutionRole
      ? [
          { key: "academic" as const, title: "Academic setup" },
          { key: "classes" as const, title: "Class monitor" },
          { key: "system" as const, title: "System & audit" },
        ]
      : []),
  ];
  if (!institutionRole)
    return (
      <View className="flex-1 items-center justify-center bg-[#F8FAFC] px-6">
        <Text className="text-lg font-bold text-[#142B4A]">
          Administrator access required
        </Text>
        <Text className="mt-2 text-center text-sm text-slate-500">
          Institution management is available only to Administrators and Super
          Admin.
        </Text>
      </View>
    );
  return (
    <ScrollView
      className="flex-1 bg-[#F8FAFC]"
      contentContainerStyle={{ padding: 20, paddingBottom: 34 }}
    >
      <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
        INSTITUTIONAL ADMIN
      </Text>
      <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
        Management
      </Text>
      <Text className="mt-2 text-sm text-slate-500">
        {superAdmin
          ? "Manage institutions, accounts and global academic structure."
          : "Manage people and academic records within your institution."}
      </Text>
      <View className="mt-4 flex-row flex-wrap gap-2">
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => {
              setPanel(tab.key);
              setMessage("");
              setError("");
            }}
            className={`rounded-full px-4 py-2.5 ${panel === tab.key ? "bg-[#142B4A]" : "bg-white"}`}
          >
            <Text
              className={`text-xs font-bold ${panel === tab.key ? "text-white" : "text-slate-600"}`}
            >
              {tab.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {superAdmin && ["people", "academic"].includes(panel) ? (
        <View className="mt-4 rounded-2xl bg-white p-4">
          <Text className="font-bold text-slate-900">Target institution</Text>
          <Text className="mt-1 text-xs text-slate-500">
            Choose an institution before assigning accounts or creating academic
            records; use All to search across institutions.
          </Text>
          <TouchableOpacity
            onPress={() => setSelectedInstitution("")}
            className={`mt-2 rounded-xl p-3 ${!selectedInstitution ? "bg-blue-50" : "bg-slate-50"}`}
          >
            <Text className="font-semibold text-slate-800">
              All institutions
            </Text>
          </TouchableOpacity>
          {institutions.data?.map((item) => (
            <TouchableOpacity
              key={item._id}
              onPress={() => {
                setSelectedInstitution(item._id);
                setValue("institutionId", item._id);
              }}
              className={`mt-2 rounded-xl p-3 ${selectedInstitution === item._id ? "bg-blue-50" : "bg-slate-50"}`}
            >
              <Text className="font-semibold text-slate-800">
                {item.name} · {item.code}
              </Text>
              <Text className="text-xs text-slate-500">
                ID {item._id} · {item.active ? "Active" : "Inactive"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {panel === "people" ? (
        <>
          <View className="mt-5 rounded-2xl bg-white p-4">
            <Text className="text-lg font-bold text-slate-900">
              Create an account
            </Text>
            <Text className="mb-3 mt-1 text-xs text-slate-500">
              Passwords are hashed with bcrypt; share temporary credentials
              securely.
            </Text>
            {(["name", "email", "password"] as const).map((field) => (
              <View key={field} className="mb-3">
                <Text className="mb-1 text-xs font-semibold capitalize text-slate-600">
                  {field === "password" ? "Temporary password" : field}
                </Text>
                <Controller
                  control={control}
                  name={field}
                  render={({ field: { value, onChange } }) => (
                    <TextInput
                      secureTextEntry={field === "password"}
                      autoCapitalize={field === "email" ? "none" : "words"}
                      keyboardType={
                        field === "email" ? "email-address" : "default"
                      }
                      value={value}
                      onChangeText={onChange}
                      placeholder={
                        field === "email"
                          ? "name@school.edu"
                          : field === "password"
                            ? "At least 8 characters"
                            : "Full name"
                      }
                      className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
                    />
                  )}
                />
                {errors[field] ? (
                  <Text className="mt-1 text-xs text-red-600">
                    {errors[field]?.message}
                  </Text>
                ) : null}
              </View>
            ))}
            <Text className="mb-2 text-xs font-semibold text-slate-600">
              Account role
            </Text>
            <View className="mb-4 flex-row gap-2">
              {visibleRoles.map((candidate) => (
                <TouchableOpacity
                  key={candidate}
                  onPress={() => {
                    setRole(candidate);
                    setValue("role", candidate);
                  }}
                  className={`rounded-full px-3 py-2 ${role === candidate ? "bg-[#142B4A]" : "bg-slate-100"}`}
                >
                  <Text
                    className={`text-xs font-semibold capitalize ${role === candidate ? "text-white" : "text-slate-600"}`}
                  >
                    {candidate}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {(
              [
                "departmentId",
                "programId",
                "sectionId",
                "studentNumber",
              ] as const
            ).map((field) => (
              <Controller
                key={field}
                control={control}
                name={field}
                render={({ field: { value, onChange } }) => (
                  <TextInput
                    value={value ?? ""}
                    onChangeText={onChange}
                    placeholder={`${field.replace("Id", " ID")} (optional)`}
                    className="mb-2 rounded-xl border border-slate-200 px-3 py-3 text-sm"
                  />
                )}
              />
            ))}
            {message ? (
              <Text className="mb-2 text-sm text-emerald-700">{message}</Text>
            ) : null}
            {error ? (
              <Text className="mb-2 text-sm text-rose-700">{error}</Text>
            ) : null}
            <Pressable
              onPress={create}
              disabled={isSubmitting}
              style={{
                backgroundColor: "#2563EB",
                borderRadius: 13,
                padding: 14,
                alignItems: "center",
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              <View className="flex-row items-center gap-2">
                {isSubmitting ? (
                  <ActivityIndicator color="white" size="small" />
                ) : null}
                <Text className="font-bold text-white">Create account</Text>
              </View>
            </Pressable>
          </View>
          <View className="mt-5">
            <Text className="mb-3 text-lg font-bold text-slate-900">
              Accounts
            </Text>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search names, email or student number"
              className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
            />
            <View className="mb-3 flex-row flex-wrap gap-2">
              {["all", "administrator", "faculty", "student"].map((value) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setPeopleRole(value)}
                  className={`rounded-full px-3 py-2 ${peopleRole === value ? "bg-[#142B4A]" : "bg-white"}`}
                >
                  <Text
                    className={`text-xs font-semibold capitalize ${peopleRole === value ? "text-white" : "text-slate-600"}`}
                  >
                    {value === "all" ? "All roles" : value.replaceAll("_", " ")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {people.isLoading ? <ActivityIndicator color="#2563EB" /> : null}
            {people.isError ? (
              <View className="rounded-xl bg-rose-50 p-4">
                <Text className="text-sm text-rose-700">
                  Could not load accounts.
                </Text>
              </View>
            ) : null}
            {people.data?.map(renderPerson)}
          </View>
        </>
      ) : null}
      {panel === "institutions" && superAdmin ? (
        <>
          <View className="mt-5 rounded-2xl bg-white p-4">
            <Text className="text-lg font-bold text-slate-900">
              Create institution
            </Text>
            <TextInput
              value={institutionName}
              onChangeText={setInstitutionName}
              placeholder="Institution name"
              className="mt-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={institutionCode}
              onChangeText={setInstitutionCode}
              placeholder="Unique institution code"
              autoCapitalize="characters"
              className="mt-2 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={institutionAddress}
              onChangeText={setInstitutionAddress}
              placeholder="Address (optional)"
              className="mt-2 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TouchableOpacity
              onPress={() => void createInstitution()}
              className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
            >
              <Text className="font-bold text-white">
                {editingInstitutionId
                  ? "Save institution"
                  : "Create institution"}
              </Text>
            </TouchableOpacity>
            {editingInstitutionId ? (
              <TouchableOpacity
                onPress={() => {
                  setEditingInstitutionId("");
                  setInstitutionName("");
                  setInstitutionCode("");
                  setInstitutionAddress("");
                }}
                className="mt-2 items-center py-2"
              >
                <Text className="text-sm text-slate-500">Cancel edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text className="mb-3 mt-6 text-lg font-bold text-slate-900">
            Institutions
          </Text>
          {institutions.isLoading ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            institutions.data?.map((item) => (
              <View key={item._id} className="mb-2 rounded-xl bg-white p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="font-bold text-slate-900">
                    {item.name} · {item.code}
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      void api
                        .patch(`/api/institutions/${item._id}/status`, {
                          active: !item.active,
                        })
                        .then(() =>
                          client.invalidateQueries({
                            queryKey: ["institutions"],
                          }),
                        )
                    }
                  >
                    <Text
                      className={`text-xs font-bold ${item.active ? "text-emerald-700" : "text-slate-500"}`}
                    >
                      {item.active
                        ? "Active · deactivate"
                        : "Inactive · activate"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text className="mt-1 text-[10px] text-slate-400">
                  {item._id}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditingInstitutionId(item._id);
                    setInstitutionName(item.name);
                    setInstitutionCode(item.code);
                    setInstitutionAddress(item.address ?? "");
                    setError("");
                  }}
                  className="mt-2 self-start"
                >
                  <Text className="text-xs font-bold text-[#2563EB]">
                    Edit details
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </>
      ) : null}
      {panel === "academic" ? (
        <>
          {!superAdmin && !canEditAcademic ? (
            <View className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Text className="font-bold text-amber-900">
                Read-only academic records
              </Text>
              <Text className="mt-1 text-sm leading-5 text-amber-800">
                A Super Admin must explicitly enable the global
                allowAcademicRecordEditing setting before Administrators can
                create, edit or archive academic records.
              </Text>
            </View>
          ) : null}
          {canEditAcademic ? (
            <View className="mt-5 rounded-2xl bg-white p-4">
              <Text className="text-lg font-bold text-slate-900">
                Academic structure
              </Text>
              <Text className="mt-1 text-xs leading-5 text-slate-500">
                Create a subject, department, program, section, academic year or
                semester. Use the record IDs below when linking dependent
                records and class offerings.
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-3"
              >
                {academicTypes.map((type) => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => {
                      setAcademicType(type);
                      setAcademicValues({
                        current: false,
                        enrollmentOpen: true,
                      });
                    }}
                    className={`mr-2 rounded-full px-3 py-2 ${academicType === type ? "bg-[#142B4A]" : "bg-slate-100"}`}
                  >
                    <Text
                      className={`text-xs font-semibold capitalize ${academicType === type ? "text-white" : "text-slate-600"}`}
                    >
                      {type.replaceAll("-", " ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {fieldsByType[academicType].map((field) => (
                <View key={field.key} className="mt-3">
                  {field.toggle ? (
                    <TouchableOpacity
                      onPress={() =>
                        setAcademicValues((state) => ({
                          ...state,
                          [field.key]: !Boolean(state[field.key]),
                        }))
                      }
                      className="flex-row items-center justify-between rounded-xl border border-slate-200 px-3 py-3"
                    >
                      <Text className="text-sm text-slate-700">
                        {field.label}
                      </Text>
                      <Text className="font-bold text-[#2563EB]">
                        {academicValues[field.key] ? "On" : "Off"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TextInput
                      value={String(academicValues[field.key] ?? "")}
                      onChangeText={(text) =>
                        setAcademicValues((state) => ({
                          ...state,
                          [field.key]: text,
                        }))
                      }
                      keyboardType={field.numeric ? "decimal-pad" : "default"}
                      placeholder={field.label}
                      className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
                    />
                  )}
                </View>
              ))}
              <View className="mt-4 flex-row gap-2">
                <TouchableOpacity
                  onPress={() => void createAcademic()}
                  disabled={academicBusy}
                  className="flex-1 items-center rounded-xl bg-[#2563EB] py-3"
                >
                  <Text className="font-bold text-white">
                    {academicBusy
                      ? "Saving…"
                      : `${editingAcademicId ? "Save" : "Create"} ${academicType.replaceAll("-", " ")}`}
                  </Text>
                </TouchableOpacity>
                {editingAcademicId ? (
                  <TouchableOpacity
                    onPress={() => {
                      setEditingAcademicId("");
                      setAcademicValues({
                        current: false,
                        enrollmentOpen: true,
                      });
                    }}
                    className="rounded-xl bg-slate-100 px-4 py-3"
                  >
                    <Text className="font-semibold text-slate-700">Cancel</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}
          <Text className="mb-3 mt-6 text-lg font-bold capitalize text-slate-900">
            Current {academicType.replaceAll("-", " ")}
          </Text>
          {academic.isLoading ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            academic.data?.map((item) => (
              <View key={item._id} className="mb-2 rounded-xl bg-white p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text className="font-bold text-slate-800">
                      {item.name ??
                        item.label ??
                        item.code ??
                        "Academic record"}
                    </Text>
                    <Text className="mt-1 text-[10px] text-slate-400">
                      ID {item._id}
                    </Text>
                  </View>
                  {canEditAcademic ? (
                    <TouchableOpacity
                      onPress={() => editAcademic(item)}
                      className="rounded-lg bg-blue-50 px-3 py-2"
                    >
                      <Text className="text-xs font-bold text-blue-700">
                        Edit
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {archiveAcademicId === item._id ? (
                  <View className="mt-3 flex-row items-center gap-3">
                    <Text className="flex-1 text-xs text-rose-700">
                      Archive this academic record?
                    </Text>
                    <TouchableOpacity
                      onPress={() => void archiveAcademic(item)}
                    >
                      <Text className="text-xs font-bold text-rose-700">
                        Confirm
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setArchiveAcademicId("")}>
                      <Text className="text-xs font-semibold text-slate-500">
                        Cancel
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : canEditAcademic ? (
                  <TouchableOpacity
                    onPress={() => setArchiveAcademicId(item._id)}
                    className="mt-2 self-end"
                  >
                    <Text className="text-xs font-semibold text-slate-500">
                      Archive
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View />
                )}
              </View>
            ))
          )}
        </>
      ) : null}
      {panel === "classes" && institutionRole ? (
        <>
          <View className="mt-5 rounded-2xl bg-white p-4">
            <Text className="text-lg font-bold text-slate-900">
              Class offerings
            </Text>
            <Text className="mt-1 text-xs leading-5 text-slate-500">
              Read-only institutional monitoring. Open a class to review the
              roster, published grades, activities and attendance without
              changing Faculty-owned records.
            </Text>
          </View>
          {monitoredClasses.isLoading ? (
            <ActivityIndicator className="mt-4" color="#2563EB" />
          ) : (
            monitoredClasses.data?.map((item) => (
              <TouchableOpacity
                key={item._id}
                onPress={() => router.push(`/class/${item._id}` as Href)}
                className="mt-3 rounded-2xl bg-white p-4"
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <Text className="font-bold text-slate-900">
                      {item.subjectId?.code ?? "SUBJECT"} ·{" "}
                      {item.subjectId?.name ?? "Class offering"}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {item.facultyId?.name ?? "Faculty not assigned"} ·{" "}
                      {item.sectionId?.name ?? "No section"}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {item.academicYearId?.label ?? "Academic year"} ·{" "}
                      {item.semesterId?.name ?? "Semester"}
                    </Text>
                  </View>
                  <Text className="text-xs font-bold text-[#2563EB]">
                    Open ›
                  </Text>
                </View>
                <Text className="mt-3 text-xs text-slate-600">
                  Approved roster: {item.approvedCount ?? 0}/
                  {item.capacity ?? "—"} · Enrollment{" "}
                  {item.enrollmentEnabled ? "open" : "closed"}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {item.schedule
                    ?.map(
                      (slot) =>
                        `${slot.day ?? "Class"} ${slot.startsAt ?? ""}–${slot.endsAt ?? ""}`,
                    )
                    .join(" · ") || "Schedule not set"}
                </Text>
              </TouchableOpacity>
            ))
          )}
          {!monitoredClasses.isLoading && !monitoredClasses.data?.length ? (
            <Text className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-500">
              No class offerings are available for this institution.
            </Text>
          ) : null}
        </>
      ) : null}
      {panel === "system" && institutionRole ? (
        <>
          <View className="mt-5 rounded-2xl bg-white p-4">
            <Text className="text-lg font-bold text-slate-900">
              System settings
            </Text>
            <Text className="mt-1 text-xs leading-5 text-slate-500">
              Set institution-scoped policies (Administrators) or global
              defaults (Super Admin). Values are JSON and updates are audited.
            </Text>
            {superAdmin ? (
              <Text className="mt-2 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                To explicitly grant or revoke Administrator academic-record
                editing, use key allowAcademicRecordEditing with JSON value true
                or false. Only Super Admin can change this global permission.
              </Text>
            ) : null}
            {settings.isLoading ? (
              <ActivityIndicator className="mt-3" color="#2563EB" />
            ) : (
              settings.data?.map((item) => (
                <View
                  key={item._id}
                  className="mt-3 flex-row items-center justify-between rounded-xl bg-slate-50 p-3"
                >
                  <View className="flex-1">
                    <Text className="font-bold text-slate-800">{item.key}</Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {JSON.stringify(item.value)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setSystemKey(item.key);
                      setSystemValue(JSON.stringify(item.value, null, 2));
                    }}
                    className="ml-2 rounded-lg bg-blue-50 px-3 py-2"
                  >
                    <Text className="text-xs font-bold text-blue-700">
                      Edit
                    </Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TextInput
              value={systemKey}
              onChangeText={setSystemKey}
              placeholder="Setting key (e.g. gradingPolicy)"
              className="mt-4 rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <TextInput
              value={systemValue}
              onChangeText={setSystemValue}
              placeholder="JSON setting value"
              multiline
              textAlignVertical="top"
              className="mt-2 min-h-24 rounded-xl border border-slate-200 px-3 py-3 font-mono text-xs"
            />
            <TouchableOpacity
              onPress={() => void saveSystemSetting()}
              className="mt-3 items-center rounded-xl bg-[#2563EB] py-3"
            >
              <Text className="font-bold text-white">Save setting</Text>
            </TouchableOpacity>
          </View>
          <View className="mt-4 rounded-2xl bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-slate-900">
                Audit & login activity
              </Text>
              <TouchableOpacity
                onPress={() => setLoginOnly((value) => !value)}
                className="rounded-full bg-blue-50 px-3 py-2"
              >
                <Text className="text-xs font-bold text-blue-700">
                  {loginOnly ? "Login only" : "All events"}
                </Text>
              </TouchableOpacity>
            </View>
            {auditLogs.isLoading ? (
              <ActivityIndicator className="mt-3" color="#2563EB" />
            ) : (
              auditLogs.data?.map((item) => (
                <View
                  key={item._id}
                  className="mt-3 border-t border-slate-100 pt-3"
                >
                  <Text className="font-semibold text-slate-800">
                    {item.action.replaceAll("_", " ")}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    {item.actorId?.name ?? item.actorId?.email ?? "System"}
                    {item.targetType ? ` · ${item.targetType}` : ""}
                    {item.createdAt
                      ? ` · ${new Date(item.createdAt).toLocaleString()}`
                      : ""}
                  </Text>
                </View>
              ))
            )}
            {!auditLogs.isLoading && !auditLogs.data?.length ? (
              <Text className="mt-3 text-sm text-slate-500">
                No audit events match this filter.
              </Text>
            ) : null}
          </View>
          <View className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <Text className="font-bold text-amber-900">
              Backup and recovery monitoring
            </Text>
            <Text className="mt-1 text-sm leading-5 text-amber-800">
              No backup provider or restore-verification monitor is configured
              in this deployment. Connect a MongoDB backup and recovery process
              before production use; this panel does not claim backups are
              running.
            </Text>
          </View>
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
        </>
      ) : null}
    </ScrollView>
  );
}
