import { Request, Response } from "express";
import { ApiError } from "../../common/errors/api-error";
import { asyncHandler } from "../../common/utils/async-handler";
import { CameraRelay } from "./camera-relay";

export class CameraController {
  constructor(private readonly cameraRelay: CameraRelay) {}

  streamByToken = asyncHandler(async (req: Request, res: Response) => {
    const token = String(req.params.token || "");
    console.info(`[CAMERA] Stream token requested token_prefix=${token.slice(0, 8)}`);

    const homeId = this.cameraRelay.consumeStreamToken(token);
    if (!homeId) {
      console.warn(`[CAMERA] Stream token rejected token_prefix=${token.slice(0, 8)}`);
      throw new ApiError(401, "Invalid or expired camera stream token");
    }

    console.info(`[CAMERA] Stream token accepted home=${homeId}`);
    await this.cameraRelay.streamHome(homeId, res);
  });
}
