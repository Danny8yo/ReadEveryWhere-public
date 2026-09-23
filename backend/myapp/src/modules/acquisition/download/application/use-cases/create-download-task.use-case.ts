import { DownloadTask } from "../../domain/download.types";
import { DownloadService } from "../download.service";

export class CreateDownloadTaskUseCase {
  constructor(private readonly downloadService: DownloadService) {}

  async execute(
    userId: number,
    command: { bookId: number; sourcePlatform: "zlibrary"; sourceUrl: string; fileName?: string },
  ): Promise<DownloadTask> {
    return this.downloadService.createTask(userId, command);
  }
}
