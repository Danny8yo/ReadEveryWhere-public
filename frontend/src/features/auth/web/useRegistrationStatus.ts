import { ref, onMounted } from 'vue';
import { getRegistrationStatus } from '../api/authApi';
import { useCommand } from '../../../shared/web/useCommand';
export function useRegistrationStatus() {
    const registrationAvailability = ref<'loading' | 'enabled' | 'disabled' | 'unavailable'>('loading');
    const command = useCommand();
    onMounted(async () => { const result = await command.run(getRegistrationStatus); if (result.ok)
        registrationAvailability.value = result.value.registrationEnabled ? 'enabled' : 'disabled';
    else if ('error' in result)
        registrationAvailability.value = 'unavailable'; });
    return { registrationAvailability };
}
