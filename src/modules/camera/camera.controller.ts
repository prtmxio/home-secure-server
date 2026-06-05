import { Request, Response } from "express";
import { ApiError } from "../../common/errors/api-error";
import { asyncHandler } from "../../common/utils/async-handler";
import { CameraRelay } from "./camera-relay";

export class CameraController {
  constructor(private readonly cameraRelay: CameraRelay) {}

  streamByToken = asyncHandler(async (req: Request, res: Response) => {
    const homeId = this.cameraRelay.consumeStreamToken(String(req.params.token || ""));
    if (!homeId) {
      throw new ApiError(401, "Invalid or expired camera stream token");
    }

    this.cameraRelay.streamHome(homeId, res);
  });
}
