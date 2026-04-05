import jwt, { SignOptions } from "jsonwebtoken";
import { IUserDocument } from "../../modules/users/user.model";

interface UserTokenPayload {
  sub: string;
  type: "user";
  email: string;
}

export function signUserToken(user: IUserDocument, secret: string, expiresIn: string): string {
  const payload: UserTokenPayload = {
    sub: user.id,
    type: "user",
    email: user.email,
  };

  return jwt.sign(payload, secret, { expiresIn: expiresIn as SignOptions["expiresIn"] });
}

export function verifyUserToken(token: string, secret: string): UserTokenPayload {
  return jwt.verify(token, secret) as UserTokenPayload;
}
