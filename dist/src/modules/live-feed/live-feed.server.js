"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachLiveFeedServer = attachLiveFeedServer;
const ws_1 = require("ws");
const api_error_1 = require("../../common/errors/api-error");
const mac_address_1 = require("../../common/utils/mac-address");
const jwt_1 = require("../../common/utils/jwt");
const hub_model_1 = require("../hubs/hub.model");
const viewersByHub = new Map();
const devicesByHub = new Map();
const clients = new Map();
const latestFrames = new Map();
const deviceConnectionsByHub = new Map();
let sequence = 0;
function attachLiveFeedServer(server, config) {
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
        void handleConnection(socket, request, config);
    });
}
async function handleConnection(socket, request, config) {
    try {
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        const role = url.searchParams.get("role");
        if (role === "device") {
            const hubId = await authenticateDevice(url, config);
            registerDevice(socket, hubId, url.searchParams.get("mode") === "webrtc" ? "webrtc" : "frames");
            return;
        }
        if (role === "viewer") {
            const hubId = await authenticateViewer(url, config);
            registerViewer(socket, hubId, url.searchParams.get("mode") === "webrtc" ? "webrtc" : "frames");
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
async function authenticateDevice(url, config) {
    const deviceApiKey = url.searchParams.get("deviceApiKey") || "";
    const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(url.searchParams.get("hubMacAddress") || "");
    const hubSecret = url.searchParams.get("hubSecret") || "";
    if (deviceApiKey !== config.deviceApiKey) {
        throw new api_error_1.ApiError(401, "Invalid device API key");
    }
    const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
    if (!hub) {
        throw new api_error_1.ApiError(404, "Hub not found");
    }
    if (!hubSecret || hub.deviceSecret !== hubSecret) {
        throw new api_error_1.ApiError(401, "Invalid hub secret");
    }
    hub.lastSeenAt = new Date();
    hub.status = "online";
    await hub.save();
    return hub.id;
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
function registerDevice(socket, hubId, mode) {
    clients.set(socket, { role: "device", hubId, socket, mode });
    const devices = devicesByHub.get(hubId) || new Set();
    devices.add(socket);
    devicesByHub.set(hubId, devices);
    deviceConnectionsByHub.set(hubId, (deviceConnectionsByHub.get(hubId) || 0) + 1);
    broadcastStatus(hubId, "live");
    sendJson(socket, { type: "ready", role: "device", hubId, mode });
    if (mode === "webrtc" && (viewersByHub.get(hubId)?.size || 0) > 0) {
        sendJson(socket, { type: "viewer-ready", hubId });
    }
    socket.on("message", (raw) => {
        try {
            const message = JSON.parse(raw.toString());
            if (mode === "webrtc") {
                if (message.type === "offer" || message.type === "ice-candidate") {
                    broadcastToViewers(hubId, { ...message, hubId });
                }
                return;
            }
            if (message.type !== "frame" || !message.data)
                return;
            const frame = {
                type: "frame",
                hubId,
                contentType: message.contentType || "image/jpeg",
                data: message.data,
                capturedAt: message.capturedAt || new Date().toISOString(),
                sequence: ++sequence,
            };
            latestFrames.set(hubId, frame);
            broadcastToViewers(hubId, frame);
        }
        catch {
            sendJson(socket, { type: "error", message: "Invalid live feed frame payload" });
        }
    });
    socket.on("close", () => {
        clients.delete(socket);
        devices.delete(socket);
        if (devices.size === 0) {
            devicesByHub.delete(hubId);
        }
        const remaining = Math.max((deviceConnectionsByHub.get(hubId) || 1) - 1, 0);
        if (remaining === 0) {
            deviceConnectionsByHub.delete(hubId);
            broadcastStatus(hubId, "offline");
        }
        else {
            deviceConnectionsByHub.set(hubId, remaining);
        }
    });
}
function registerViewer(socket, hubId, mode) {
    clients.set(socket, { role: "viewer", hubId, socket, mode });
    const viewers = viewersByHub.get(hubId) || new Set();
    viewers.add(socket);
    viewersByHub.set(hubId, viewers);
    sendJson(socket, {
        type: "ready",
        role: "viewer",
        hubId,
        mode,
        status: deviceConnectionsByHub.has(hubId) ? "live" : "waiting",
    });
    if (mode === "webrtc") {
        broadcastToDevices(hubId, { type: "viewer-ready", hubId });
    }
    const latestFrame = mode === "frames" ? latestFrames.get(hubId) : null;
    if (latestFrame) {
        sendJson(socket, latestFrame);
    }
    socket.on("message", (raw) => {
        try {
            const message = JSON.parse(raw.toString());
            if (mode !== "webrtc")
                return;
            if (message.type === "answer" || message.type === "ice-candidate" || message.type === "viewer-ready") {
                broadcastToDevices(hubId, { ...message, hubId });
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
function broadcastStatus(hubId, status) {
    broadcastToViewers(hubId, {
        type: "status",
        hubId,
        status,
        at: new Date().toISOString(),
    });
}
function broadcastToViewers(hubId, payload) {
    const viewers = viewersByHub.get(hubId);
    if (!viewers)
        return;
    for (const viewer of viewers) {
        sendJson(viewer, payload);
    }
}
function broadcastToDevices(hubId, payload) {
    const devices = devicesByHub.get(hubId);
    if (!devices)
        return;
    for (const device of devices) {
        sendJson(device, payload);
    }
}
function sendJson(socket, payload) {
    if (socket.readyState === ws_1.WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}
