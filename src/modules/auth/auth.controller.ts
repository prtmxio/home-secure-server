import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { HomeService } from "../homes/home.service";
import { AuthService } from "./auth.service";

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly homeService: HomeService,
  ) {}

  register = asyncHandler(async (req: Request, res: Response) => {
    const user = await this.authService.register(req.body);
    res.status(201).json({ user });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.login(req.body);
    const homes = await this.homeService.listHomes(result.user.id);
    res.status(200).json({
      token: result.token,
      user: result.user,
      homes,
    });
  });

  requestOtp = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.requestOtp(req.body);
    res.status(200).json({
      phoneNumber: result.phoneNumber,
      expiresAt: result.expiresAt,
      ...(process.env.NODE_ENV === "production" ? {} : { otp: result.otp }),
    });
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.verifyOtp(req.body);
    if (result.status === "authenticated") {
      const homes = await this.homeService.listHomes(result.user.id);
      res.status(200).json({ ...result, homes });
      return;
    }
    res.status(200).json(result);
  });

  completeOtpRegistration = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.authService.completeOtpRegistration(req.body);
    const homes = await this.homeService.listHomes(result.user.id);
    res.status(201).json({ ...result, homes });
  });

  me = asyncHandler(async (req: Request, res: Response) => {
    const homes = await this.homeService.listHomes(req.user!.id);
    res.status(200).json({
      user: this.authService.serializeUser(req.user!),
      homes,
    });
  });
}
