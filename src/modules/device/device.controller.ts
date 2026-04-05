import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { DeviceService } from "./device.service";

export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  registerHubOverWifi = asyncHandler(async (req: Request, res: Response) => {
    const home = await this.deviceService.registerHubOverWifi(req.body);
    res.status(201).json({ home });
  });

  openSensorPairingMode = asyncHandler(async (req: Request, res: Response) => {
    const session = await this.deviceService.openSensorPairingMode({
      hubMacAddress: (req.headers["x-hub-mac-address"] || req.body.hubMacAddress) as string,
      hubSecret: (req.headers["x-hub-secret"] || req.body.hubSecret) as string,
    });
    res.status(201).json({ sensorPairingSession: session });
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
