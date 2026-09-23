import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { RegistrationPolicy } from "../../../application/registration-policy";
import { AppException } from "../../../../../platform/http/app-exception";

@Injectable()
export class RegistrationEnabledGuard implements CanActivate {
  constructor(private readonly policy: RegistrationPolicy) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.policy.isEnabled()) {
      throw new AppException(
        403,
        40301,
        "Registration is temporarily disabled",
        { reason: "REGISTRATION_DISABLED" },
      );
    }
    return true;
  }
}
