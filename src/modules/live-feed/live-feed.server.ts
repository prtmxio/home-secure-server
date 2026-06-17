import { IncomingMessage, Server as HttpServer } from "http";
import { Socket } from "net";
import { WebSocket, WebSocketServer } from "ws";
import { AppConfig } from "../../config/env";
import { ApiError } from "../../common/errors/api-error";
import { verifyUserToken } from "../../common/utils/jwt";
import { HubModel } from "../hubs/hub.model";

interface LiveFeedClient {
  hubId: string;
  socket: WebSocket;
}

const viewersByHub = new Map<string, Set<WebSocket>>();
const clients = new Map<WebSocket, LiveFeedClient>();

interface LiveFeedServerOptions {
  isDeviceConnected?: (hubId: string) => boolean;
  sendToDevice?: (hubId: string, payload: unknown) => boolean;
}

export function attachLiveFeedServer(
  server: HttpServer,
  config: AppConfig,
  options: LiveFeedServerOptions = {},
): void {
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
    void handleConnection(socket, request, config, options);
  });
}

async function handleConnection(
  socket: WebSocket,
  request: IncomingMessage,
  config: AppConfig,
  options: LiveFeedServerOptions,
): Promise<void> {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const role = url.searchParams.get("role");

    if (role === "device") {
      throw new ApiError(400, "Hub live feed signaling must use /api/device/hubs/control/ws");
    }

    if (url.searchParams.get("mode") !== "webrtc") {
      throw new ApiError(400, "Live feed requires mode=webrtc");
    }

    if (role === "viewer") {
      const hubId = await authenticateViewer(url, config);
      registerViewer(socket, hubId, options);
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

function registerViewer(socket: WebSocket, hubId: string, options: LiveFeedServerOptions): void {
  clients.set(socket, { hubId, socket });
  const viewers = viewersByHub.get(hubId) || new Set<WebSocket>();
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
      const message = JSON.parse(raw.toString()) as {
        type?: string;
        sdp?: unknown;
        candidate?: unknown;
      };
      if (message.type === "answer" || message.type === "ice-candidate" || message.type === "viewer-ready") {
        const sent = options.sendToDevice?.(hubId, { ...message, hubId }) ?? false;
        if (!sent) {
          sendJson(socket, { type: "status", hubId, status: "offline", at: new Date().toISOString() });
        }
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

export function broadcastLiveFeedStatus(hubId: string, status: "live" | "offline"): void {
  broadcastToViewers(hubId, {
    type: "status",
    hubId,
    status,
    at: new Date().toISOString(),
  });
}

export function sendLiveFeedSignalToViewers(hubId: string, payload: unknown): void {
  broadcastToViewers(hubId, payload);
}

function broadcastToViewers(hubId: string, payload: unknown): void {
  const viewers = viewersByHub.get(hubId);
  if (!viewers) return;

  for (const viewer of viewers) {
    sendJson(viewer, payload);
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
