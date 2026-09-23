export class SearchServiceError extends Error {
    code: number;
    details: any;
    requestId: string | null;
    constructor(code: number, message: string, requestId: string | null, details: any = null) {
        super(message);
        this.name = 'SearchServiceError';
        this.code = code;
        this.requestId = requestId;
        this.details = details;
    }
}
export const isSearchServiceError = (error: unknown): error is SearchServiceError => error instanceof SearchServiceError;
