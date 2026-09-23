import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { PasswordPort } from "../../application/ports/password.port";

@Injectable()
export class PasswordService implements PasswordPort {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  compare(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
