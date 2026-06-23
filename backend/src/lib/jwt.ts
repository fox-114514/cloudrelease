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
  // Pin the accepted algorithm to HS256. Without this, a confused-deputy
  // attacker who could swap the JWT alg header (e.g. "none" or an asymmetric
  // alg where the public key equals the HMAC secret) might forge a token.
  // jsonwebtoken v9 refuses "none" by default, but pinning the algorithm
  // closes the whole class of alg-confusion attacks.
  return jwt.verify(token, config.JWT_SECRET, {
    algorithms: ["HS256"],
  }) as UserTokenPayload;
}
