import type { IdentityTelemetryPort } from "./ports/identity-telemetry.port";
import type { PasswordPort } from "./ports/password.port";
import type { UserRepositoryPort } from "./ports/user-repository.port";

/** 开发期重建库之后可以直接登录的固定账号。 */
export const DEV_SEED_EMAIL = "test@qq.com";
export const DEV_SEED_PASSWORD = "88888888";

export interface DevAccountSeedEnvironment {
  NODE_ENV?: string;
  DEV_SEED_ACCOUNT?: string;
}

/**
 * 是否在启动时种测试账号。
 *
 * 本项目处于开发期：库随时 drop & recreate，重建之后总得先有个账号才能导书。
 *
 * 默认只在本地开发种：`88888888` 是公开可猜的密码，生产环境默认必须关掉；测试环境也不种，
 * 否则每个 e2e 用例的初始用户数都要跟着变。真要在部署环境上重建库后直接登录，需要在 .env 里
 * 显式写 `DEV_SEED_ACCOUNT=true`——这是一个知情选择，不能靠默认值悄悄发生。取值规则与
 * REGISTRATION_ENABLED 一致：只接受字面值 true/false，写错直接让应用启动失败。
 */
export function shouldSeedDevAccount(environment: DevAccountSeedEnvironment): boolean {
  const configured = environment.DEV_SEED_ACCOUNT;
  if (configured === undefined || configured === "") {
    return environment.NODE_ENV !== "production" && environment.NODE_ENV !== "test";
  }
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error("DEV_SEED_ACCOUNT must be either true or false");
}

export class DevAccountSeed {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly passwords: PasswordPort,
    private readonly telemetry: IdentityTelemetryPort,
    private readonly enabled: boolean,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    if (this.users.findByEmail(DEV_SEED_EMAIL)) return;
    this.users.create(DEV_SEED_EMAIL, await this.passwords.hash(DEV_SEED_PASSWORD));
    this.telemetry.info({ event: "identity.dev_account.seeded", email: DEV_SEED_EMAIL });
  }
}
