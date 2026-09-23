import {
  BUDGET_POLICIES,
  BUDGET_POLICY_CONSTRAINTS,
  BudgetLedger,
  BudgetPolicy,
  BudgetPolicyInput,
  resolveBudgetPolicy,
} from './budget';

const STARTED_AT = '2026-08-06T00:00:00.000Z';

describe('BudgetPolicy', () => {
  it('exposes the agreed quick, standard and deep limits', () => {
    expect(BUDGET_POLICIES).toEqual({
      quick: {
        tier: 'quick',
        maxDelegatedAgents: 0,
        maxConcurrentAgents: 0,
        maxModelTurns: 60,
        maxToolCalls: 90,
        maxReadCharacters: 250_000,
        maxDurationMs: 30 * 60_000,
      },
      standard: {
        tier: 'standard',
        maxDelegatedAgents: 2,
        maxConcurrentAgents: 2,
        maxModelTurns: 90,
        maxToolCalls: 135,
        maxReadCharacters: 500_000,
        maxDurationMs: 45 * 60_000,
      },
      deep: {
        tier: 'deep',
        maxDelegatedAgents: 6,
        maxConcurrentAgents: 3,
        maxModelTurns: 120,
        maxToolCalls: 180,
        maxReadCharacters: 750_000,
        maxDurationMs: 60 * 60_000,
      },
    } satisfies Record<string, BudgetPolicy>);
  });

  it('publishes finite server-authoritative constraints for every editable field', () => {
    expect(BUDGET_POLICY_CONSTRAINTS).toEqual({
      maxModelTurns: { min: 3, max: 200, step: 1 },
      maxToolCalls: { min: 3, max: 300, step: 1 },
      maxReadCharacters: { min: 4_000, max: 2_000_000, step: 1_000 },
      maxDurationMs: { min: 60_000, max: 7_200_000, step: 60_000 },
      maxDelegatedAgents: { min: 0, max: 12, step: 1 },
      maxConcurrentAgents: { min: 0, max: 3, step: 1 },
    });
  });

  it('resolves and clones a complete custom policy without changing its template tier', () => {
    const input: BudgetPolicyInput = {
      maxModelTurns: 120,
      maxToolCalls: 180,
      maxReadCharacters: 1_000_000,
      maxDurationMs: 60 * 60_000,
      maxDelegatedAgents: 9,
      maxConcurrentAgents: 3,
    };

    const policy = resolveBudgetPolicy('standard', input);
    input.maxModelTurns = 3;

    expect(policy).toEqual({ tier: 'standard', ...input, maxModelTurns: 120 });
    expect(resolveBudgetPolicy('quick')).toEqual(BUDGET_POLICIES.quick);
    expect(resolveBudgetPolicy('quick')).not.toBe(BUDGET_POLICIES.quick);
  });

  it.each([
    ['maxModelTurns', 2],
    ['maxModelTurns', 201],
    ['maxToolCalls', 2],
    ['maxToolCalls', 301],
    ['maxReadCharacters', 3_999],
    ['maxReadCharacters', 2_000_001],
    ['maxDurationMs', 59_999],
    ['maxDurationMs', 7_200_001],
    ['maxDelegatedAgents', -1],
    ['maxDelegatedAgents', 13],
    ['maxConcurrentAgents', -1],
    ['maxConcurrentAgents', 4],
    ['maxModelTurns', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects unsafe %s value %s', (field, value) => {
    const input: BudgetPolicyInput = {
      maxModelTurns: 60,
      maxToolCalls: 90,
      maxReadCharacters: 250_000,
      maxDurationMs: 30 * 60_000,
      maxDelegatedAgents: 6,
      maxConcurrentAgents: 3,
      [field]: value,
    };

    expect(() => resolveBudgetPolicy('deep', input)).toThrow(
      'BUDGET_POLICY_INVALID',
    );
  });

  it.each([
    { maxDelegatedAgents: 0, maxConcurrentAgents: 1 },
    { maxDelegatedAgents: 2, maxConcurrentAgents: 0 },
    { maxDelegatedAgents: 2, maxConcurrentAgents: 3 },
  ])('rejects inconsistent delegation limits: %j', (limits) => {
    expect(() =>
      resolveBudgetPolicy('standard', {
        maxModelTurns: 30,
        maxToolCalls: 45,
        maxReadCharacters: 100_000,
        maxDurationMs: 10 * 60_000,
        ...limits,
      }),
    ).toThrow('BUDGET_POLICY_INVALID');
  });

  it('allows disabling delegated agents only when concurrency is also zero', () => {
    expect(
      resolveBudgetPolicy('quick', {
        maxModelTurns: 10,
        maxToolCalls: 15,
        maxReadCharacters: 30_000,
        maxDurationMs: 3 * 60_000,
        maxDelegatedAgents: 0,
        maxConcurrentAgents: 0,
      }),
    ).toMatchObject({ maxDelegatedAgents: 0, maxConcurrentAgents: 0 });
  });
});

describe('BudgetLedger', () => {
  it('atomically refuses concurrent reservations beyond a limit', async () => {
    const ledger = BudgetLedger.create(BUDGET_POLICIES.quick, STARTED_AT);

    const reservations = await Promise.all(
      Array.from({ length: BUDGET_POLICIES.quick.maxToolCalls + 5 }, async (_, index) =>
        ledger.tryReserve(
          `tool-${index}`,
          { toolCalls: 1 },
          '2026-08-06T00:00:01.000Z',
        ),
      ),
    );

    expect(reservations.filter(Boolean)).toHaveLength(BUDGET_POLICIES.quick.maxToolCalls);
    expect(ledger.snapshot('2026-08-06T00:00:01.000Z').reserved.toolCalls).toBe(
      BUDGET_POLICIES.quick.maxToolCalls,
    );
    expect(
      ledger.tryReserve(
        'one-too-many',
        { toolCalls: 1 },
        '2026-08-06T00:00:01.000Z',
      ),
    ).toBeNull();
  });

  it('settles actual usage and releases unused reservation without overcharging', () => {
    const ledger = BudgetLedger.create(BUDGET_POLICIES.quick, STARTED_AT);
    ledger.reserveOrThrow(
      'read-1',
      { toolCalls: 1, readCharacters: 1_000 },
      '2026-08-06T00:00:01.000Z',
    );

    ledger.settle('read-1', { toolCalls: 1, readCharacters: 420 });

    expect(ledger.snapshot('2026-08-06T00:00:02.000Z')).toMatchObject({
      used: { modelTurns: 0, toolCalls: 1, readCharacters: 420 },
      reserved: { modelTurns: 0, toolCalls: 0, readCharacters: 0 },
      remaining: {
        modelTurns: BUDGET_POLICIES.quick.maxModelTurns,
        toolCalls: BUDGET_POLICIES.quick.maxToolCalls - 1,
        readCharacters: BUDGET_POLICIES.quick.maxReadCharacters - 420,
      },
    });
  });

  it('conservatively settles every abandoned reservation at its reserved amount', () => {
    const ledger = BudgetLedger.create(BUDGET_POLICIES.quick, STARTED_AT);
    ledger.reserveOrThrow(
      'model:interrupted',
      { modelTurns: 1 },
      '2026-08-06T00:00:01.000Z',
    );
    ledger.reserveOrThrow(
      'tool:interrupted',
      { toolCalls: 1, readCharacters: 8_000 },
      '2026-08-06T00:00:02.000Z',
    );

    expect(ledger.settleAbandonedReservations()).toEqual({
      reservationCount: 2,
      charged: { modelTurns: 1, toolCalls: 1, readCharacters: 8_000 },
    });
    expect(ledger.snapshot('2026-08-06T00:00:03.000Z')).toMatchObject({
      used: { modelTurns: 1, toolCalls: 1, readCharacters: 8_000 },
      reserved: { modelTurns: 0, toolCalls: 0, readCharacters: 0 },
      remaining: {
        modelTurns: BUDGET_POLICIES.quick.maxModelTurns - 1,
        toolCalls: BUDGET_POLICIES.quick.maxToolCalls - 1,
        readCharacters: BUDGET_POLICIES.quick.maxReadCharacters - 8_000,
      },
    });
    expect(ledger.settleAbandonedReservations()).toEqual({
      reservationCount: 0,
      charged: { modelTurns: 0, toolCalls: 0, readCharacters: 0 },
    });
  });

  it('rejects settlement above the reservation and duplicate reservation ids', () => {
    const ledger = BudgetLedger.create(BUDGET_POLICIES.quick, STARTED_AT);
    ledger.reserveOrThrow(
      'read-1',
      { readCharacters: 100 },
      '2026-08-06T00:00:01.000Z',
    );

    expect(() =>
      ledger.reserveOrThrow(
        'read-1',
        { readCharacters: 1 },
        '2026-08-06T00:00:01.000Z',
      ),
    ).toThrow('BUDGET_RESERVATION_DUPLICATE');
    expect(() =>
      ledger.settle('read-1', { readCharacters: 101 }),
    ).toThrow('BUDGET_SETTLEMENT_EXCEEDS_RESERVATION');
  });

  it('blocks all new work at the deadline and survives serialization', () => {
    const ledger = BudgetLedger.create(BUDGET_POLICIES.quick, STARTED_AT);
    ledger.reserveOrThrow(
      'turn-1',
      { modelTurns: 1 },
      '2026-08-06T00:00:01.000Z',
    );
    ledger.settle('turn-1', { modelTurns: 1 });

    const restored = BudgetLedger.fromJSON(ledger.toJSON());
    expect(
      restored.tryReserve(
        'turn-2',
        { modelTurns: 1 },
        new Date(Date.parse(STARTED_AT) + BUDGET_POLICIES.quick.maxDurationMs).toISOString(),
      ),
    ).toBeNull();
    expect(
      restored.snapshot(new Date(Date.parse(STARTED_AT) + BUDGET_POLICIES.quick.maxDurationMs).toISOString()).exhaustedBy,
    ).toContain('duration');
  });
});
