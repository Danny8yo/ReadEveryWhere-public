import { ReadingConversation } from './reading-conversation';

const NOW = '2026-08-16T00:00:00.000Z';

describe('ReadingConversation', () => {
  it('freezes the book scope and analysis profile at creation', () => {
    const conversation = ReadingConversation.create({
      id: 'conversation-1',
      userId: '1',
      bookId: '7',
      contentRevision: 'revision-1',
      rootGoal: '理解作者如何逐步建立全书的核心论证',
      profileSnapshot: profile(),
      now: NOW,
    });

    const json = conversation.toJSON();
    expect(json).toMatchObject({
      status: 'active',
      contentRevision: 'revision-1',
      profileSnapshot: {
        profileId: 'profile-1',
        strategyVersion: 'book-profile-v1',
      },
    });
    expect(ReadingConversation.fromJSON(json).toJSON()).toEqual(json);
  });

  it('permanently freezes when the current content revision changes', () => {
    const conversation = makeConversation();

    expect(conversation.freezeForRevision('revision-2', '2026-08-16T00:01:00.000Z')).toBe(true);
    expect(conversation.status).toBe('frozen');
    expect(conversation.toJSON()).toMatchObject({
      frozenReason: 'content_revision_changed',
      frozenAt: '2026-08-16T00:01:00.000Z',
    });
    expect(() => conversation.assertCanCreateTurn('revision-1')).toThrow('CONVERSATION_FROZEN');
    expect(() => conversation.freezeForRevision('revision-1', '2026-08-16T00:02:00.000Z'))
      .toThrow('CONVERSATION_FROZEN');
  });

  it('allows turns only for the frozen owner, book, and revision', () => {
    const conversation = makeConversation();

    expect(() => conversation.assertOwnedBy('2')).toThrow('CONVERSATION_NOT_FOUND');
    expect(() => conversation.assertBook('8')).toThrow('CONVERSATION_BOOK_MISMATCH');
    expect(() => conversation.assertCanCreateTurn('revision-2')).toThrow('CONVERSATION_REVISION_CHANGED');
    expect(conversation.status).toBe('frozen');
  });
});

function makeConversation() {
  return ReadingConversation.create({
    id: 'conversation-1', userId: '1', bookId: '7', contentRevision: 'revision-1',
    rootGoal: '理解作者如何逐步建立全书的核心论证', profileSnapshot: profile(), now: NOW,
  });
}

function profile() {
  return {
    profileId: 'profile-1', primaryGenre: 'nonfiction', secondaryGenres: ['history'], traits: ['argumentative'],
    confidence: 0.9, classificationSummary: 'A historical argument.',
    contentRevision: { fileChecksum: 'revision-1', extractorVersion: 'epub-v1', normalizationVersion: 'text-v1' },
    modelId: 'deepseek-v4-flash', strategyVersion: 'book-profile-v1', analyzedAt: NOW,
    spoilerPolicy: 'avoid_unless_user_requests' as const,
  };
}
