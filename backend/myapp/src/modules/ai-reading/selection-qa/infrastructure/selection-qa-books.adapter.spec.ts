import { SelectionQaBooksAdapter } from './selection-qa-books.adapter';
import type { BookRetrievalPort } from '../../../intelligent-library/public/book-retrieval.port';
import type { SelectionSnapshot } from '../application/selection-qa.types';
it('limits each book operation to 60s without extending the overall turn deadline', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const port = { readContext: jest.fn(), searchCandidates: jest.fn(), expandSelected: jest.fn(), replay: jest.fn() };
    const adapter = new SelectionQaBooksAdapter(port as unknown as BookRetrievalPort);
    const selection = { scope: { bookId: 1 }, artifact: {} } as SelectionSnapshot;
    const signal = new AbortController().signal;
    for (const deadline of [91000, 5000, 999]) {
      await adapter.context(1, selection, { sectionIndex: 0, href: 'a', start: 0, end: 1, maxChars: 1, deadline, signal });
      await adapter.searchCandidates(1, selection, { queries: ['SSD'], limit: 1, maxChars: 8000, deadline, signal });
      await adapter.expandSelected(1, selection, { evidence: [], maxChars: 8000, maxWindowChars: 1600, deadline, signal });
      await adapter.replay(1, selection, [], deadline, signal);
      for (const call of [port.readContext, port.searchCandidates, port.expandSelected, port.replay]) expect(call).toHaveBeenLastCalledWith(1, expect.objectContaining({ deadline: Math.min(deadline, 61000), signal }));
    }
  } finally { jest.restoreAllMocks(); }
});
