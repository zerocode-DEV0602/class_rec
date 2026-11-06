import mongoose from "mongoose";

export async function connectDatabase(
  uri = process.env.MONGODB_URI,
): Promise<boolean> {
  if (!uri) {
    console.warn(
      "[database] MONGODB_URI is not configured; database-backed endpoints will be unavailable.",
    );
    return false;
  }
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: process.env.NODE_ENV !== "production",
  });
  console.info("[database] MongoDB connection established");
  return true;
}

export function databaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
