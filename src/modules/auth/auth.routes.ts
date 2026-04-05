import { RequestHandler, Router } from "express";
import { AuthController } from "./auth.controller";

export function createAuthRoutes(authController: AuthController, authMiddleware: RequestHandler): Router {
  const router = Router();

  router.post("/register", authController.register);
  router.post("/login", authController.login);
  router.get("/me", authMiddleware, authController.me);

  return router;
}
