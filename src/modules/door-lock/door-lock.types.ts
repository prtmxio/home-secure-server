import { DoorLockAction, DoorLockCommandStatus, DoorLockMode } from "./door-lock.model";

export interface DoorLockCommandDto {
  id: string;
  homeId: string;
  hubId: string;
  mode: DoorLockMode;
  action: DoorLockAction;
  durationMs: number;
  status: DoorLockCommandStatus;
  deliveredAt: Date | null;
  executedAt: Date | null;
  failedAt: Date | null;
  error: string | null;
  lockState: "locked" | "unlocked" | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoorLockAckInput {
  commandId: string;
  status: "executed" | "failed";
  lockState?: "locked" | "unlocked";
  error?: string;
}
