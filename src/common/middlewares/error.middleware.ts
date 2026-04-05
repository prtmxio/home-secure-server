import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/api-error";

export function errorMiddleware(error: Error, req: Request, res: Response, next: NextFunction): void {
  const apiError = error instanceof ApiError ? error : new ApiError(500, "Internal server error");
  res.status(apiError.statusCode).json({
    error: apiError.message,
    details: apiError.details,
  });
}
