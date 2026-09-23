import type {
  ConversationCheckpoint,
  ReaderFocusHint,
  TrustedBookAnalysisContext,
} from '../domain';
import type { ConversationRetryContext } from './conversation-retry-context';

export interface ConversationContextEnvelopeV2 {
  schemaVersion: 2;
  rootGoal: string;
  currentMessage: string;
  profile: {
    profileId: string;
    profileVersion: number | null;
    primaryGenre: string;
    secondaryGenres: string[];
    traits: string[];
    confidence: { kind: 'ai-score'; score: number } | { kind: 'user-determined' };
    classificationSummary: string | null;
    strategyVersion?: string;
    spoilerPolicy: 'avoid_unless_user_requests';
  };
  checkpoint: ReturnType<ConversationCheckpoint['toJSON']> | null;
  readerFocus: ReaderFocusHint | null;
  retrySource: ConversationRetryContext | null;
}

export class ConversationContextBuilder {
  build(input: {
    rootGoal: string;
    currentMessage: string;
    checkpoint: ConversationCheckpoint | null;
    profileSnapshot: TrustedBookAnalysisContext;
    readerFocus: ReaderFocusHint | null;
    retrySource?: ConversationRetryContext | null;
  }): ConversationContextEnvelopeV2 {
    const profile = input.profileSnapshot;
    return {
      schemaVersion: 2,
      rootGoal: input.rootGoal,
      currentMessage: input.currentMessage,
      profile: {
        profileId: profile.profileId,
        profileVersion: profile.profileVersion ?? null,
        primaryGenre: profile.primaryGenre,
        secondaryGenres: [...profile.secondaryGenres],
        traits: [...profile.traits],
        confidence: typeof profile.confidence === 'number'
          ? { kind: 'ai-score', score: profile.confidence }
          : { ...profile.confidence },
        classificationSummary: profile.classificationSummary,
        ...(profile.strategyVersion ? { strategyVersion: profile.strategyVersion } : {}),
        spoilerPolicy: profile.spoilerPolicy,
      },
      checkpoint: input.checkpoint?.toJSON() ?? null,
      readerFocus: input.readerFocus ? { ...input.readerFocus } : null,
      retrySource: input.retrySource ? structuredClone(input.retrySource) : null,
    };
  }
}
