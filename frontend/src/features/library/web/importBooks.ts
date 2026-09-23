import type { LibraryInvalidationPort } from '../domain/queryCache';
import { importSelection, type ImportSelection } from '../domain/import';
import { importBookWithMetadata, importBooksBatch } from '../api/libraryApi';
export const importBooks = async (input: ImportSelection<File>, invalidation: LibraryInvalidationPort) => { try { return await importSelection(input, { single: importBookWithMetadata, batch: importBooksBatch }); } finally { invalidation.invalidate(); } };
