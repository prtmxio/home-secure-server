import http from "http";
import { createApp, createRealtimeServices } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";
import {
  attachHubControlWebSocket,
  isHubControlConnected,
  sendLiveFeedSignalToHub,
} from "./modules/device-control/hub-control-ws";
import { attachLiveFeedServer } from "./modules/live-feed/live-feed.server";

async function bootstrap(): Promise<void> {
  await connectDatabase(env.mongodbUri, { allowMemoryFallback: env.nodeEnv === "development" });

  const realtimeServices = createRealtimeServices();
  const app = createApp(env, realtimeServices);
  const server = http.createServer(app);

  attachHubControlWebSocket(
    server,
    env,
    realtimeServices.doorLockService,
    realtimeServices.ingestHubEvent,
    realtimeServices.cameraRelay,
  );
  attachLiveFeedServer(server, env, {
    isDeviceConnected: isHubControlConnected,
    sendToDevice: sendLiveFeedSignalToHub,
  });

  server.listen(env.port, () => {
    console.log(`Glazia Home Secure server listening on port ${env.port}`);
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
