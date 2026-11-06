import * as SQLite from "expo-sqlite";
import { api } from "./api";

type CachedRecord = {
  id: string;
  collection: string;
  payload: string;
  updatedAt: string;
};
export type OfflineDraft = {
  id: string;
  kind: "attendance" | "score";
  payload: Record<string, unknown>;
  base_updated_at: string | null;
  created_at: string;
  sync_status: "pending" | "conflict" | "rejected" | "synced";
};
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
async function database(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync("classtrack.db").then(
    async (db) => {
      await db.execAsync(
        "CREATE TABLE IF NOT EXISTS cached_records (id TEXT NOT NULL, collection TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(id, collection)); CREATE TABLE IF NOT EXISTS offline_queue (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, base_updated_at TEXT, created_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'pending');",
      );
      return db;
    },
  );
  return databasePromise;
}
export async function cacheRecords(
  collection: string,
  rows: ({ id: string; updatedAt?: string } & Record<string, unknown>)[],
): Promise<void> {
  const db = await database();
  await db.withTransactionAsync(async () => {
    for (const row of rows)
      await db.runAsync(
        "INSERT OR REPLACE INTO cached_records (id, collection, payload, updated_at) VALUES (?, ?, ?, ?)",
        row.id,
        collection,
        JSON.stringify(row),
        row.updatedAt ?? new Date().toISOString(),
      );
  });
}
export async function readCachedRecords<T>(collection: string): Promise<T[]> {
  const db = await database();
  const rows = await db.getAllAsync<CachedRecord>(
    "SELECT id, collection, payload, updated_at AS updatedAt FROM cached_records WHERE collection = ? ORDER BY updated_at DESC",
    collection,
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload) as T];
    } catch {
      return [];
    }
  });
}
export async function cacheAndReadRecords<T>(
  collection: string,
  fetchRows: () => Promise<
    ({ id: string; updatedAt?: string } & Record<string, unknown>)[]
  >,
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
  const db = await database();
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    "INSERT INTO offline_queue (id, kind, payload, base_updated_at, created_at, sync_status) VALUES (?, ?, ?, ?, ?, 'pending')",
    id,
    kind,
    JSON.stringify(payload),
    baseUpdatedAt ?? null,
    new Date().toISOString(),
  );
  return id;
}
export async function listOfflineChanges(): Promise<OfflineDraft[]> {
  const db = await database();
  const rows = await db.getAllAsync<
    Omit<OfflineDraft, "payload"> & { payload: string }
  >(
    "SELECT id, kind, payload, base_updated_at, created_at, sync_status FROM offline_queue WHERE sync_status IN ('pending','conflict','rejected') ORDER BY created_at ASC",
  );
  return rows.flatMap((row) => {
    try {
      return [
        {
          ...row,
          kind: row.kind as OfflineDraft["kind"],
          sync_status: row.sync_status as OfflineDraft["sync_status"],
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        },
      ];
    } catch {
      return [];
    }
  });
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
  const db = await database();
  return db.getAllAsync(
    "SELECT id, kind, payload, base_updated_at, created_at, sync_status FROM offline_queue WHERE sync_status = 'pending' ORDER BY created_at ASC",
  );
}
export async function markOfflineChange(
  id: string,
  status: "synced" | "conflict" | "rejected",
): Promise<void> {
  const db = await database();
  await db.runAsync(
    "UPDATE offline_queue SET sync_status = ? WHERE id = ?",
    status,
    id,
  );
}
export async function discardOfflineChange(id: string): Promise<void> {
  const db = await database();
  await db.runAsync("DELETE FROM offline_queue WHERE id = ?", id);
}
export async function synchronizeOfflineChanges(): Promise<{
  synced: number;
  conflicts: number;
  rejected: number;
}> {
  const pending = await pendingOfflineChanges();
  if (!pending.length) return { synced: 0, conflicts: 0, rejected: 0 };
  const changes = pending.map((row) => ({
    id: row.id,
    kind: row.kind,
    baseUpdatedAt: row.base_updated_at,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }));
  const response = await api.post<{
    results: {
      id: string;
      status: "synced" | "conflict" | "rejected";
    }[];
  }>("/api/offline-sync", { changes });
  let synced = 0;
  let conflicts = 0;
  let rejected = 0;
  for (const result of response.data.results) {
    await markOfflineChange(result.id, result.status);
    if (result.status === "synced") synced += 1;
    else if (result.status === "conflict") conflicts += 1;
    else rejected += 1;
  }
  return { synced, conflicts, rejected };
}
