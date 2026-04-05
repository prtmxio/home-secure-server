import { NextFunction, Request, Response } from "express";
import { AppConfig } from "../../config/env";
import { ApiError } from "../errors/api-error";
import { verifyUserToken } from "../utils/jwt";
import { UserModel } from "../../modules/users/user.model";

export function createAuthMiddleware(config: AppConfig) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authorization = req.headers.authorization || "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;

      if (!token) {
        throw new ApiError(401, "Authorization token is required");
      }

      const payload = verifyUserToken(token, config.jwtSecret);
      if (payload.type !== "user") {
        throw new ApiError(401, "Invalid token type");
      }

      const user = await UserModel.findById(payload.sub);
      if (!user) {
        throw new ApiError(401, "User not found");
      }

      req.user = user;
      next();
    } catch (error) {
      next(error instanceof ApiError ? error : new ApiError(401, "Unauthorized"));
    }
  };
}
