import http from "http";
import { createApp, createRealtimeServices } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";
import { attachHubCameraWebSocket } from "./modules/camera/camera-media-ws";
import { attachHubControlWebSocket } from "./modules/device-control/hub-control-ws";

async function bootstrap(): Promise<void> {
  await connectDatabase(env.mongodbUri);

  const realtimeServices = createRealtimeServices();
  const app = createApp(env, realtimeServices);
  const server = http.createServer(app);
  attachHubControlWebSocket(server, env, realtimeServices.doorLockService);
  attachHubCameraWebSocket(server, env, realtimeServices.cameraRelay);

  server.listen(env.port, () => {
    console.log(`Glazia Home Secure server listening on port ${env.port}`);
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
