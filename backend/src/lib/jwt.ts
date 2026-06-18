import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface UserTokenPayload {
  type: "user";
  userId: string;
  ownerUserId: string;
  role: string;
}

const USER_TOKEN_EXPIRES_IN = "7d";

export function signUserToken(payload: Omit<UserTokenPayload, "type">): string {
  return jwt.sign({ type: "user", ...payload } as UserTokenPayload, config.JWT_SECRET, {
    expiresIn: USER_TOKEN_EXPIRES_IN,
  });
}

export function verifyUserToken(token: string): UserTokenPayload {
  return jwt.verify(token, config.JWT_SECRET) as UserTokenPayload;
}
