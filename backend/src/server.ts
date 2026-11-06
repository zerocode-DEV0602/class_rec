import { startServer } from "./app";

startServer().catch((error: unknown) => {
  console.error(
    "[api] unable to start",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
