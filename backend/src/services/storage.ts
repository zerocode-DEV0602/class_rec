import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import mongoose from "mongoose";

export type UploadedFile = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
};
const BUCKET_NAME = "class_files";

function makeKey(): string {
  return `file_${randomUUID().replaceAll("-", "")}`;
}
function bucket() {
  const db = mongoose.connection.db;
  if (!db || mongoose.connection.readyState !== 1)
    throw new Error("MongoDB must be connected before storing files.");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

export function hasSupportedSignature(
  buffer: Buffer,
  mimeType: string,
): boolean {
  if (mimeType === "application/pdf")
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg")
    return (
      buffer.length > 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  if (mimeType === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return (
      buffer.subarray(0, 4).toString("hex") === "504b0304" &&
      buffer.includes(Buffer.from("word/document.xml"))
    );
  return false;
}

export async function storeFile(file: {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}): Promise<UploadedFile> {
  const key = makeKey();
  const upload = bucket().openUploadStream(key, {
    contentType: file.mimetype,
    metadata: {
      key,
      originalName: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      size: file.size,
    },
  });
  await new Promise<void>((resolve, reject) => {
    upload.once("finish", resolve);
    upload.once("error", reject);
    Readable.from([file.buffer]).pipe(upload);
  });
  return {
    key,
    name: file.originalname.slice(0, 255),
    mimeType: file.mimetype,
    size: file.size,
  };
}

export async function readStoredFile(
  key: string,
): Promise<{ body: Readable; mimeType: string; size?: number }> {
  if (!/^file_[a-f0-9]{32}$/.test(key))
    throw new Error("Invalid file reference.");
  const files = await bucket().find({ filename: key }).limit(1).toArray();
  const file = files[0];
  if (!file) throw new Error("Stored file was not found.");
  const metadata = file.metadata as { mimeType?: string } | undefined;
  return {
    body: bucket().openDownloadStream(file._id),
    mimeType:
      metadata?.mimeType ?? file.contentType ?? "application/octet-stream",
    size: file.length,
  };
}

export async function storedFileExists(key: string): Promise<boolean> {
  if (!/^file_[a-f0-9]{32}$/.test(key)) return false;
  try {
    return (
      (
        await bucket()
          .find({ filename: key })
          .project({ _id: 1 })
          .limit(1)
          .toArray()
      ).length > 0
    );
  } catch {
    return false;
  }
}
