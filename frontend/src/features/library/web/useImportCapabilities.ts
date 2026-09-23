import { ref, watch } from 'vue';
import { getImportCapabilities, type ImportCapabilities } from '../api/libraryApi';
import { useCommand } from '../../../shared/web/useCommand';
export function useImportCapabilities(isOpen: () => boolean) {
    const importCapabilities = ref<ImportCapabilities | null>(null), capabilitiesError = ref('');
    const command = useCommand();
    async function loadImportCapabilities() {
        command.reset();
        capabilitiesError.value = '';
        importCapabilities.value = null;
        const result = await command.run(async () => { const value = await getImportCapabilities(); if (!Number.isSafeInteger(value.maxFileSizeBytes) || value.maxFileSizeBytes <= 0)
            throw new Error('Invalid import capability response'); return value; });
        if (result.ok)
            importCapabilities.value = result.value;
        else if ('error' in result)
            capabilitiesError.value = '无法读取上传限制，请稍后重试';
    }
    watch(isOpen, open => { if (open)
        void loadImportCapabilities();
    else {
        command.reset();
        importCapabilities.value = null;
    } }, { immediate: true });
    return { importCapabilities, capabilitiesLoading: command.busy, capabilitiesError, loadImportCapabilities };
}
