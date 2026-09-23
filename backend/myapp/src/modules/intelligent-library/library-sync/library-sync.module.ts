import { Module } from "@nestjs/common";
import { LibrarySyncState } from "./library-sync-state";
import { LIBRARY_PROJECTION_CHANGE_PORT } from "../public/library-projection-change.port";
@Module({
  providers: [
    LibrarySyncState,
    { provide: LIBRARY_PROJECTION_CHANGE_PORT, useExisting: LibrarySyncState },
  ],
  exports: [LibrarySyncState, LIBRARY_PROJECTION_CHANGE_PORT],
})
export class LibrarySyncModule {}
