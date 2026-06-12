"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const app_1 = require("./app");
const database_1 = require("./config/database");
const env_1 = require("./config/env");
const live_feed_server_1 = require("./modules/live-feed/live-feed.server");
async function bootstrap() {
    await (0, database_1.connectDatabase)(env_1.env.mongodbUri, { allowMemoryFallback: env_1.env.nodeEnv === "development" });
    const app = (0, app_1.createApp)(env_1.env);
    const server = (0, http_1.createServer)(app);
    (0, live_feed_server_1.attachLiveFeedServer)(server, env_1.env);
    server.listen(env_1.env.port, () => {
        console.log(`Glazia Home Secure server listening on port ${env_1.env.port}`);
    });
}
void bootstrap().catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
});
