import "dotenv/config";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { User } from "../models/index";

async function seed(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!uri || !email || !password)
    throw new Error(
      "Set MONGODB_URI, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD before seeding.",
    );
  if (password.length < 12)
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
  await mongoose.connect(uri);
  const exists = await User.exists({ email: email.toLowerCase() });
  if (exists)
    throw new Error(
      "A user with SEED_ADMIN_EMAIL already exists; refusing to overwrite it.",
    );
  await User.create({
    name: "System Administrator",
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    role: "super_admin",
    active: true,
  });
  console.info("Created the initial Super Admin account.");
  await mongoose.disconnect();
}
seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed failed.");
  process.exitCode = 1;
});
