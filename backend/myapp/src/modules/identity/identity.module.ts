import { SessionValidityAdapter } from "./infrastructure/persistence/sqlite/session-validity.adapter";
import { SESSION_VALIDITY_PORT } from "./public/session-validity.port";
import { SessionCredentials } from "./infrastructure/security/session-credentials";
import {
  SESSION_CREDENTIALS_PORT,
  type SessionCredentialsPort,
} from "./application/ports/session-credentials.port";
import { SqliteIdentityTransaction } from "./infrastructure/persistence/sqlite/identity-transaction";
import {
  IDENTITY_TRANSACTION_PORT,
  type IdentityTransactionPort,
} from "./application/ports/identity-transaction.port";
import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { SqlitePersistenceModule } from "../../platform/persistence/sqlite/sqlite-persistence.module";
import { AiAccessTokenService } from "./application/ai-access-token.service";
import { AuthService } from "./application/auth.service";
import {
  DevAccountSeed,
  shouldSeedDevAccount,
} from "./application/dev-account-seed";
import {
  RegistrationPolicy,
  registrationEnabledFromEnvironment,
} from "./application/registration-policy";
import {
  AI_ACCESS_TOKEN_REPOSITORY_PORT,
  type AiAccessTokenRepositoryPort,
} from "./application/ports/ai-access-token-repository.port";
import {
  IDENTITY_TELEMETRY_PORT,
  type IdentityTelemetryPort,
} from "./application/ports/identity-telemetry.port";
import {
  PASSWORD_PORT,
  type PasswordPort,
} from "./application/ports/password.port";
import {
  SESSION_REPOSITORY_PORT,
  type SessionRepositoryPort,
} from "./application/ports/session-repository.port";
import { SessionService, sessionPolicy } from "./application/session.service";
import { cookieSecureMode } from "./presentation/http/session-cookie";
import {
  USER_REPOSITORY_PORT,
  type UserRepositoryPort,
} from "./application/ports/user-repository.port";
import { AiAccessTokenRepository } from "./infrastructure/persistence/sqlite/ai-access-token.repository";
import { SessionsRepository } from "./infrastructure/persistence/sqlite/sessions.repository";
import { UsersRepository } from "./infrastructure/persistence/sqlite/users.repository";
import { PasswordService } from "./infrastructure/security/password.service";
import { NestIdentityTelemetryAdapter } from "./infrastructure/telemetry/nest-identity-telemetry.adapter";
import { AuthController } from "./presentation/http/controllers/auth.controller";
import { SessionAuthGuard } from "./presentation/http/guards/session-auth.guard";
import { RegistrationEnabledGuard } from "./presentation/http/guards/registration-enabled.guard";

@Module({
  imports: [SqlitePersistenceModule],
  controllers: [AuthController],
  exports: [SESSION_VALIDITY_PORT],
  providers: [
    SessionValidityAdapter,
    { provide: SESSION_VALIDITY_PORT, useExisting: SessionValidityAdapter },
    UsersRepository,
    SqliteIdentityTransaction,
    {
      provide: IDENTITY_TRANSACTION_PORT,
      useExisting: SqliteIdentityTransaction,
    },
    SessionsRepository,
    SessionCredentials,
    { provide: SESSION_CREDENTIALS_PORT, useExisting: SessionCredentials },
    AiAccessTokenRepository,
    PasswordService,
    NestIdentityTelemetryAdapter,
    RegistrationEnabledGuard,
    {
      provide: RegistrationPolicy,
      useFactory: () =>
        new RegistrationPolicy(registrationEnabledFromEnvironment(process.env)),
    },
    { provide: USER_REPOSITORY_PORT, useExisting: UsersRepository },
    { provide: SESSION_REPOSITORY_PORT, useExisting: SessionsRepository },
    {
      provide: AI_ACCESS_TOKEN_REPOSITORY_PORT,
      useExisting: AiAccessTokenRepository,
    },
    { provide: PASSWORD_PORT, useExisting: PasswordService },
    {
      provide: SessionService,
      inject: [SESSION_REPOSITORY_PORT, SESSION_CREDENTIALS_PORT],
      useFactory: (
        repository: SessionRepositoryPort,
        credentials: SessionCredentialsPort,
      ) => {
        cookieSecureMode();
        return new SessionService(
          repository,
          sessionPolicy(process.env),
          credentials,
        );
      },
    },
    {
      provide: IDENTITY_TELEMETRY_PORT,
      useExisting: NestIdentityTelemetryAdapter,
    },
    {
      provide: AuthService,
      inject: [
        USER_REPOSITORY_PORT,
        PASSWORD_PORT,
        SessionService,
        IDENTITY_TELEMETRY_PORT,
        IDENTITY_TRANSACTION_PORT,
      ],
      useFactory: (
        users: UserRepositoryPort,
        passwords: PasswordPort,
        sessions: SessionService,
        telemetry: IdentityTelemetryPort,
        transaction: IdentityTransactionPort,
      ) => new AuthService(users, passwords, sessions, telemetry, transaction),
    },
    {
      // 开发期重建库之后直接有账号可登录；生产环境默认不种，需要 DEV_SEED_ACCOUNT=true
      // 显式开启（见 dev-account-seed.ts）。
      provide: DevAccountSeed,
      inject: [USER_REPOSITORY_PORT, PASSWORD_PORT, IDENTITY_TELEMETRY_PORT],
      useFactory: (
        users: UserRepositoryPort,
        passwords: PasswordPort,
        telemetry: IdentityTelemetryPort,
      ) =>
        new DevAccountSeed(
          users,
          passwords,
          telemetry,
          shouldSeedDevAccount(process.env),
        ),
    },
    {
      provide: AiAccessTokenService,
      inject: [AI_ACCESS_TOKEN_REPOSITORY_PORT],
      useFactory: (repository: AiAccessTokenRepositoryPort) =>
        new AiAccessTokenService(repository),
    },
    {
      provide: SessionAuthGuard,
      inject: [Reflector, SessionService, AiAccessTokenService],
      useFactory: (
        reflector: Reflector,
        sessions: SessionService,
        aiAccessTokens: AiAccessTokenService,
      ) => new SessionAuthGuard(reflector, sessions, aiAccessTokens),
    },
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
  ],
})
export class IdentityModule {}
