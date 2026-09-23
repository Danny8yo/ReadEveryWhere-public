import { QaBookPort } from "./selection-qa-runtime.port";
import {
  SelectionQaStore,
  SelectionQaContentPort,
  SelectionQaError,
} from "./selection-qa.types";
export class SelectionQaLocationService {
  constructor(
    private readonly store: SelectionQaStore,
    private readonly content: SelectionQaContentPort,
    private readonly books: QaBookPort,
  ) {}
  async resolve(
    userId: number,
    input: { conversationId: string } | { turnId: string; evidenceId: string },
  ) {
    const conversationId =
      "conversationId" in input
        ? input.conversationId
        : this.store.turn(userId, input.turnId).conversationId;
    const conversation = this.store.conversation(userId, conversationId);
    this.assertCurrent(userId, conversationId);
    const selection = conversation.selection;
    const deadline = Date.now() + 10000;
    const signal = AbortSignal.timeout(10000);
    const evidence =
      "evidenceId" in input
        ? await this.books.replay(
            userId,
            selection,
            [this.store.findEvidence(userId, input.turnId, input.evidenceId)],
            deadline,
            signal,
          )
        : [
            await this.books.context(userId, selection, {
              sectionIndex: selection.scope.sectionIndex,
              href: selection.scope.href,
              start: selection.start,
              end: selection.end,
              maxChars: selection.end - selection.start,
              deadline,
              signal,
            }),
          ];
    if (evidence.length !== 1)
      throw new Error("Location replay must return exactly one range");
    this.assertCurrent(userId, conversationId);
    return {
      scope: {
        ...selection.scope,
        sectionIndex: evidence[0].sectionIndex,
        href: evidence[0].href,
      },
      artifact: selection.artifact,
      cfi: evidence[0].cfi,
      quote: evidence[0].quote,
      quoteHash: evidence[0].quoteHash,
      locator: evidence[0].locator,
    };
  }
  private assertCurrent(userId: number, id: string): void {
    const result = this.store.transact(() => {
      const c = this.store.conversation(userId, id);
      if (c.status === "frozen") return false;
      try {
        this.content.assertCurrent(userId, c.selection);
        return true;
      } catch (error) {
        if (
          error instanceof SelectionQaError &&
          error.code === "CONTENT_VERSION_CHANGED"
        ) {
          this.store.freeze(userId, id);
          return false;
        }
        throw error;
      }
    });
    if (!result) throw new SelectionQaError("CONVERSATION_FROZEN");
  }
}
