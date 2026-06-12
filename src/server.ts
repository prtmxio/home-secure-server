import { createServer } from "http";
import { createApp } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";
import { attachLiveFeedServer } from "./modules/live-feed/live-feed.server";

async function bootstrap(): Promise<void> {
  await connectDatabase(env.mongodbUri, { allowMemoryFallback: env.nodeEnv === "development" });

  const app = createApp(env);
  const server = createServer(app);
  attachLiveFeedServer(server, env);

  server.listen(env.port, () => {
    console.log(`Glazia Home Secure server listening on port ${env.port}`);
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
