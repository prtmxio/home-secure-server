import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { CameraRelay } from "../camera/camera-relay";
import { DoorLockService } from "../door-lock/door-lock.service";
import { HomeService } from "./home.service";

export class HomeController {
  constructor(
    private readonly homeService: HomeService,
    private readonly doorLockService: DoorLockService,
    private readonly cameraRelay: CameraRelay,
  ) {}

  startHubSetup = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.homeService.startHubSetup(req.user!.id, req.body);
    res.status(201).json({ setupSession: result });
  });

  listHomes = asyncHandler(async (req: Request, res: Response) => {
    const homes = await this.homeService.listHomes(req.user!.id);
    res.status(200).json({ homes });
  });

  getHome = asyncHandler(async (req: Request, res: Response) => {
    const home = await this.homeService.getHomeById(req.user!.id, req.params.homeId as string);
    res.status(200).json({ home });
  });

  pairSensor = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.homeService.pairSensorToHome(req.user!.id, req.params.homeId as string, req.body);
    res.status(201).json(result);
  });

  openDoorLock = asyncHandler(async (req: Request, res: Response) => {
    const command = await this.doorLockService.createAutoLockCommand(req.user!.id, req.params.homeId as string);
    res.status(201).json({ command });
  });

  toggleDoorLock = asyncHandler(async (req: Request, res: Response) => {
    const command = await this.doorLockService.createToggleCommand(req.user!.id, req.params.homeId as string, req.body);
    res.status(201).json({ command });
  });

  getDoorLock = asyncHandler(async (req: Request, res: Response) => {
    const command = await this.doorLockService.getLatestForHome(req.user!.id, req.params.homeId as string);
    res.status(200).json({ command });
  });

  streamCamera = asyncHandler(async (req: Request, res: Response) => {
    const home = await this.homeService.getHomeById(req.user!.id, req.params.homeId as string);
    await this.cameraRelay.streamHome(home.id, res);
  });

  createCameraStreamToken = asyncHandler(async (req: Request, res: Response) => {
    const home = await this.homeService.getHomeById(req.user!.id, req.params.homeId as string);
    const token = this.cameraRelay.createStreamToken(home.id);
    res.status(201).json({
      streamToken: token.token,
      expiresAt: token.expiresAt,
      streamPath: `/api/camera/streams/${token.token}`,
    });
  });
}
