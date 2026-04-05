export interface DeviceEventInput {
  hubMacAddress: string;
  hubSecret: string;
  sensorMacAddress?: string;
  eventType: string;
  severity?: string;
  payload?: Record<string, unknown>;
}

export interface CompleteHubRegistrationInput {
  hubMacAddress: string;
  provisioningToken: string;
}
