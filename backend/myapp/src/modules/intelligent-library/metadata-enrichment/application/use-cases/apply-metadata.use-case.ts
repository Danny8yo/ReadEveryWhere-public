import type {
  ApplyBookMetadataCommand,
  ApplyBookMetadataPort,
} from "../../../catalog/application/ports/apply-book-metadata.port";

export class ApplyMetadataUseCase {
  constructor(private readonly catalog: ApplyBookMetadataPort) {}

  execute(
    userId: number,
    bookId: number,
    command: Readonly<ApplyBookMetadataCommand>,
  ) {
    return this.catalog.apply(userId, bookId, command);
  }
}
