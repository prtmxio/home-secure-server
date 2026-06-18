"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHubControlConnected = isHubControlConnected;
exports.sendLiveFeedSignalToHub = sendLiveFeedSignalToHub;
exports.sendHubControlMessage = sendHubControlMessage;
exports.sendCameraStreamCommandForHome = sendCameraStreamCommandForHome;
exports.attachHubControlWebSocket = attachHubControlWebSocket;
const ws_1 = require("ws");
const hub_model_1 = require("../hubs/hub.model");
const live_feed_server_1 = require("../live-feed/live-feed.server");
const CONTROL_WS_PATH = "/api/device/hubs/control/ws";
const socketsByHubId = new Map();
function isHubControlConnected(hubId) {
    return socketsByHubId.get(hubId)?.socket.readyState === ws_1.WebSocket.OPEN;
}
function sendLiveFeedSignalToHub(hubId, payload) {
    return sendHubControlMessage(hubId, payload, "Live feed signal");
}
function sendHubControlMessage(hubId, payload, label = "Hub command") {
    const hubSocket = socketsByHubId.get(hubId);
    if (!hubSocket || hubSocket.socket.readyState !== ws_1.WebSocket.OPEN) {
        console.warn(`[HUB_WS] ${label} not sent hub=${hubId} reason=no_control_socket`);
        return false;
    }
    hubSocket.socket.send(JSON.stringify(payload));
    return true;
}
async function sendCameraStreamCommandForHome(homeId, action, streamSessionId = "") {
    const hub = await hub_model_1.HubModel.findOne({ home: homeId });
    if (!hub) {
        console.warn(`[HUB_WS] Camera command not sent action=${action} home=${homeId} reason=hub_not_found`);
        return false;
    }
    const hubSocket = socketsByHubId.get(hub.id);
    if (!hubSocket) {
        console.warn(`[HUB_WS] Camera command not sent action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} reason=no_control_socket`);
        return false;
    }
    if (hubSocket.socket.readyState !== ws_1.WebSocket.OPEN) {
        console.warn(`[HUB_WS] Camera command not sent action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} socket_state=${hubSocket.socket.readyState}`);
        return false;
    }
    try {
        hubSocket.socket.send(JSON.stringify({
            type: "camera_stream_command",
            action,
            streamSessionId,
        }));
        console.info(`[HUB_WS] Camera command sent action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} stream_session=${streamSessionId.slice(0, 8) || "none"}`);
    }
    catch (error) {
        console.warn(`[HUB_WS] Camera command send failed action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} error=${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    return true;
}
function attachHubControlWebSocket(server, config, doorLockService) {
    const wss = new ws_1.WebSocketServer({ noServer: true });
    doorLockService.onCommand((command) => {
        const hubSocket = socketsByHubId.get(command.hubId);
        if (hubSocket?.socket.readyState === ws_1.WebSocket.OPEN) {
            void doorLockService.markDelivered(command.id, command.hubId).then((deliveredCommand) => {
                if (hubSocket.socket.readyState === ws_1.WebSocket.OPEN) {
                    sendCommand(hubSocket.socket, deliveredCommand);
                }
            }).catch(() => undefined);
        }
    });
    server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url || "", "http://localhost");
        if (url.pathname !== CONTROL_WS_PATH)
            return;
        const deviceApiKey = request.headers["x-device-api-key"];
        if (deviceApiKey !== config.deviceApiKey) {
            console.warn("[HUB_WS] Rejected control websocket: invalid device API key");
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
        const hubMacAddress = String(request.headers["x-hub-mac-address"] || "");
        const hubSecret = String(request.headers["x-hub-secret"] || "");
        void doorLockService
            .authenticateHub({ hubMacAddress, hubSecret })
            .then((hub) => {
            wss.handleUpgrade(request, socket, head, (ws) => {
                const hubId = hub.id;
                const existingSocket = socketsByHubId.get(hubId);
                if (existingSocket) {
                    console.warn(`[HUB_WS] Replacing existing control websocket hub=${hubId} mac=${hubMacAddress}`);
                    existingSocket.socket.close(4000, "Replaced by a new control connection");
                }
                socketsByHubId.set(hubId, { hubId, hubMacAddress, socket: ws });
                console.info(`[HUB_WS] Control websocket connected hub=${hubId} mac=${hubMacAddress}`);
                (0, live_feed_server_1.broadcastLiveFeedStatus)(hubId, "live");
                ws.on("message", (data) => {
                    void handleHubMessage(doorLockService, hubId, ws, data);
                });
                ws.on("close", (code, reason) => {
                    console.info(`[HUB_WS] Control websocket closed hub=${hubId} mac=${hubMacAddress} code=${code} reason=${reason.toString()}`);
                    if (socketsByHubId.get(hubId)?.socket === ws) {
                        socketsByHubId.delete(hubId);
                        (0, live_feed_server_1.broadcastLiveFeedStatus)(hubId, "offline");
                    }
                });
                ws.send(JSON.stringify({ type: "ready" }));
                void doorLockService.getQueuedForHub(hubId).then((command) => {
                    if (command && ws.readyState === ws_1.WebSocket.OPEN)
                        sendCommand(ws, command);
                });
            });
        })
            .catch(() => {
            console.warn(`[HUB_WS] Rejected control websocket: auth failed mac=${hubMacAddress}`);
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
        });
    });
    return wss;
}
function sendCommand(socket, command) {
    socket.send(JSON.stringify({
        type: "door_lock_command",
        commandId: command.id,
        mode: command.mode,
        action: command.action,
        durationMs: command.durationMs,
    }));
}
async function handleHubMessage(doorLockService, hubId, socket, data) {
    let message;
    try {
        message = JSON.parse(data.toString());
    }
    catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
        return;
    }
    if (message.type === "camera_stream_status") {
        console.info(`[HUB_WS] Camera status hub=${hubId} stream_session=${String(message.streamSessionId || "").slice(0, 8) || "none"} status=${String(message.status || "unknown")}${message.error ? ` error=${String(message.error)}` : ""}`);
        return;
    }
    if (message.type === "offer" || message.type === "ice-candidate") {
        (0, live_feed_server_1.sendLiveFeedSignalToViewers)(hubId, { ...message, hubId });
        return;
    }
    if (message.type !== "door_lock_ack") {
        return;
    }
    try {
        const command = await doorLockService.ackHubCommand(hubId, {
            commandId: String(message.commandId || ""),
            status: message.status === "failed" ? "failed" : "executed",
            lockState: message.lockState === "locked" || message.lockState === "unlocked"
                ? message.lockState
                : undefined,
            error: typeof message.error === "string" ? message.error : undefined,
        });
        socket.send(JSON.stringify({ type: "door_lock_ack_received", commandId: command.id, status: command.status }));
    }
    catch (error) {
        socket.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "ACK failed" }));
    }
}
