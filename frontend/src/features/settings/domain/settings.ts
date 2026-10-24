import type { ZlibraryConfig } from '../model/zlibrary';
import type { DoubanConfig } from '../model/douban';
import type { AiModelConfig, TestAiModelConfigResult } from '../model/aiModel';
import type { SaveZlibraryConfigPayload, ImportZlibraryCookiesPayload, ZlibraryProbeResult, ZlibraryDiscoveryResult } from '../model/zlibrary';
import type { AiModelGateway } from './AiModelGateway';
import { errorMessage } from '../../../shared/domain/errors';
interface ZlibraryGateway {
    getConfig(): Promise<ZlibraryConfig>;
    saveConfig(input: SaveZlibraryConfigPayload): Promise<ZlibraryConfig>;
    importCookies(input: ImportZlibraryCookiesPayload): Promise<ZlibraryConfig>;
    probe(url: string): Promise<ZlibraryProbeResult>;
    discoverDomains(baseUrl: string): Promise<ZlibraryDiscoveryResult>;
    updateBaseUrl(url: string): Promise<{
        baseUrl: string;
    }>;
    deleteConfig(): Promise<{
        deleted: boolean;
    }>;
}
type ZlibraryCredentialMode = 'account' | 'cookies';
export function createSettingsState() {
    return {
        config: null as ZlibraryConfig | null,
        saving: false,
        savingUrl: false,
        deletingZlibraryConfig: false,
        credentialMode: 'account' as ZlibraryCredentialMode,
        form: {
            email: '',
            password: '',
            baseUrl: 'https://zlibrary-mirror.example.com'
        },
        cookieForm: {
            remixUserid: '',
            remixUserkey: '',
        },
        doubanForm: {
            requestIntervalMs: 3000,
            cookie: '',
        },
        aiConfig: null as AiModelConfig | null,
        aiTestResult: null as TestAiModelConfigResult | null,
        aiConfigError: null as string | null,
        savingAiConfig: false,
        testingAiConfig: false,
        deletingAiConfig: false,
        aiForm: {
            modelId: 'deepseek-v4-flash',
            apiKey: '',
        },
        configError: null as string | null,
        probeResult: null as ZlibraryProbeResult | null,
        probeError: null as string | null,
        probing: false,
        candidates: [] as ZlibraryDiscoveryResult['candidates'],
        discovering: false,
        discoveryError: null as string | null,
    };
}
export function createSettingsController(state: ReturnType<typeof createSettingsState>, zlibraryApi: ZlibraryGateway, doubanApi: {
    getConfig(): Promise<DoubanConfig>;
}, aiModelApi: AiModelGateway, notify: (message: string) => void) {
    const fetchConfig = async () => {
        try {
            const data = await zlibraryApi.getConfig();
            applyZlibraryConfig(data);
        }
        catch (err) {
            state.configError = errorMessage(err);
        }
    };
    const applyZlibraryConfig = (data: ZlibraryConfig) => {
        state.config = data;
        state.form.baseUrl = data.baseUrl ?? '';
    };
    const handleSaveBaseUrl = async () => {
        state.savingUrl = true;
        try {
            const result = await zlibraryApi.updateBaseUrl(state.form.baseUrl);
            if (state.config)
                state.config.baseUrl = result.baseUrl;
            notify('上游地址已保存');
        }
        catch (err: any) {
            notify('保存失败: ' + (err?.message || '未知错误'));
        }
        finally {
            state.savingUrl = false;
        }
    };
    const handleProbeBaseUrl = async () => {
        state.probing = true;
        state.probeResult = null;
        state.probeError = null;
        try { state.probeResult = await zlibraryApi.probe(state.form.baseUrl); }
        catch (err: any) { state.probeError = err?.message || '检测请求失败'; notify('检测失败: ' + state.probeError); }
        finally { state.probing = false; }
    };
    const handleDiscoverDomains = async () => {
        state.discovering = true;
        state.discoveryError = null;
        try { state.candidates = (await zlibraryApi.discoverDomains(state.form.baseUrl)).candidates; }
        catch (err: any) { const message = err?.message || '候选域名发现失败'; state.discoveryError = message; notify(message); }
        finally { state.discovering = false; }
    };
    const handleSave = async () => {
        state.saving = true;
        try {
            const result = state.credentialMode === 'account'
                ? await zlibraryApi.saveConfig({
                    email: state.form.email,
                    baseUrl: state.form.baseUrl,
                    password: state.form.password,
                })
                : await zlibraryApi.importCookies({
                    remixUserid: state.cookieForm.remixUserid,
                    remixUserkey: state.cookieForm.remixUserkey,
                    baseUrl: state.form.baseUrl,
                });
            state.config = result;
        }
        catch (err: any) {
            const msg = err?.message || '未知错误';
            notify('保存失败: ' + msg);
        }
        finally {
            state.form.password = '';
            state.cookieForm.remixUserid = '';
            state.cookieForm.remixUserkey = '';
            state.saving = false;
        }
    };
    const handleDeleteZlibraryConfig = async () => {
        state.deletingZlibraryConfig = true;
        try {
            await zlibraryApi.deleteConfig();
            state.form.email = '';
            state.form.password = '';
            state.cookieForm.remixUserid = '';
            state.cookieForm.remixUserkey = '';
            applyZlibraryConfig(await zlibraryApi.getConfig());
            notify('Zlibrary 配置已删除');
        }
        catch (err: any) {
            notify('删除失败: ' + (err?.message || '未知错误'));
        }
        finally {
            state.deletingZlibraryConfig = false;
        }
    };
    const fetchDoubanConfig = async () => {
        try {
            const data = await doubanApi.getConfig();
            state.doubanForm.requestIntervalMs = data.requestIntervalMs;
            state.doubanForm.cookie = data.cookie;
        }
        catch (err) {
            state.configError = errorMessage(err);
        }
    };
    const fetchAiConfig = async () => {
        try {
            state.aiConfig = await aiModelApi.getModelConfig();
            state.aiForm.modelId = state.aiConfig.modelId || 'deepseek-v4-flash';
            state.aiConfigError = null;
        }
        catch (err: any) {
            state.aiConfigError = err?.message || '读取模型配置失败';
        }
    };
    const aiPayload = () => ({
        modelId: state.aiForm.modelId.trim() || 'deepseek-v4-flash',
        ...(state.aiForm.apiKey.trim() ? { apiKey: state.aiForm.apiKey.trim() } : {}),
    });
    const handleTestAiConfig = async () => {
        state.testingAiConfig = true;
        state.aiConfigError = null;
        state.aiTestResult = null;
        try {
            state.aiTestResult = await aiModelApi.testModelConfig(aiPayload());
        }
        catch (err: any) {
            state.aiConfigError = err?.message || '连接测试失败';
        }
        finally {
            state.testingAiConfig = false;
        }
    };
    const handleSaveAiConfig = async () => {
        state.savingAiConfig = true;
        state.aiConfigError = null;
        try {
            state.aiConfig = await aiModelApi.saveModelConfig(aiPayload());
            state.aiForm.apiKey = '';
            state.aiTestResult = null;
        }
        catch (err: any) {
            state.aiConfigError = err?.message || '保存模型配置失败';
        }
        finally {
            state.savingAiConfig = false;
        }
    };
    const handleDeleteAiConfig = async () => {
        state.deletingAiConfig = true;
        state.aiConfigError = null;
        try {
            await aiModelApi.deleteModelConfig();
            state.aiForm.apiKey = '';
            state.aiTestResult = null;
            await fetchAiConfig();
        }
        catch (err: any) {
            state.aiConfigError = err?.message || '删除模型配置失败';
        }
        finally {
            state.deletingAiConfig = false;
        }
    };
    return { fetchConfig, applyZlibraryConfig, handleSaveBaseUrl, handleProbeBaseUrl, handleDiscoverDomains, handleSave, handleDeleteZlibraryConfig, fetchDoubanConfig, fetchAiConfig, aiPayload, handleTestAiConfig, handleSaveAiConfig, handleDeleteAiConfig };
}
