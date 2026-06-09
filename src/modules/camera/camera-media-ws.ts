import http from "http";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { AppConfig } from "../../config/env";
import { normalizeMacAddress } from "../../common/utils/mac-address";
import { HubModel } from "../hubs/hub.model";
import { CameraRelay } from "./camera-relay";

interface CameraMediaSocket {
  hubId: string;
  homeId: string;
  hubMacAddress: string;
  socket: WebSocket;
  frameCount: number;
}

const CAMERA_WS_PATH = "/api/device/hubs/camera/ws";
const mediaSocketsByHubId = new Map<string, CameraMediaSocket>();

export function attachHubCameraWebSocket(
  server: http.Server,
  config: AppConfig,
  cameraRelay: CameraRelay,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== CAMERA_WS_PATH) return;

    const deviceApiKey = request.headers["x-device-api-key"];
    if (deviceApiKey !== config.deviceApiKey) {
      console.warn("[CAMERA_WS] Rejected media websocket: invalid device API key");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const hubMacAddressRaw = String(request.headers["x-hub-mac-address"] || "");
    const hubSecret = String(request.headers["x-hub-secret"] || "");

    void authenticateCameraHub(hubMacAddressRaw, hubSecret)
      .then(({ hubId, homeId, hubMacAddress }) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          const existingSocket = mediaSocketsByHubId.get(hubId);
          if (existingSocket) {
            console.warn(`[CAMERA_WS] Replacing existing media websocket hub=${hubId} mac=${hubMacAddress}`);
            existingSocket.socket.close(4001, "Replaced by a new camera media connection");
          }

          const mediaSocket: CameraMediaSocket = {
            hubId,
            homeId,
            hubMacAddress,
            socket: ws,
            frameCount: 0,
          };
          mediaSocketsByHubId.set(hubId, mediaSocket);
          console.info(`[CAMERA_WS] Media websocket connected hub=${hubId} home=${homeId} mac=${hubMacAddress}`);

          ws.on("message", (data, isBinary) => {
            handleCameraFrame(cameraRelay, mediaSocket, data, isBinary);
          });
          ws.on("close", (code, reason) => {
            console.info(`[CAMERA_WS] Media websocket closed hub=${hubId} mac=${hubMacAddress} code=${code} reason=${reason.toString()}`);
            if (mediaSocketsByHubId.get(hubId)?.socket === ws) {
              mediaSocketsByHubId.delete(hubId);
            }
          });
          ws.on("error", (error) => {
            console.warn(`[CAMERA_WS] Media websocket error hub=${hubId} mac=${hubMacAddress} error=${error.message}`);
          });

          ws.send(JSON.stringify({ type: "camera_media_ready" }));
        });
      })
      .catch((error) => {
        console.warn(`[CAMERA_WS] Rejected media websocket: auth failed mac=${hubMacAddressRaw} error=${error instanceof Error ? error.message : String(error)}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  return wss;
}

async function authenticateCameraHub(hubMacAddressRaw: string, hubSecret: string) {
  const hubMacAddress = normalizeMacAddress(hubMacAddressRaw);
  const hub = await HubModel.findOne({ macAddress: hubMacAddress });
  if (!hub) throw new Error("Hub not found");
  if (hub.deviceSecret !== hubSecret) throw new Error("Invalid hub secret");
  if (!hub.owner || !hub.home) throw new Error("Hub is not registered to any home");

  return {
    hubId: hub.id,
    homeId: hub.home.toString(),
    hubMacAddress: hub.macAddress,
  };
}

function handleCameraFrame(
  cameraRelay: CameraRelay,
  mediaSocket: CameraMediaSocket,
  data: RawData,
  isBinary: boolean,
): void {
  if (!isBinary) {
    console.warn(`[CAMERA_WS] Ignored non-binary media message hub=${mediaSocket.hubId}`);
    return;
  }

  const frame = toBuffer(data);
  if (!isJpeg(frame)) {
    console.warn(`[CAMERA_WS] Ignored invalid JPEG hub=${mediaSocket.hubId} bytes=${frame.length}`);
    return;
  }

  mediaSocket.frameCount++;
  cameraRelay.publishFrame(mediaSocket.homeId, frame);

  if (mediaSocket.frameCount === 1 || mediaSocket.frameCount % 30 === 0) {
    console.info(`[CAMERA_WS] Accepted frame hub=${mediaSocket.hubId} home=${mediaSocket.homeId} bytes=${frame.length} count=${mediaSocket.frameCount}`);
  }
}

function isJpeg(frame: Buffer): boolean {
  return frame.length >= 4 &&
    frame[0] === 0xff &&
    frame[1] === 0xd8 &&
    frame[frame.length - 2] === 0xff &&
    frame[frame.length - 1] === 0xd9;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
