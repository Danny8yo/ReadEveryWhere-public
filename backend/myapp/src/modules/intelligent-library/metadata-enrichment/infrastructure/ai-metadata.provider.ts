import { Injectable } from "@nestjs/common";
import type { MetadataSourcePort, MetadataSourceRequest, ScrapedBook } from "../../public";
import { GenerateBookMetadataUseCase } from "../application/use-cases/generate-book-metadata.use-case";

@Injectable()
export class AiMetadataProvider implements MetadataSourcePort {
  readonly platform = "AI";

  constructor(private readonly generator: GenerateBookMetadataUseCase) {}

  async search(input: MetadataSourceRequest): Promise<ScrapedBook[]> {
    if (!input.bookId) throw new Error("AI metadata provider requires bookId");
    const result = await this.generator.execute(input.userId, input.bookId, input.requestId);
    const { requestId: _requestId, ...candidate } = result;
    return [candidate];
  }
}
