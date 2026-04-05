import mongoose from "mongoose";

export async function connectDatabase(mongodbUri: string): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongodbUri);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
