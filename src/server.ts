import { createApp } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  await connectDatabase(env.mongodbUri);

  const app = createApp(env);
  app.listen(env.port, () => {
    console.log(`Glazia Home Secure server listening on port ${env.port}`);
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
