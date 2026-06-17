"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachLiveFeedServer = attachLiveFeedServer;
exports.broadcastLiveFeedStatus = broadcastLiveFeedStatus;
exports.sendLiveFeedSignalToViewers = sendLiveFeedSignalToViewers;
const ws_1 = require("ws");
const api_error_1 = require("../../common/errors/api-error");
const jwt_1 = require("../../common/utils/jwt");
const hub_model_1 = require("../hubs/hub.model");
const viewersByHub = new Map();
const clients = new Map();
function attachLiveFeedServer(server, config, options = {}) {
    const wss = new ws_1.WebSocketServer({ noServer: true, maxPayload: 1_500_000 });
    server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        if (url.pathname !== "/ws/live-feed") {
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    });
    wss.on("connection", (socket, request) => {
        void handleConnection(socket, request, config, options);
    });
}
async function handleConnection(socket, request, config, options) {
    try {
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        const role = url.searchParams.get("role");
        if (role === "device") {
            throw new api_error_1.ApiError(400, "Hub live feed signaling must use /api/device/hubs/control/ws");
        }
        if (url.searchParams.get("mode") !== "webrtc") {
            throw new api_error_1.ApiError(400, "Live feed requires mode=webrtc");
        }
        if (role === "viewer") {
            const hubId = await authenticateViewer(url, config);
            registerViewer(socket, hubId, options);
            return;
        }
        throw new api_error_1.ApiError(400, "Invalid live feed role");
    }
    catch (error) {
        sendJson(socket, {
            type: "error",
            message: error instanceof api_error_1.ApiError ? error.message : "Live feed connection failed",
        });
        socket.close(1008);
    }
}
async function authenticateViewer(url, config) {
    const token = url.searchParams.get("token") || "";
    const hubId = url.searchParams.get("hubId") || "";
    if (!token || !hubId) {
        throw new api_error_1.ApiError(401, "Viewer token and hubId are required");
    }
    const payload = (0, jwt_1.verifyUserToken)(token, config.jwtSecret);
    if (payload.type !== "user") {
        throw new api_error_1.ApiError(401, "Invalid token type");
    }
    const hub = await hub_model_1.HubModel.findOne({ _id: hubId, owner: payload.sub });
    if (!hub) {
        throw new api_error_1.ApiError(404, "Hub not found for this user");
    }
    return hub.id;
}
function registerViewer(socket, hubId, options) {
    clients.set(socket, { hubId, socket });
    const viewers = viewersByHub.get(hubId) || new Set();
    viewers.add(socket);
    viewersByHub.set(hubId, viewers);
    sendJson(socket, {
        type: "ready",
        role: "viewer",
        hubId,
        mode: "webrtc",
        status: options.isDeviceConnected?.(hubId) ? "live" : "waiting",
    });
    options.sendToDevice?.(hubId, { type: "viewer-ready", hubId });
    socket.on("message", (raw) => {
        try {
            const message = JSON.parse(raw.toString());
            if (message.type === "answer" || message.type === "ice-candidate" || message.type === "viewer-ready") {
                const sent = options.sendToDevice?.(hubId, { ...message, hubId }) ?? false;
                if (!sent) {
                    sendJson(socket, { type: "status", hubId, status: "offline", at: new Date().toISOString() });
                }
            }
        }
        catch {
            sendJson(socket, { type: "error", message: "Invalid WebRTC signaling payload" });
        }
    });
    socket.on("close", () => {
        clients.delete(socket);
        viewers.delete(socket);
        if (viewers.size === 0) {
            viewersByHub.delete(hubId);
        }
    });
}
function broadcastLiveFeedStatus(hubId, status) {
    broadcastToViewers(hubId, {
        type: "status",
        hubId,
        status,
        at: new Date().toISOString(),
    });
}
function sendLiveFeedSignalToViewers(hubId, payload) {
    broadcastToViewers(hubId, payload);
}
function broadcastToViewers(hubId, payload) {
    const viewers = viewersByHub.get(hubId);
    if (!viewers)
        return;
    for (const viewer of viewers) {
        sendJson(viewer, payload);
    }
}
function sendJson(socket, payload) {
    if (socket.readyState === ws_1.WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}
