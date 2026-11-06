import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../services/api";
import { getMessageSocket } from "../services/socket";
import { useAuthStore } from "../store/auth";
type Message = {
  _id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt?: string;
};
export default function MessagesScreen() {
  const params = useLocalSearchParams<{
    peerId?: string;
    peerName?: string;
    offeringId?: string;
  }>();
  const currentUser = useAuthStore((state) => state.user);
  const peerId = typeof params.peerId === "string" ? params.peerId : "";
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const query = useQuery<Message[]>({
    queryKey: ["messages", peerId],
    enabled: Boolean(peerId),
    queryFn: async () =>
      (
        await api.get<{ items: Message[] }>("/api/messages", {
          params: { peerId },
        })
      ).data.items,
  });
  useEffect(() => {
    if (!peerId) return;
    const socket = getMessageSocket();
    if (!socket) return;
    const onNew = (message: Message) => {
      if (message.senderId === peerId || message.recipientId === peerId)
        void client.invalidateQueries({ queryKey: ["messages", peerId] });
    };
    socket.on("message:new", onNew);
    return () => {
      socket.off("message:new", onNew);
    };
  }, [client, peerId]);
  const send = async () => {
    const text = body.trim();
    if (!text || !peerId || sending) return;
    setSending(true);
    setError("");
    try {
      const socket = getMessageSocket();
      if (socket?.connected)
        await new Promise<void>((resolve, reject) =>
          socket.emit(
            "message:send",
            { recipientId: peerId, body: text, offeringId: params.offeringId },
            (result: { ok: boolean; error?: string }) =>
              result.ok
                ? resolve()
                : reject(new Error(result.error ?? "Message failed.")),
          ),
        );
      else
        await api.post("/api/messages", {
          recipientId: peerId,
          body: text,
          offeringId: params.offeringId,
        });
      setBody("");
      await client.invalidateQueries({ queryKey: ["messages", peerId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]" edges={["top"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="border-b border-slate-100 bg-white px-5 py-4">
          <Text className="text-xs font-bold uppercase tracking-widest text-[#2563EB]">
            MESSAGES
          </Text>
          <Text className="mt-1 text-xl font-extrabold text-[#142B4A]">
            {params.peerName ?? "Direct conversation"}
          </Text>
        </View>
        {!peerId ? (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-center text-lg font-bold text-[#142B4A]">
              Choose a conversation from your class
            </Text>
            <Text className="mt-2 text-center text-sm text-slate-500">
              Messages are limited to members of the same institution and class.
            </Text>
          </View>
        ) : (
          <>
            <ScrollView
              className="flex-1 px-4"
              contentContainerStyle={{ paddingVertical: 16 }}
            >
              {query.isLoading ? (
                <ActivityIndicator color="#2563EB" />
              ) : query.data?.length ? (
                query.data.map((message) => {
                  const mine = message.senderId === currentUser?.id;
                  return (
                    <View
                      key={message._id}
                      className={`mb-3 max-w-[84%] rounded-2xl p-3 ${mine ? "self-end bg-[#2563EB]" : "self-start border border-slate-100 bg-white"}`}
                    >
                      <Text
                        className={`text-sm leading-5 ${mine ? "text-white" : "text-slate-800"}`}
                      >
                        {message.body}
                      </Text>
                      <Text
                        className={`mt-1 text-[10px] ${mine ? "text-blue-100" : "text-slate-400"}`}
                      >
                        {message.createdAt
                          ? new Date(message.createdAt).toLocaleString()
                          : "Just now"}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text className="mt-6 text-center text-sm text-slate-500">
                  Start the conversation with a class question.
                </Text>
              )}
            </ScrollView>
            <View className="border-t border-slate-100 bg-white p-3">
              <View className="flex-row items-end gap-2">
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  multiline
                  placeholder="Write a message…"
                  className="max-h-28 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm"
                />
                <TouchableOpacity
                  onPress={() => void send()}
                  disabled={sending || !body.trim()}
                  className="rounded-xl bg-[#2563EB] px-4 py-3"
                >
                  <Text className="font-bold text-white">
                    {sending ? "…" : "Send"}
                  </Text>
                </TouchableOpacity>
              </View>
              {error ? (
                <Text className="mt-2 text-xs text-rose-600">{error}</Text>
              ) : null}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
