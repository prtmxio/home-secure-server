"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = connectDatabase;
exports.disconnectDatabase = disconnectDatabase;
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_memory_server_1 = require("mongodb-memory-server");
let memoryServer = null;
async function connectDatabase(mongodbUri, options = {}) {
    mongoose_1.default.set("strictQuery", true);
    try {
        await mongoose_1.default.connect(mongodbUri);
    }
    catch (error) {
        if (!options.allowMemoryFallback) {
            throw error;
        }
        console.warn(`MongoDB is not reachable at ${mongodbUri}. Starting an in-memory MongoDB for development. Data will be lost when the server stops.`);
        memoryServer = await mongodb_memory_server_1.MongoMemoryServer.create();
        await mongoose_1.default.connect(memoryServer.getUri());
    }
}
async function disconnectDatabase() {
    await mongoose_1.default.disconnect();
    if (memoryServer) {
        await memoryServer.stop();
        memoryServer = null;
    }
}
