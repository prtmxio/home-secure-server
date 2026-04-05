import { NextFunction, Request, Response } from "express";
import { AppConfig } from "../../config/env";
import { ApiError } from "../errors/api-error";

export function createDeviceMiddleware(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const deviceApiKey = req.headers["x-device-api-key"];
    if (!deviceApiKey || deviceApiKey !== config.deviceApiKey) {
      next(new ApiError(401, "Invalid device API key"));
      return;
    }

    next();
  };
}
