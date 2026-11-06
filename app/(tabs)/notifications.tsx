import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { api } from "../../services/api";
type Notice = {
  _id: string;
  title: string;
  body: string;
  kind: string;
  readAt?: string;
  createdAt?: string;
};
export default function NotificationsScreen() {
  const client = useQueryClient();
  const query = useQuery<Notice[]>({
    queryKey: ["notifications"],
    queryFn: async () =>
      (await api.get<{ items: Notice[] }>("/api/notifications")).data.items,
  });
  const markRead = async (id: string) => {
    await api.patch(`/api/notifications/${id}/read`);
    await client.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <ScrollView
      className="flex-1 bg-[#F8FAFC]"
      contentContainerStyle={{ padding: 20, paddingBottom: 30 }}
    >
      <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
        UPDATES
      </Text>
      <Text className="mt-1 text-2xl font-extrabold text-[#142B4A]">
        Notifications
      </Text>
      <Text className="mt-2 text-sm text-slate-500">
        Important class activity and academic updates.
      </Text>
      {query.isLoading
        ? [1, 2, 3].map((n) => (
            <View key={n} className="mt-3 h-20 rounded-xl bg-slate-200" />
          ))
        : null}
      {query.data?.length
        ? query.data.map((notice) => (
            <TouchableOpacity
              key={notice._id}
              onPress={() => !notice.readAt && void markRead(notice._id)}
              className={`mt-3 rounded-2xl border p-4 ${notice.readAt ? "border-slate-100 bg-white" : "border-blue-100 bg-blue-50"}`}
            >
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 font-bold text-slate-900">
                  {notice.title}
                </Text>
                {!notice.readAt && (
                  <View className="ml-2 h-2 w-2 rounded-full bg-[#2563EB]" />
                )}
              </View>
              <Text className="mt-1 text-sm leading-5 text-slate-600">
                {notice.body}
              </Text>
              <Text className="mt-2 text-[11px] uppercase tracking-wide text-slate-400">
                {notice.kind.replaceAll("_", " ")}
                {notice.createdAt
                  ? ` · ${new Date(notice.createdAt).toLocaleDateString()}`
                  : ""}
              </Text>
            </TouchableOpacity>
          ))
        : null}
      {!query.isLoading && !query.data?.length ? (
        <View className="mt-6 items-center rounded-2xl bg-white p-7">
          <Text className="font-bold text-[#142B4A]">You’re all caught up</Text>
          <Text className="mt-2 text-sm text-slate-500">
            New academic updates will appear here.
          </Text>
        </View>
      ) : null}
      {query.isError ? (
        <View className="mt-4 rounded-xl bg-rose-50 p-4">
          <Text className="text-sm text-rose-700">
            Couldn’t load notifications. Check your connection and retry.
          </Text>
          <TouchableOpacity onPress={() => void query.refetch()}>
            <Text className="mt-2 font-semibold text-[#2563EB]">Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}
