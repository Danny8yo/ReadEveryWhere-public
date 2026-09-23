import {
  AnnotationSelectionCommandPort,
  ReadingStateError,
} from "../../../reading-state/public";
import {
  AnnotationApplicationPort,
  ApplyAnnotationInput,
} from "../application/annotation-application.port";
import {
  SelectionSnapshot,
  SelectionQaError,
} from "../application/selection-qa.types";
export class SelectionQaAnnotationAdapter implements AnnotationApplicationPort {
  constructor(private readonly annotations: AnnotationSelectionCommandPort) {}
  findReceipt(userId: number, id: string, digest?: string) {
    try {
      return this.annotations.findReceipt(userId, id, digest);
    } catch (error) {
      this.rethrow(error);
    }
  }
  async execute(
    userId: number,
    input: ApplyAnnotationInput & {
      requestDigest: string;
      selection: SelectionSnapshot;
    },
  ) {
    try {
      const target =
        input.target.kind === "create"
          ? {
              ...input.target,
              bookHash: input.selection.scope.fileChecksum.replace(
                /^sha256:/,
                "",
              ),
            }
          : input.target;
      return await this.annotations.execute(userId, { ...input, target });
    } catch (error) {
      this.rethrow(error);
    }
  }
  private rethrow(error: unknown): never {
    if (error instanceof ReadingStateError) {
      const status =
        error.code === "READING_STATE_INTERNAL"
          ? 500
          : error.code.endsWith("NOT_FOUND")
            ? 404
            : error.code === "ANNOTATION_SELECTION_INVALID"
              ? 400
              : 409;
      throw new SelectionQaError(error.code, status, error.current);
    }
    throw error;
  }
}
