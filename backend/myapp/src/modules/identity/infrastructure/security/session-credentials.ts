import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SessionCredentialsPort } from "../../application/ports/session-credentials.port";

@Injectable()
export class SessionCredentials implements SessionCredentialsPort {
  generate() {
    return { id: randomUUID(), token: randomBytes(48).toString("base64url") };
  }
  hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
}
