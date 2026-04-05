import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface IHome {
  owner: Types.ObjectId;
  name: string;
  location: string;
  hub: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const homeSchema = new Schema<IHome>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    hub: { type: Schema.Types.ObjectId, ref: "Hub", required: true, unique: true },
  },
  { timestamps: true },
);

export type IHomeDocument = HydratedDocument<IHome>;
export const HomeModel: Model<IHome> = model<IHome>("Home", homeSchema);
