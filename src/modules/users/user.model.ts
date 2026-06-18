import { HydratedDocument, Model, Schema, model } from "mongoose";

export interface IUser {
  name: string;
  email: string;
  phoneNumber: string;
  passwordHash: string;
  pushTokens: {
    token: string;
    platform: string;
    updatedAt: Date;
    createdAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phoneNumber: { type: String, default: "", trim: true, index: true },
    passwordHash: { type: String, required: true },
    pushTokens: [
      {
        token: { type: String, required: true },
        platform: { type: String, default: "unknown" },
        updatedAt: { type: Date, default: Date.now },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export type IUserDocument = HydratedDocument<IUser>;
export const UserModel: Model<IUser> = model<IUser>("User", userSchema);
