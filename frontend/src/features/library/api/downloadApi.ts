import type { DownloadTask } from '../model/download';
import type { CreateDownloadTaskParams } from '../model/download';
import { request } from '../../../services/apiClient';
export const downloadApi = {
    createTask(params: CreateDownloadTaskParams): Promise<DownloadTask> {
        return request<DownloadTask>('/api/v1/downloads/tasks', {
            method: 'POST',
            body: JSON.stringify(params),
        });
    },
    getTask(taskId: number): Promise<DownloadTask> {
        return request<DownloadTask>(`/api/v1/downloads/tasks/${taskId}`);
    },
    cancelTask(taskId: number): Promise<{
        canceled: boolean;
    }> {
        return request<{
            canceled: boolean;
        }>(`/api/v1/downloads/tasks/${taskId}`, {
            method: 'DELETE',
        });
    },
};
