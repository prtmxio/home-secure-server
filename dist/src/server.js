"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = require("./app");
const database_1 = require("./config/database");
const env_1 = require("./config/env");
const hub_control_ws_1 = require("./modules/device-control/hub-control-ws");
const live_feed_server_1 = require("./modules/live-feed/live-feed.server");
async function bootstrap() {
    await (0, database_1.connectDatabase)(env_1.env.mongodbUri, { allowMemoryFallback: env_1.env.nodeEnv === "development" });
    const realtimeServices = (0, app_1.createRealtimeServices)();
    const app = (0, app_1.createApp)(env_1.env, realtimeServices);
    const server = http_1.default.createServer(app);
    (0, hub_control_ws_1.attachHubControlWebSocket)(server, env_1.env, realtimeServices.doorLockService, realtimeServices.ingestHubEvent);
    (0, live_feed_server_1.attachLiveFeedServer)(server, env_1.env, {
        isDeviceConnected: hub_control_ws_1.isHubControlConnected,
        sendToDevice: hub_control_ws_1.sendLiveFeedSignalToHub,
    });
    server.listen(env_1.env.port, () => {
        console.log(`Glazia Home Secure server listening on port ${env_1.env.port}`);
    });
}
void bootstrap().catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
});
