import crypto from "crypto";
import bcrypt from "bcryptjs";
import { connectDatabase, disconnectDatabase } from "../config/database";
import { env } from "../config/env";
import { UserModel } from "../modules/users/user.model";
import { HubModel } from "../modules/hubs/hub.model";
import { HomeModel } from "../modules/homes/home.model";
import { SensorModel } from "../modules/sensors/sensor.model";

async function upsertDemoHome(index: number, userId: string) {
  const macAddress = `AA:BB:CC:DD:EE:0${index}`;
  const hub = await HubModel.findOneAndUpdate(
    { macAddress },
    {
      $set: {
        owner: userId,
        macAddress,
        serialNumber: `GLZ-HUB-000${index}`,
        name: `Demo Hub ${index}`,
        location: `Demo Home ${index}`,
        hardwareModel: "ESP32-S3",
        deviceSecret: crypto.randomBytes(24).toString("hex"),
        status: "online",
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  const home = await HomeModel.findOneAndUpdate(
    { hub: hub._id },
    {
      $set: {
        owner: userId,
        name: `Demo Home ${index}`,
        location: `Sample Address ${index}`,
        hub: hub._id,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  hub.home = home._id;
  await hub.save();

  const sensorZones = ["Front Door", "Living Room Window", "Kitchen Window"];
  for (let sensorIndex = 1; sensorIndex <= sensorZones.length; sensorIndex += 1) {
    const sensorMacAddress = `11:22:33:44:0${index}:0${sensorIndex}`;
    const zone = sensorZones[sensorIndex - 1];
    await SensorModel.findOneAndUpdate(
      { macAddress: sensorMacAddress },
      {
        $set: {
          hub: hub._id,
          macAddress: sensorMacAddress,
          name: `${zone} Sensor`,
          type: "contact",
          zone,
          hardwareModel: "ESP32-C3 Mini",
          status: sensorIndex === 3 ? "offline" : "online",
          lastActivityAt: sensorIndex === 3 ? null : new Date(),
          provisioning: {
            hubMacAddress: hub.macAddress,
            sensorMacAddress,
            sharedAt: new Date(),
          },
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  }
}

async function main() {
  await connectDatabase(env.mongodbUri);
  const passwordHash = await bcrypt.hash("otp-demo-user", 10);
  const user = await UserModel.findOneAndUpdate(
    { email: "abc@gmail.com" },
    {
      $setOnInsert: {
        name: "ABC Demo User",
        email: "abc@gmail.com",
        phoneNumber: "+919999999999",
        passwordHash,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  await upsertDemoHome(1, user.id);
  await upsertDemoHome(2, user.id);
  await upsertDemoHome(3, user.id);

  console.log("Seeded dummy hubs and sensors for abc@gmail.com");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
