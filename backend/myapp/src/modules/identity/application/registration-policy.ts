export interface RegistrationEnvironment {
  NODE_ENV?: string;
  REGISTRATION_ENABLED?: string;
}

export function registrationEnabledFromEnvironment(
  environment: RegistrationEnvironment,
): boolean {
  const configured = environment.REGISTRATION_ENABLED;
  if (configured === undefined) {
    return environment.NODE_ENV !== "production";
  }
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error("REGISTRATION_ENABLED must be either true or false");
}

export class RegistrationPolicy {
  constructor(private readonly enabled: boolean) {}

  isEnabled(): boolean {
    return this.enabled;
  }
}
