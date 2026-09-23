import type { BatchImportBookResult, BatchImportBookResultItem, ImportBookResult } from '../model/library';
export interface ImportSelection<T> {
    files: T[];
    title?: string;
    authors?: string;
    isbn?: string;
    coverUrl?: string;
    conflictPolicy?: 'rename' | 'skip' | 'overwrite';
}
export async function importSelection<T>(input: ImportSelection<T>, gateway: {
    single(input: Omit<ImportSelection<T>, 'files'> & {
        file: T;
    }): Promise<ImportBookResult>;
    batch(input: ImportSelection<T>): Promise<BatchImportBookResult>;
}): Promise<BatchImportBookResultItem[]> {
    if (input.files.length === 0)
        throw new Error('请选择电子书文件');
    if (input.files.length > 1)
        return (await gateway.batch(input)).items;
    const { files, ...metadata } = input;
    const result = await gateway.single({ ...metadata, file: files[0]! });
    return [{ index: 0, ...result }];
}
