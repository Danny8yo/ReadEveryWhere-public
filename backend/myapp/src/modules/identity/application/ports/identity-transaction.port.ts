export interface IdentityTransactionPort {
  run<T>(work: () => T): T;
}
export const IDENTITY_TRANSACTION_PORT = Symbol("IDENTITY_TRANSACTION_PORT");
