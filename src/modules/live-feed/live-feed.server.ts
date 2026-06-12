import { IncomingMessage, Server as HttpServer } from "http";
import { Socket } from "net";
import { WebSocket, WebSocketServer } from "ws";
import { AppConfig } from "../../config/env";
import { ApiError } from "../../common/errors/api-error";
import { normalizeMacAddress } from "../../common/utils/mac-address";
import { verifyUserToken } from "../../common/utils/jwt";
import { HubModel } from "../hubs/hub.model";

type LiveFeedRole = "device" | "viewer";

interface LiveFeedClient {
  role: LiveFeedRole;
  hubId: string;
  socket: WebSocket;
  mode: "frames" | "webrtc";
}

interface LiveFeedFrame {
  type: "frame";
  hubId: string;
  contentType: string;
  data: string;
  capturedAt: string;
  sequence: number;
}

const viewersByHub = new Map<string, Set<WebSocket>>();
const devicesByHub = new Map<string, Set<WebSocket>>();
const clients = new Map<WebSocket, LiveFeedClient>();
const latestFrames = new Map<string, LiveFeedFrame>();
const deviceConnectionsByHub = new Map<string, number>();
let sequence = 0;

export function attachLiveFeedServer(server: HttpServer, config: AppConfig): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_500_000 });

  server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
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

async function handleConnection(
  socket: WebSocket,
  request: IncomingMessage,
  config: AppConfig,
): Promise<void> {
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

    throw new ApiError(400, "Invalid live feed role");
  } catch (error) {
    sendJson(socket, {
      type: "error",
      message: error instanceof ApiError ? error.message : "Live feed connection failed",
    });
    socket.close(1008);
  }
}

async function authenticateDevice(url: URL, config: AppConfig): Promise<string> {
  const deviceApiKey = url.searchParams.get("deviceApiKey") || "";
  const hubMacAddress = normalizeMacAddress(url.searchParams.get("hubMacAddress") || "");
  const hubSecret = url.searchParams.get("hubSecret") || "";

  if (deviceApiKey !== config.deviceApiKey) {
    throw new ApiError(401, "Invalid device API key");
  }

  const hub = await HubModel.findOne({ macAddress: hubMacAddress });
  if (!hub) {
    throw new ApiError(404, "Hub not found");
  }
  if (!hubSecret || hub.deviceSecret !== hubSecret) {
    throw new ApiError(401, "Invalid hub secret");
  }

  hub.lastSeenAt = new Date();
  hub.status = "online";
  await hub.save();

  return hub.id;
}

async function authenticateViewer(url: URL, config: AppConfig): Promise<string> {
  const token = url.searchParams.get("token") || "";
  const hubId = url.searchParams.get("hubId") || "";

  if (!token || !hubId) {
    throw new ApiError(401, "Viewer token and hubId are required");
  }

  const payload = verifyUserToken(token, config.jwtSecret);
  if (payload.type !== "user") {
    throw new ApiError(401, "Invalid token type");
  }

  const hub = await HubModel.findOne({ _id: hubId, owner: payload.sub });
  if (!hub) {
    throw new ApiError(404, "Hub not found for this user");
  }

  return hub.id;
}

function registerDevice(socket: WebSocket, hubId: string, mode: "frames" | "webrtc"): void {
  clients.set(socket, { role: "device", hubId, socket, mode });
  const devices = devicesByHub.get(hubId) || new Set<WebSocket>();
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
      const message = JSON.parse(raw.toString()) as {
        type?: string;
        data?: string;
        contentType?: string;
        capturedAt?: string;
        sdp?: unknown;
        candidate?: unknown;
      };
      if (mode === "webrtc") {
        if (message.type === "offer" || message.type === "ice-candidate") {
          broadcastToViewers(hubId, { ...message, hubId });
        }
        return;
      }

      if (message.type !== "frame" || !message.data) return;

      const frame: LiveFeedFrame = {
        type: "frame",
        hubId,
        contentType: message.contentType || "image/jpeg",
        data: message.data,
        capturedAt: message.capturedAt || new Date().toISOString(),
        sequence: ++sequence,
      };
      latestFrames.set(hubId, frame);
      broadcastToViewers(hubId, frame);
    } catch {
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
    } else {
      deviceConnectionsByHub.set(hubId, remaining);
    }
  });
}

function registerViewer(socket: WebSocket, hubId: string, mode: "frames" | "webrtc"): void {
  clients.set(socket, { role: "viewer", hubId, socket, mode });
  const viewers = viewersByHub.get(hubId) || new Set<WebSocket>();
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
      const message = JSON.parse(raw.toString()) as {
        type?: string;
        sdp?: unknown;
        candidate?: unknown;
      };
      if (mode !== "webrtc") return;
      if (message.type === "answer" || message.type === "ice-candidate" || message.type === "viewer-ready") {
        broadcastToDevices(hubId, { ...message, hubId });
      }
    } catch {
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

function broadcastStatus(hubId: string, status: "live" | "offline"): void {
  broadcastToViewers(hubId, {
    type: "status",
    hubId,
    status,
    at: new Date().toISOString(),
  });
}

function broadcastToViewers(hubId: string, payload: unknown): void {
  const viewers = viewersByHub.get(hubId);
  if (!viewers) return;

  for (const viewer of viewers) {
    sendJson(viewer, payload);
  }
}

function broadcastToDevices(hubId: string, payload: unknown): void {
  const devices = devicesByHub.get(hubId);
  if (!devices) return;

  for (const device of devices) {
    sendJson(device, payload);
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
