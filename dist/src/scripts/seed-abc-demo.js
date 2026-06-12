"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../config/database");
const env_1 = require("../config/env");
const user_model_1 = require("../modules/users/user.model");
const hub_model_1 = require("../modules/hubs/hub.model");
const home_model_1 = require("../modules/homes/home.model");
const sensor_model_1 = require("../modules/sensors/sensor.model");
async function upsertDemoHome(index, userId) {
    const macAddress = `AA:BB:CC:DD:EE:0${index}`;
    const hub = await hub_model_1.HubModel.findOneAndUpdate({ macAddress }, {
        $set: {
            owner: userId,
            macAddress,
            serialNumber: `GLZ-HUB-000${index}`,
            name: `Demo Hub ${index}`,
            location: `Demo Home ${index}`,
            hardwareModel: "ESP32-S3",
            deviceSecret: crypto_1.default.randomBytes(24).toString("hex"),
            status: "online",
            lastSeenAt: new Date(),
        },
    }, { upsert: true, returnDocument: "after" });
    const home = await home_model_1.HomeModel.findOneAndUpdate({ hub: hub._id }, {
        $set: {
            owner: userId,
            name: `Demo Home ${index}`,
            location: `Sample Address ${index}`,
            hub: hub._id,
        },
    }, { upsert: true, returnDocument: "after" });
    hub.home = home._id;
    await hub.save();
    const sensorZones = ["Front Door", "Living Room Window", "Kitchen Window"];
    for (let sensorIndex = 1; sensorIndex <= sensorZones.length; sensorIndex += 1) {
        const sensorMacAddress = `11:22:33:44:0${index}:0${sensorIndex}`;
        const zone = sensorZones[sensorIndex - 1];
        await sensor_model_1.SensorModel.findOneAndUpdate({ macAddress: sensorMacAddress }, {
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
        }, { upsert: true, returnDocument: "after" });
    }
}
async function main() {
    await (0, database_1.connectDatabase)(env_1.env.mongodbUri);
    const passwordHash = await bcryptjs_1.default.hash("otp-demo-user", 10);
    const user = await user_model_1.UserModel.findOneAndUpdate({ email: "abc@gmail.com" }, {
        $setOnInsert: {
            name: "ABC Demo User",
            email: "abc@gmail.com",
            phoneNumber: "+919999999999",
            passwordHash,
        },
    }, { upsert: true, returnDocument: "after" });
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
    await (0, database_1.disconnectDatabase)();
});
