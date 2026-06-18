import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { CameraRelay } from "../camera/camera-relay";
import { sendHubControlMessage } from "../device-control/hub-control-ws";
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

  deleteSensor = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.homeService.deleteSensorFromHome(
      req.user!.id,
      req.params.homeId as string,
      req.params.sensorId as string,
    );
    const commandSent = sendHubControlMessage(
      result.hubId,
      {
        type: "sensor_delete_command",
        sensorMacAddress: result.sensorMacAddress,
      },
      "Sensor delete command",
    );
    res.status(200).json({ ...result, commandSent });
  });

  deleteHub = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.homeService.deleteHomeHub(req.user!.id, req.params.homeId as string);
    const commandSent = sendHubControlMessage(
      result.hubId,
      {
        type: "hub_reset_command",
        action: "format_and_reset",
        reason: "hub_deleted",
        hubMacAddress: result.hubMacAddress,
      },
      "Hub reset command",
    );
    res.status(200).json({ ...result, commandSent });
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
