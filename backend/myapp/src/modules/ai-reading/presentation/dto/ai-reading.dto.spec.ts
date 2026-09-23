import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateReadingConversationDto,
  CreateReadingConversationTurnDto,
  RetryReadingConversationTurnDto,
} from './ai-reading.dto';

const validPolicy = {
  maxModelTurns: 120,
  maxToolCalls: 180,
  maxReadCharacters: 1_000_000,
  maxDurationMs: 60 * 60_000,
  maxDelegatedAgents: 9,
  maxConcurrentAgents: 3,
};

async function errorsFor(input: Record<string, unknown>) {
  return validate(plainToInstance(CreateReadingConversationDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function flattenMessages(
  errors: Awaited<ReturnType<typeof errorsFor>>,
): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenMessages(error.children ?? []),
  ]);
}

describe('CreateReadingConversationDto budget policy', () => {
  it('accepts a preset-only request', async () => {
    await expect(
      errorsFor({ bookId: 1, message: 'Read this book', budgetTier: 'quick' }),
    ).resolves.toEqual([]);
  });

  it('transforms and accepts a complete custom policy', async () => {
    const dto = plainToInstance(CreateReadingConversationDto, {
      bookId: '42',
      message: 'Read broadly',
      budgetTier: 'standard',
      budgetPolicy: Object.fromEntries(
        Object.entries(validPolicy).map(([key, value]) => [key, String(value)]),
      ),
    });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.bookId).toBe(42);
    expect(dto.budgetPolicy).toEqual(validPolicy);
  });

  it('rejects a partial custom policy', async () => {
    const errors = await errorsFor({
      bookId: 1,
      message: 'Read this book',
      budgetTier: 'standard',
      budgetPolicy: { maxModelTurns: 100 },
    });

    expect(flattenMessages(errors)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('maxToolCalls'),
        expect.stringContaining('maxReadCharacters'),
        expect.stringContaining('maxDurationMs'),
        expect.stringContaining('maxDelegatedAgents'),
        expect.stringContaining('maxConcurrentAgents'),
      ]),
    );
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
    ['maxModelTurns', 3.5],
  ] as const)('rejects %s value %s outside the safe contract', async (field, value) => {
    const errors = await errorsFor({
      bookId: 1,
      message: 'Read this book',
      budgetTier: 'deep',
      budgetPolicy: { ...validPolicy, [field]: value },
    });

    expect(flattenMessages(errors).join(' ')).toContain(field);
  });

  it.each([
    { maxDelegatedAgents: 0, maxConcurrentAgents: 1 },
    { maxDelegatedAgents: 2, maxConcurrentAgents: 0 },
    { maxDelegatedAgents: 2, maxConcurrentAgents: 3 },
  ])('rejects inconsistent delegation limits: %j', async (limits) => {
    const errors = await errorsFor({
      bookId: 1,
      message: 'Read this book',
      budgetTier: 'standard',
      budgetPolicy: { ...validPolicy, ...limits },
    });

    expect(flattenMessages(errors).join(' ')).toContain('maxConcurrentAgents');
  });

  it('rejects unknown fields at both request and nested policy levels', async () => {
    const errors = await errorsFor({
      bookId: 1,
      message: 'Read this book',
      budgetTier: 'standard',
      unknownRequestField: true,
      budgetPolicy: { ...validPolicy, tier: 'deep' },
    });

    expect(flattenMessages(errors)).toEqual(
      expect.arrayContaining([
        'property unknownRequestField should not exist',
        'property tier should not exist',
      ]),
    );
  });
});

describe('reading conversation DTOs', () => {
  it('accepts a first turn with an optional reader focus hint', async () => {
    const dto = plainToInstance(CreateReadingConversationDto, {
      bookId: '42', message: '解释作者为何这样组织前三章', budgetTier: 'quick',
      readerFocus: { sectionIndex: '3', chapterLabel: '第三章' },
    });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto).toMatchObject({ bookId: 42, readerFocus: { sectionIndex: 3, chapterLabel: '第三章' } });
  });

  it('requires a message for normal follow-up but permits an omitted retry message', async () => {
    const turn = plainToInstance(CreateReadingConversationTurnDto, { budgetTier: 'standard' });
    expect(await validate(turn, { whitelist: true, forbidNonWhitelisted: true })).not.toEqual([]);

    const retry = plainToInstance(RetryReadingConversationTurnDto, {});
    expect(await validate(retry, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('rejects untrusted reader focus fields and invalid section indexes', async () => {
    const dto = plainToInstance(CreateReadingConversationDto, {
      bookId: 42, message: '继续读这一章', budgetTier: 'quick',
      readerFocus: { sectionIndex: -1, href: '/forged.xhtml' },
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(flattenMessages(errors)).toEqual(expect.arrayContaining([
      expect.stringContaining('sectionIndex'),
      'property href should not exist',
    ]));
  });
});
