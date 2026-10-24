import type { IdentityTransactionPort } from "./ports/identity-transaction.port";
import type { IssuedSession } from "../domain/auth.types";
import { IdentityApplicationError } from "./identity-application.error";
import { LoginAttemptLimiter } from "./login-attempt-limiter";
import type { IdentityTelemetryPort } from "./ports/identity-telemetry.port";
import type { PasswordPort } from "./ports/password.port";
import { SessionService } from "./session.service";
import type { UserRepositoryPort } from "./ports/user-repository.port";

export interface RegisterCommand {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface LoginCommand {
  email: string;
  password: string;
}

export interface ResetPasswordCommand {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export class AuthService {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly passwords: PasswordPort,
    private readonly sessions: SessionService,
    private readonly telemetry: IdentityTelemetryPort,
    private readonly transaction: IdentityTransactionPort,
    private readonly loginAttempts: LoginAttemptLimiter = new LoginAttemptLimiter(),
  ) {}

  async register(command: RegisterCommand): Promise<IssuedSession> {
    const email = this.normalizeEmail(command.email);
    if (command.password !== command.confirmPassword) {
      throw IdentityApplicationError.validation(
        "confirmPassword",
        "Passwords do not match",
      );
    }

    if (this.users.findByEmail(email)) {
      throw IdentityApplicationError.conflict(
        "email",
        "Email is already registered",
      );
    }

    const passwordHash = await this.passwords.hash(command.password);
    return this.transaction.run(() => {
      if (this.users.findByEmail(email)) {
        throw IdentityApplicationError.conflict(
          "email",
          "Email is already registered",
        );
      }
      const createdUser = this.users.create(email, passwordHash);
      const result = this.issueSession(createdUser.id, createdUser.email);
      this.telemetry.info({
        event: "auth.register.succeeded",
        userId: createdUser.id,
      });
      return result;
    });
  }

  async login(command: LoginCommand): Promise<IssuedSession> {
    const email = this.normalizeEmail(command.email);
    // 锁定期间连正确密码也拒绝，否则锁定只会拖慢而挡不住猜中。
    const lockedForSeconds = this.loginAttempts.lockedForSeconds(email);
    if (lockedForSeconds > 0) {
      this.telemetry.warn({ event: "auth.login.locked", email, lockedForSeconds });
      throw IdentityApplicationError.rateLimited(
        `登录失败次数过多，请 ${Math.ceil(lockedForSeconds / 60)} 分钟后再试`,
        lockedForSeconds,
      );
    }

    const user = this.users.findByEmail(email);
    if (!user) {
      this.loginAttempts.recordFailure(email);
      this.telemetry.warn({
        event: "auth.login.failed",
        reason: "USER_NOT_FOUND",
        email,
      });
      throw IdentityApplicationError.unauthorized("Invalid email or password");
    }

    const passwordMatches = await this.passwords.compare(
      command.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      this.loginAttempts.recordFailure(email);
      this.telemetry.warn({
        event: "auth.login.failed",
        reason: "PASSWORD_MISMATCH",
        userId: user.id,
        email: user.email,
      });
      throw IdentityApplicationError.unauthorized("Invalid email or password");
    }
    this.loginAttempts.recordSuccess(email);

    return this.transaction.run(() => {
      this.assertPasswordUnchanged(user.id, user.passwordHash);
      const result = this.issueSession(user.id, user.email);
      this.telemetry.info({ event: "auth.login.succeeded", userId: user.id });
      return result;
    });
  }

  async logout(sessionId: string): Promise<void> {
    this.sessions.revoke(sessionId);
  }

  async resetPassword(
    userId: number,
    command: ResetPasswordCommand,
  ): Promise<IssuedSession> {
    if (command.newPassword !== command.confirmPassword) {
      throw IdentityApplicationError.validation(
        "confirmPassword",
        "Passwords do not match",
      );
    }

    const user = this.users.findById(userId);
    if (!user) {
      throw IdentityApplicationError.unauthorized("User not found");
    }

    const passwordMatches = await this.passwords.compare(
      command.currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      this.telemetry.warn({
        event: "auth.reset_password.failed",
        reason: "CURRENT_PASSWORD_MISMATCH",
        userId,
      });
      throw IdentityApplicationError.unauthorized("Invalid current password");
    }

    if (await this.passwords.compare(command.newPassword, user.passwordHash)) {
      throw IdentityApplicationError.validation(
        "newPassword",
        "New password must be different from current password",
      );
    }

    const passwordHash = await this.passwords.hash(command.newPassword);
    return this.transaction.run(() => {
      this.assertPasswordUnchanged(user.id, user.passwordHash);
      const updatedUser = this.users.updatePasswordHash(user.id, passwordHash);
      this.sessions.revokeUser(userId);
      const result = this.issueSession(updatedUser.id, updatedUser.email);
      this.telemetry.info({ event: "auth.reset_password.succeeded", userId });
      return result;
    });
  }

  private issueSession(userId: number, email: string): IssuedSession {
    return { user: { userId, email }, ...this.sessions.create(userId) };
  }
  private assertPasswordUnchanged(userId: number, expectedHash: string): void {
    const current = this.users.findById(userId);
    if (!current || current.passwordHash !== expectedHash) {
      throw IdentityApplicationError.unauthorized(
        "Credentials changed; sign in again",
      );
    }
  }
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
