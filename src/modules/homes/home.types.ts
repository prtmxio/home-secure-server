export interface StartHomeSetupInput {
  hubMacAddress: string;
  homeName: string;
  location?: string;
  hardwareModel?: string;
}

export interface CompleteHubRegistrationInput {
  hubMacAddress: string;
  provisioningToken: string;
}

export interface PairHomeSensorInput {
  sensorMacAddress: string;
  name?: string;
  type?: string;
  zone?: string;
  hardwareModel?: string;
}

export interface SensorDto {
  id: string;
  hubId: string;
  macAddress: string;
  name: string;
  type: string;
  zone: string;
  hardwareModel: string;
  status: string;
  lastActivityAt: Date | null;
  provisioning: {
    hubMacAddress: string;
    sensorMacAddress: string;
    provisionKey: string | null;   // present only once (cleared after hub fetches it)
    sharedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface HubDto {
  id: string;
  name: string;
  location: string;
  macAddress: string;
  serialNumber: string | null;
  hardwareModel: string;
  status: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HomeDto {
  id: string;
  name: string;
  location: string;
  createdAt: Date;
  updatedAt: Date;
  hub: HubDto;
  sensors: SensorDto[];
}
