import { api } from "./api";

export type OfflineDraft = {
  id: string;
  kind: "attendance" | "score";
  payload: Record<string, unknown>;
  base_updated_at: string | null;
  created_at: string;
  sync_status: "pending" | "conflict" | "rejected" | "synced";
};
type CachedRow = Record<string, unknown> & { id: string; updatedAt?: string };
const records = new Map<string, CachedRow[]>();
const queue: OfflineDraft[] = [];
let queueTail = Promise.resolve();
function serialize<T>(work: () => T | Promise<T>): Promise<T> {
  const next = queueTail.then(work);
  queueTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
export async function cacheRecords(
  collection: string,
  rows: CachedRow[],
): Promise<void> {
  records.set(
    collection,
    rows.map((row) => ({ ...row })),
  );
}
export async function readCachedRecords<T>(collection: string): Promise<T[]> {
  return (records.get(collection) ?? []) as T[];
}
export async function cacheAndReadRecords<T>(
  collection: string,
  fetchRows: () => Promise<CachedRow[]>,
): Promise<T[]> {
  try {
    const rows = await fetchRows();
    await cacheRecords(collection, rows);
    return rows as T[];
  } catch {
    return readCachedRecords<T>(collection);
  }
}
export async function queueOfflineChange(
  kind: "attendance" | "score",
  payload: Record<string, unknown>,
  baseUpdatedAt?: string,
): Promise<string> {
  return serialize(() => {
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    queue.push({
      id,
      kind,
      payload: { ...payload },
      base_updated_at: baseUpdatedAt ?? null,
      created_at: new Date().toISOString(),
      sync_status: "pending",
    });
    return id;
  });
}
export async function listOfflineChanges(): Promise<OfflineDraft[]> {
  return serialize(() =>
    queue
      .filter((draft) => draft.sync_status !== "synced")
      .map((draft) => ({ ...draft, payload: { ...draft.payload } })),
  );
}
export async function pendingOfflineChanges(): Promise<
  {
    id: string;
    kind: string;
    payload: string;
    base_updated_at: string | null;
    created_at: string;
    sync_status: string;
  }[]
> {
  return serialize(() =>
    queue
      .filter((draft) => draft.sync_status === "pending")
      .map((draft) => ({ ...draft, payload: JSON.stringify(draft.payload) })),
  );
}
export async function markOfflineChange(
  id: string,
  status: "synced" | "conflict" | "rejected",
): Promise<void> {
  await serialize(() => {
    const draft = queue.find((item) => item.id === id);
    if (draft) draft.sync_status = status;
  });
}
export async function discardOfflineChange(id: string): Promise<void> {
  await serialize(() => {
    const index = queue.findIndex((draft) => draft.id === id);
    if (index >= 0) queue.splice(index, 1);
  });
}
export async function synchronizeOfflineChanges(): Promise<{
  synced: number;
  conflicts: number;
  rejected: number;
}> {
  const pending = await pendingOfflineChanges();
  if (!pending.length) return { synced: 0, conflicts: 0, rejected: 0 };
  const response = await api.post<{
    results: { id: string; status: "synced" | "conflict" | "rejected" }[];
  }>("/api/offline-sync", {
    changes: pending.map((row) => ({
      id: row.id,
      kind: row.kind,
      baseUpdatedAt: row.base_updated_at,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    })),
  });
  const counts = { synced: 0, conflicts: 0, rejected: 0 };
  for (const result of response.data.results) {
    await markOfflineChange(result.id, result.status);
    if (result.status === "synced") counts.synced += 1;
    else if (result.status === "conflict") counts.conflicts += 1;
    else counts.rejected += 1;
  }
  return counts;
}
