import { DownloadService } from "../download.service";

export class CancelDownloadTaskUseCase {
  constructor(private readonly downloadService: DownloadService) {}

  execute(userId: number, taskId: number): { canceled: boolean } {
    return this.downloadService.cancelTask(userId, taskId);
  }
}
