import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { DeviceService } from "./device.service";

export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  registerHubOverWifi = asyncHandler(async (req: Request, res: Response) => {
    const { home, hubSecret } = await this.deviceService.registerHubOverWifi(req.body);
    res.status(201).json({ home, hubSecret });
  });

  openSensorPairingMode = asyncHandler(async (req: Request, res: Response) => {
    const session = await this.deviceService.openSensorPairingMode({
      hubMacAddress: (req.headers["x-hub-mac-address"] || req.body.hubMacAddress) as string,
      hubSecret: (req.headers["x-hub-secret"] || req.body.hubSecret) as string,
    });
    res.status(201).json({ sensorPairingSession: session });
  });

  fetchPendingSensorPairing = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.deviceService.fetchPendingSensorPairing({
      hubMacAddress: (req.headers["x-hub-mac-address"] || "") as string,
      hubSecret: (req.headers["x-hub-secret"] || "") as string,
    });
    res.status(200).json(result);
  });

  fetchHubSensors = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.deviceService.fetchHubSensors({
      hubMacAddress: (req.headers["x-hub-mac-address"] || "") as string,
      hubSecret: (req.headers["x-hub-secret"] || "") as string,
    });
    res.status(200).json(result);
  });

  ingestCameraFrame = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.deviceService.ingestCameraFrame({
      hubMacAddress: (req.headers["x-hub-mac-address"] || "") as string,
      hubSecret: (req.headers["x-hub-secret"] || "") as string,
      contentType: req.headers["content-type"],
      frame: req.body as Buffer,
    });
    res.status(202).json(result);
  });

  ingestHubEvent = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.deviceService.ingestHubEvent({
      ...req.body,
      hubMacAddress: req.headers["x-hub-mac-address"] || req.body.hubMacAddress,
      hubSecret: req.headers["x-hub-secret"] || req.body.hubSecret,
    });
    res.status(201).json(result);
  });
}
