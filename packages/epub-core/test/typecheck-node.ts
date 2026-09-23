import { parseEpub, resolveEpubSelection, type ParsedEpub } from '../src/node.js';
import type { ContentScope, SelectionRequest } from '../src/types.js';
declare const bytes: Uint8Array;
declare const scope: ContentScope;
declare const request: SelectionRequest;
const parsed: Promise<ParsedEpub> = parseEpub(bytes);
resolveEpubSelection(bytes, scope, request);
void parsed;
// @ts-expect-error plain objects must never become empty byte buffers
parseEpub({});
// @ts-expect-error selection scope must include the revision and resource
resolveEpubSelection(bytes, { bookId: 1 }, request);

import { expandEpubEvidence, type ExpandedEpubEvidence, type ReplayInput } from '../src/node.js';
declare const hit: ReplayInput;
const expanded: Promise<ExpandedEpubEvidence[]> = expandEpubEvidence(bytes, scope, [hit], { maxChars: 8000, maxWindowChars: 2400, limit: 5 });
void expanded;
// @ts-expect-error expansion must specify a total and per-window budget
expandEpubEvidence(bytes, scope, [hit], {limit: 5});
