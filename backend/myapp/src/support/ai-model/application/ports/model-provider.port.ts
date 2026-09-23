import type {
  ModelCompletion,
  ModelCompletionRequest,
  ModelTextDeltaHandler,
  ModelTextStreamRequest,
} from "./language-model.port";

export interface ModelProvider {
  readonly providerId: string;
  complete(request: ModelCompletionRequest): Promise<ModelCompletion>;
  streamText?(
    request: ModelTextStreamRequest,
    onDelta: ModelTextDeltaHandler,
  ): Promise<ModelCompletion>;
}
