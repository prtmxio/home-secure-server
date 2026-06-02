import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let memoryServer: MongoMemoryServer | null = null;

interface ConnectDatabaseOptions {
  allowMemoryFallback?: boolean;
}

export async function connectDatabase(mongodbUri: string, options: ConnectDatabaseOptions = {}): Promise<void> {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(mongodbUri);
  } catch (error) {
    if (!options.allowMemoryFallback) {
      throw error;
    }

    console.warn(
      `MongoDB is not reachable at ${mongodbUri}. Starting an in-memory MongoDB for development. Data will be lost when the server stops.`,
    );
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
