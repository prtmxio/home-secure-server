import { RequestHandler, Router } from "express";
import { AuthController } from "./auth.controller";

export function createAuthRoutes(authController: AuthController, authMiddleware: RequestHandler): Router {
  const router = Router();

  router.post("/register", authController.register);
  router.post("/login", authController.login);
  router.post("/otp/request", authController.requestOtp);
  router.post("/otp/verify", authController.verifyOtp);
  router.post("/otp/register", authController.completeOtpRegistration);
  router.get("/me", authMiddleware, authController.me);

  return router;
}
