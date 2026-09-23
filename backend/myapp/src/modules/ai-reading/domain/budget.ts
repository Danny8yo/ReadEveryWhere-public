import {
  AiReadingDomainError,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export type BudgetTier = 'quick' | 'standard' | 'deep';
export type BudgetMode = 'preset' | 'custom';

export interface BudgetPolicy {
  tier: BudgetTier;
  maxDelegatedAgents: number;
  maxConcurrentAgents: number;
  maxModelTurns: number;
  maxToolCalls: number;
  maxReadCharacters: number;
  maxDurationMs: number;
}

export type BudgetPolicyInput = Omit<BudgetPolicy, 'tier'>;

export interface BudgetPolicyConstraint {
  min: number;
  max: number;
  step: number;
}

export const BUDGET_POLICY_CONSTRAINTS: Readonly<
  Record<keyof BudgetPolicyInput, BudgetPolicyConstraint>
> = Object.freeze({
  maxModelTurns: Object.freeze({ min: 3, max: 200, step: 1 }),
  maxToolCalls: Object.freeze({ min: 3, max: 300, step: 1 }),
  maxReadCharacters: Object.freeze({ min: 4_000, max: 2_000_000, step: 1_000 }),
  maxDurationMs: Object.freeze({ min: 60_000, max: 7_200_000, step: 60_000 }),
  maxDelegatedAgents: Object.freeze({ min: 0, max: 12, step: 1 }),
  maxConcurrentAgents: Object.freeze({ min: 0, max: 3, step: 1 }),
});

export const BUDGET_POLICIES: Readonly<Record<BudgetTier, BudgetPolicy>> =
  Object.freeze({
    quick: Object.freeze({
      tier: 'quick',
      maxDelegatedAgents: 0,
      maxConcurrentAgents: 0,
      maxModelTurns: 60,
      maxToolCalls: 90,
      maxReadCharacters: 250_000,
      maxDurationMs: 30 * 60_000,
    }),
    standard: Object.freeze({
      tier: 'standard',
      maxDelegatedAgents: 2,
      maxConcurrentAgents: 2,
      maxModelTurns: 90,
      maxToolCalls: 135,
      maxReadCharacters: 500_000,
      maxDurationMs: 45 * 60_000,
    }),
    deep: Object.freeze({
      tier: 'deep',
      maxDelegatedAgents: 6,
      maxConcurrentAgents: 3,
      maxModelTurns: 120,
      maxToolCalls: 180,
      maxReadCharacters: 750_000,
      maxDurationMs: 60 * 60_000,
    }),
  });

export interface BudgetUsage {
  modelTurns: number;
  toolCalls: number;
  readCharacters: number;
}

export type BudgetRequest = Partial<BudgetUsage>;
export type BudgetDimension =
  | 'modelTurns'
  | 'toolCalls'
  | 'readCharacters'
  | 'duration';

export interface BudgetReservation {
  id: string;
  amount: BudgetUsage;
  reservedAt: string;
}

export interface BudgetSnapshot {
  policy: BudgetPolicy;
  startedAt: string;
  used: BudgetUsage;
  reserved: BudgetUsage;
  remaining: BudgetUsage;
  elapsedMs: number;
  exhaustedBy: BudgetDimension[];
}

export interface BudgetLedgerJSON {
  policy: BudgetPolicy;
  startedAt: string;
  used: BudgetUsage;
  reservations: BudgetReservation[];
}

const ZERO_USAGE: BudgetUsage = {
  modelTurns: 0,
  toolCalls: 0,
  readCharacters: 0,
};

const USAGE_KEYS = [
  'modelTurns',
  'toolCalls',
  'readCharacters',
] as const satisfies readonly (keyof BudgetUsage)[];

function normalizeUsage(value: BudgetRequest, allowZero = false): BudgetUsage {
  const usage: BudgetUsage = {
    modelTurns: value.modelTurns ?? 0,
    toolCalls: value.toolCalls ?? 0,
    readCharacters: value.readCharacters ?? 0,
  };
  for (const key of USAGE_KEYS) {
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) {
      throw new AiReadingDomainError(
        'BUDGET_USAGE_INVALID',
        `${key} must be a non-negative safe integer`,
        { key, value: usage[key] },
      );
    }
  }
  if (!allowZero && USAGE_KEYS.every((key) => usage[key] === 0)) {
    throw new AiReadingDomainError(
      'BUDGET_USAGE_INVALID',
      'a reservation must consume at least one budget dimension',
    );
  }
  return usage;
}

const POLICY_INPUT_KEYS = [
  'maxModelTurns',
  'maxToolCalls',
  'maxReadCharacters',
  'maxDurationMs',
  'maxDelegatedAgents',
  'maxConcurrentAgents',
] as const satisfies readonly (keyof BudgetPolicyInput)[];

function clonePolicy(policy: BudgetPolicy): BudgetPolicy {
  if (!['quick', 'standard', 'deep'].includes(policy.tier)) {
    throw new AiReadingDomainError('BUDGET_POLICY_INVALID', 'unknown budget tier');
  }
  for (const key of POLICY_INPUT_KEYS) {
    const constraint = BUDGET_POLICY_CONSTRAINTS[key];
    if (
      !Number.isSafeInteger(policy[key]) ||
      policy[key] < constraint.min ||
      policy[key] > constraint.max
    ) {
      throw new AiReadingDomainError(
        'BUDGET_POLICY_INVALID',
        `${key} must be a safe integer between ${constraint.min} and ${constraint.max}`,
        { key, value: policy[key] },
      );
    }
  }
  if (policy.maxConcurrentAgents > policy.maxDelegatedAgents) {
    throw new AiReadingDomainError(
      'BUDGET_POLICY_INVALID',
      'concurrency cannot exceed total delegated agents',
    );
  }
  if (
    (policy.maxDelegatedAgents === 0 && policy.maxConcurrentAgents !== 0) ||
    (policy.maxDelegatedAgents > 0 && policy.maxConcurrentAgents === 0)
  ) {
    throw new AiReadingDomainError(
      'BUDGET_POLICY_INVALID',
      'delegated agents and concurrency must both be zero or both be positive',
    );
  }
  return {
    tier: policy.tier,
    maxModelTurns: policy.maxModelTurns,
    maxToolCalls: policy.maxToolCalls,
    maxReadCharacters: policy.maxReadCharacters,
    maxDurationMs: policy.maxDurationMs,
    maxDelegatedAgents: policy.maxDelegatedAgents,
    maxConcurrentAgents: policy.maxConcurrentAgents,
  };
}

export function resolveBudgetPolicy(
  tier: BudgetTier,
  input?: BudgetPolicyInput,
): BudgetPolicy {
  const preset = BUDGET_POLICIES[tier];
  if (!preset) {
    throw new AiReadingDomainError('BUDGET_POLICY_INVALID', 'unknown budget tier');
  }
  return clonePolicy(input ? { tier, ...input } : preset);
}

export class BudgetLedger {
  private readonly reservations = new Map<string, BudgetReservation>();

  private constructor(
    private readonly policyValue: BudgetPolicy,
    private startedAtValue: string,
    private readonly usedValue: BudgetUsage,
  ) {}

  static create(policy: BudgetPolicy, startedAt: string): BudgetLedger {
    requireIsoDate(startedAt, 'BUDGET_STARTED_AT_INVALID', 'startedAt');
    return new BudgetLedger(clonePolicy(policy), startedAt, { ...ZERO_USAGE });
  }

  get startedAt(): string {
    return this.startedAtValue;
  }

  startExecution(now: string): void {
    requireIsoDate(now, 'BUDGET_STARTED_AT_INVALID', 'now');
    const hasUsage = USAGE_KEYS.some((key) => this.usedValue[key] > 0);
    if (hasUsage || this.reservations.size > 0) {
      throw new AiReadingDomainError(
        'BUDGET_ALREADY_IN_USE',
        'execution start cannot change after budget use begins',
      );
    }
    this.startedAtValue = now;
  }

  static fromJSON(value: BudgetLedgerJSON): BudgetLedger {
    const ledger = new BudgetLedger(
      clonePolicy(value.policy),
      value.startedAt,
      normalizeUsage(value.used, true),
    );
    requireIsoDate(value.startedAt, 'BUDGET_STARTED_AT_INVALID', 'startedAt');
    for (const raw of value.reservations) {
      requireNonEmpty(raw.id, 'BUDGET_RESERVATION_INVALID', 'id');
      requireIsoDate(
        raw.reservedAt,
        'BUDGET_RESERVATION_INVALID',
        'reservedAt',
      );
      if (ledger.reservations.has(raw.id)) {
        throw new AiReadingDomainError(
          'BUDGET_RESERVATION_DUPLICATE',
          'reservation id already exists',
          { reservationId: raw.id },
        );
      }
      ledger.reservations.set(raw.id, {
        id: raw.id,
        amount: normalizeUsage(raw.amount),
        reservedAt: raw.reservedAt,
      });
    }
    ledger.assertWithinLimits();
    return ledger;
  }

  get policy(): BudgetPolicy {
    return { ...this.policyValue };
  }

  tryReserve(
    id: string,
    request: BudgetRequest,
    now: string,
  ): BudgetReservation | null {
    requireNonEmpty(id, 'BUDGET_RESERVATION_INVALID', 'id');
    requireIsoDate(now, 'BUDGET_RESERVATION_INVALID', 'now');
    if (this.reservations.has(id)) {
      throw new AiReadingDomainError(
        'BUDGET_RESERVATION_DUPLICATE',
        'reservation id already exists',
        { reservationId: id },
      );
    }
    const amount = normalizeUsage(request);
    const snapshot = this.snapshot(now);
    if (snapshot.exhaustedBy.includes('duration')) {
      return null;
    }
    if (
      snapshot.remaining.modelTurns < amount.modelTurns ||
      snapshot.remaining.toolCalls < amount.toolCalls ||
      snapshot.remaining.readCharacters < amount.readCharacters
    ) {
      return null;
    }
    const reservation: BudgetReservation = { id, amount, reservedAt: now };
    this.reservations.set(id, reservation);
    return {
      ...reservation,
      amount: { ...reservation.amount },
    };
  }

  reserveOrThrow(
    id: string,
    request: BudgetRequest,
    now: string,
  ): BudgetReservation {
    const reservation = this.tryReserve(id, request, now);
    if (!reservation) {
      throw new AiReadingDomainError(
        'BUDGET_EXHAUSTED',
        'requested work exceeds the remaining budget',
        { reservationId: id },
      );
    }
    return reservation;
  }

  settle(id: string, actual: BudgetRequest): void {
    const reservation = this.reservations.get(id);
    if (!reservation) {
      throw new AiReadingDomainError(
        'BUDGET_RESERVATION_NOT_FOUND',
        'reservation does not exist',
        { reservationId: id },
      );
    }
    const usage = normalizeUsage(actual, true);
    if (USAGE_KEYS.some((key) => usage[key] > reservation.amount[key])) {
      throw new AiReadingDomainError(
        'BUDGET_SETTLEMENT_EXCEEDS_RESERVATION',
        'actual usage cannot exceed its reservation',
        { reservationId: id },
      );
    }
    for (const key of USAGE_KEYS) {
      this.usedValue[key] += usage[key];
    }
    this.reservations.delete(id);
    this.assertWithinLimits();
  }

  settleAbandonedReservations(): {
    reservationCount: number;
    charged: BudgetUsage;
  } {
    const abandoned = [...this.reservations.values()].map((reservation) => ({
      ...reservation,
      amount: { ...reservation.amount },
    }));
    const charged = { ...ZERO_USAGE };
    for (const reservation of abandoned) {
      for (const key of USAGE_KEYS) charged[key] += reservation.amount[key];
      this.settle(reservation.id, reservation.amount);
    }
    return {
      reservationCount: abandoned.length,
      charged,
    };
  }

  release(id: string): void {
    if (!this.reservations.delete(id)) {
      throw new AiReadingDomainError(
        'BUDGET_RESERVATION_NOT_FOUND',
        'reservation does not exist',
        { reservationId: id },
      );
    }
  }

  snapshot(now: string): BudgetSnapshot {
    requireIsoDate(now, 'BUDGET_SNAPSHOT_INVALID', 'now');
    const reserved = this.reservedUsage();
    const remaining = {
      modelTurns: Math.max(
        0,
        this.policyValue.maxModelTurns -
          this.usedValue.modelTurns -
          reserved.modelTurns,
      ),
      toolCalls: Math.max(
        0,
        this.policyValue.maxToolCalls -
          this.usedValue.toolCalls -
          reserved.toolCalls,
      ),
      readCharacters: Math.max(
        0,
        this.policyValue.maxReadCharacters -
          this.usedValue.readCharacters -
          reserved.readCharacters,
      ),
    };
    const elapsedMs = Math.max(0, Date.parse(now) - Date.parse(this.startedAtValue));
    const exhaustedBy: BudgetDimension[] = [];
    if (remaining.modelTurns === 0) exhaustedBy.push('modelTurns');
    if (remaining.toolCalls === 0) exhaustedBy.push('toolCalls');
    if (remaining.readCharacters === 0) exhaustedBy.push('readCharacters');
    if (elapsedMs >= this.policyValue.maxDurationMs) exhaustedBy.push('duration');
    return {
      policy: this.policy,
      startedAt: this.startedAtValue,
      used: { ...this.usedValue },
      reserved,
      remaining,
      elapsedMs,
      exhaustedBy,
    };
  }

  toJSON(): BudgetLedgerJSON {
    return {
      policy: this.policy,
      startedAt: this.startedAtValue,
      used: { ...this.usedValue },
      reservations: [...this.reservations.values()].map((reservation) => ({
        ...reservation,
        amount: { ...reservation.amount },
      })),
    };
  }

  private reservedUsage(): BudgetUsage {
    const total = { ...ZERO_USAGE };
    for (const reservation of this.reservations.values()) {
      for (const key of USAGE_KEYS) total[key] += reservation.amount[key];
    }
    return total;
  }

  private assertWithinLimits(): void {
    const reserved = this.reservedUsage();
    if (
      this.usedValue.modelTurns + reserved.modelTurns >
        this.policyValue.maxModelTurns ||
      this.usedValue.toolCalls + reserved.toolCalls >
        this.policyValue.maxToolCalls ||
      this.usedValue.readCharacters + reserved.readCharacters >
        this.policyValue.maxReadCharacters
    ) {
      throw new AiReadingDomainError(
        'BUDGET_STATE_INVALID',
        'stored budget exceeds policy limits',
      );
    }
  }
}
