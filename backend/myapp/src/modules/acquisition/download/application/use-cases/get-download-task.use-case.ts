import { DownloadTask } from "../../domain/download.types";
import { DownloadService } from "../download.service";

export class GetDownloadTaskUseCase {
  constructor(private readonly downloadService: DownloadService) {}

  execute(userId: number, taskId: number): DownloadTask {
    return this.downloadService.getTask(userId, taskId);
  }
}
