// 全局状态
let apiKey = '';
let configData = null;
let editingProviderIndex = -1;
let providerStatusMap = {};
let statusPollTimer = null;

// 日志相关状态
let logsConnected = false;
let logsPaused = false;
let logsAbortController = null;
let logsReaderTask = null;
let logsBufferWhilePaused = [];
let sseBuffer = '';
const textDecoder = new TextDecoder('utf-8');

// Provider 模型状态
let providerModelsState = {
    models: [],
    selected: new Set(),
    filter: '',
    mappings: {}, // 客户端模型名 -> 服务商模型名的映射
};

const STATUS_POLL_INTERVAL = 10000;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否已登录
    const savedApiKey = localStorage.getItem('apiKey') || sessionStorage.getItem('apiKey');
    if (savedApiKey) {
        apiKey = savedApiKey;
        sessionStorage.setItem('apiKey', savedApiKey);
        login();
    }

    // 绑定事件
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
    document.getElementById('providerForm')?.addEventListener('submit', handleSaveProvider);
    document.getElementById('preferencesForm')?.addEventListener('submit', handleSavePreferences);
    document.getElementById('pauseLogsBtn')?.addEventListener('click', togglePauseLogs);
    document.getElementById('clearLogsBtn')?.addEventListener('click', clearLogsView);

    // 全局点击事件委托
    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('change', handleGlobalChange);
    document.addEventListener('keydown', handleGlobalKeydown);
});

// ==================== 登录/登出 ====================
async function handleLogin(e) {
    e.preventDefault();
    const key = document.getElementById('apiKey').value.trim();
    if (!key) return;

    apiKey = key;
    localStorage.setItem('apiKey', key);
    sessionStorage.setItem('apiKey', key);
    await login();
}

async function login() {
    const result = await fetchConfigFromServer();
    if (!result.success) {
        if (result.unauthorized) {
            handleLogout();
        }
        return;
    }

    configData = result.data;

    // 显示主界面
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('mainView').classList.remove('hidden');

    // 渲染配置
    renderProviders();
    renderPreferences();
    await loadProviderStatus({ silent: true });
    startStatusPolling();
}

function handleLogout() {
    apiKey = '';
    configData = null;
    providerStatusMap = {};
    stopStatusPolling();
    localStorage.removeItem('apiKey');
    sessionStorage.removeItem('apiKey');

    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('mainView').classList.add('hidden');
    document.getElementById('apiKey').value = '';

    stopLogStream();
    const out = document.getElementById('logOutput');
    if (out) out.textContent = '';
}

// ==================== 视图切换 ====================
function switchView(viewName) {
    // 隐藏所有视图
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });

    // 显示目标视图
    if (viewName === 'providers') {
        document.getElementById('providersView').classList.remove('hidden');
    } else if (viewName === 'logs') {
        document.getElementById('logsView').classList.remove('hidden');
        initLogsView();
    }
}

// ==================== API 请求 ====================
async function fetchConfigFromServer(options = {}) {
    const { silent = false } = options;
    try {
        const response = await fetch('/admin/config', {
            headers: { 'X-API-Key': apiKey }
        });

        if (response.status === 401) {
            if (!silent) showError('API Key 无效');
            return { success: false, unauthorized: true };
        }

        if (!response.ok) throw new Error('加载配置失败');

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        if (!silent) showError(error.message || '加载配置失败');
        return { success: false, error };
    }
}

async function saveConfig() {
    try {
        const orderedProviders = Array.isArray(configData?.providers)
            ? configData.providers.map(formatProviderForSave)
            : [];

        const payload = {
            ...configData,
            providers: orderedProviders
        };

        const response = await fetch('/admin/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(payload)
        });

        if (response.status === 401) {
            showError('API Key 无效，请重新登录');
            setTimeout(() => handleLogout(), 2000);
            return false;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '保存配置失败');
        }

        showSuccess('配置已保存');

        const refreshed = await fetchConfigFromServer({ silent: true });
        if (refreshed.success && refreshed.data) {
            configData = refreshed.data;
        } else {
            configData.providers = orderedProviders;
        }

        renderProviders();
        renderPreferences();
        await loadProviderStatus({ silent: true });
        return true;
    } catch (error) {
        showError(error.message);
        return false;
    }
}

// ==================== Providers 渲染 ====================
function renderProviders() {
    const container = document.getElementById('providersTable');
    if (!configData || !configData.providers || configData.providers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-text">暂无 Provider 配置</div>
            </div>
        `;
        return;
    }

    // 按优先级排序
    const providersWithIndex = configData.providers.map((provider, index) => ({
        provider,
        originalIndex: index
    }));

    providersWithIndex.sort((a, b) => {
        const priorityDiff = (b.provider.priority || 0) - (a.provider.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        const nameA = a.provider.provider || '';
        const nameB = b.provider.provider || '';
        return nameA.localeCompare(nameB);
    });

    container.innerHTML = `
        <div class="table-container">
            <table class="table">
                <thead>
                    <tr>
                        <th>Provider</th>
                        <th>Base URL</th>
                        <th>API Key</th>
                        <th>优先级</th>
                        <th>Models</th>
                        <th>状态</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${providersWithIndex.map(({provider, originalIndex}) => {
                        const statusInfo = determineProviderStatus(provider);
                        const manuallyEnabled = provider.enabled !== false;
                        const toggleLabel = manuallyEnabled ? '禁用' : '启用';

                        return `
                        <tr>
                            <td>
                                <span class="clickable" data-copy-text="${escapeHtml(provider.provider)}" title="点击复制">
                                    ${escapeHtml(provider.provider)}
                                </span>
                            </td>
                            <td>
                                <span class="clickable text-muted" data-copy-text="${escapeHtml(provider.base_url)}" title="点击复制">
                                    ${escapeHtml(provider.base_url)}
                                </span>
                            </td>
                            <td>
                                <span class="clickable text-muted" data-copy-text="${escapeHtml(provider.api_key)}" title="点击复制完整 API Key" style="cursor: pointer;">
                                    ${maskApiKey(provider.api_key)}
                                </span>
                            </td>
                            <td>
                                <input type="number"
                                    class="priority-input"
                                    value="${provider.priority || 0}"
                                    onchange="updateProviderPriority(${originalIndex}, this.value)"
                                    title="修改优先级">
                            </td>
                            <td>
                                ${provider.model ? `
                                    <div style="display: flex; flex-wrap: wrap; gap: 8px; max-width: 450px;">
                                        ${provider.model.map(m => {
                                            if (typeof m === 'string') {
                                                return `<span class="tag" data-copy-text="${escapeHtml(m)}" title="点击复制">${escapeHtml(m)}</span>`;
                                            } else if (typeof m === 'object' && m !== null) {
                                                const [clientModel, providerModel] = Object.entries(m)[0] || ['', ''];
                                                return `<span class="tag" data-copy-text="${escapeHtml(clientModel)}" title="点击复制 · 映射到: ${escapeHtml(providerModel)}">${escapeHtml(clientModel)}</span>`;
                                            }
                                            return '';
                                        }).join('')}
                                    </div>
                                ` : '<span class="text-muted">-</span>'}
                            </td>
                            <td>
                                <span class="badge badge-${statusInfo.className}" title="${escapeHtml(statusInfo.detail || statusInfo.label)}">
                                    ${escapeHtml(statusInfo.label)}
                                </span>
                                ${statusInfo.detail ? `<div class="text-muted" style="font-size: 12px; margin-top: 4px;">${escapeHtml(statusInfo.detail)}</div>` : ''}
                            </td>
                            <td>
                                <div class="action-links">
                                    <a class="action-link" onclick="openProviderModal(${originalIndex}, 'models')" title="获取模型">获取模型</a>
                                    <a class="action-link" onclick="toggleProviderEnabled(${originalIndex})" title="${toggleLabel}">${toggleLabel}</a>
                                    <a class="action-link" onclick="openProviderModal(${originalIndex})" title="编辑">编辑</a>
                                    <a class="action-link danger" onclick="deleteProvider(${originalIndex})" title="删除">删除</a>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function determineProviderStatus(provider) {
    const runtimeStatus = provider && provider.provider ? providerStatusMap[provider.provider] : null;
    const manualEnabled = provider && provider.enabled !== false;

    if (!manualEnabled) {
        return { label: '已禁用', className: 'danger', detail: '' };
    }

    if (runtimeStatus && runtimeStatus.auto_disabled) {
        let detail = '';
        if (typeof runtimeStatus.cooldown_remaining_seconds === 'number') {
            const remaining = Math.ceil(runtimeStatus.cooldown_remaining_seconds);
            if (remaining > 0) {
                detail = `剩余 ${remaining} 秒`;
            }
        }
        if (!detail && runtimeStatus.last_error) {
            detail = runtimeStatus.last_error;
        }
        return { label: '自动禁用', className: 'warning', detail };
    }

    return { label: '已启用', className: 'success', detail: '' };
}

// ==================== Preferences 渲染 ====================
function renderPreferences() {
    // 只更新头部显示
    const prefs = configData.preferences || {};
    const modelTimeout = getPreferenceNumber(prefs.model_timeout, 20);
    const cooldownPeriod = getPreferenceNumber(prefs.cooldown_period, 300);

    document.getElementById('headerTimeout').textContent = `${modelTimeout}s`;
    document.getElementById('headerCooldown').textContent = `${cooldownPeriod}s`;
    document.getElementById('headerProxy').textContent = prefs.proxy ? escapeHtml(prefs.proxy) : '未设置';
}

// ==================== Provider 操作 ====================
function openProviderModal(index = -1, section = 'info') {
    editingProviderIndex = index;
    const modal = document.getElementById('providerModal');
    const title = document.getElementById('providerModalTitle');

    if (index >= 0) {
        title.textContent = '编辑 Provider';
        const provider = configData.providers[index];
        document.getElementById('providerName').value = provider.provider;
        document.getElementById('providerBaseUrl').value = provider.base_url;
        document.getElementById('providerApiKey').value = provider.api_key;
        document.getElementById('providerPriority').value = provider.priority || 0;
        document.getElementById('providerModelsEndpoint').value = provider.models_endpoint || '/v1/models';

        const initial = Array.isArray(provider.model) ? [...provider.model] : [];
        const mappings = {};
        const selectedModels = [];
        
        // 解析模型列表，支持字符串和字典格式
        initial.forEach(item => {
            if (typeof item === 'string') {
                selectedModels.push(item);
            } else if (typeof item === 'object' && item !== null) {
                // 字典格式: { "client-model": "provider-model" }
                Object.entries(item).forEach(([clientModel, providerModel]) => {
                    selectedModels.push(clientModel);
                    mappings[clientModel] = providerModel;
                });
            }
        });
        
        providerModelsState = {
            models: [...selectedModels],
            selected: new Set(selectedModels),
            filter: '',
            mappings,
        };
        renderProviderModelsUI();
    } else {
        title.textContent = '添加 Provider';
        document.getElementById('providerForm').reset();
        document.getElementById('providerPriority').value = '0';
        document.getElementById('providerModelsEndpoint').value = '/v1/models';
        providerModelsState = { models: [], selected: new Set(), filter: '', mappings: {} };
        renderProviderModelsUI();
    }

    modal.classList.add('show');

    if (section === 'models') {
        setTimeout(() => {
            document.querySelector('.models-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            fetchModelsInProviderModal();
        }, 50);
    }
}

function closeProviderModal() {
    document.getElementById('providerModal').classList.remove('show');
    editingProviderIndex = -1;
    providerModelsState = { models: [], selected: new Set(), filter: '', mappings: {} };
}

async function handleSaveProvider(e) {
    e.preventDefault();

    const provider = {
        provider: document.getElementById('providerName').value.trim(),
        base_url: document.getElementById('providerBaseUrl').value.trim(),
        api_key: document.getElementById('providerApiKey').value.trim(),
        priority: parseInt(document.getElementById('providerPriority').value) || 0
    };

    const selectedModels = Array.from(providerModelsState.selected || []);
    const mappings = providerModelsState.mappings || {};
    
    if (selectedModels.length > 0) {
        provider.model = selectedModels.map(clientModel => {
            const providerModel = mappings[clientModel];
            if (providerModel && providerModel !== clientModel) {
                // 有映射，返回字典格式
                return { [clientModel]: providerModel };
            }
            // 无映射，返回字符串
            return clientModel;
        });
    }

    const modelsEndpoint = document.getElementById('providerModelsEndpoint').value.trim();
    if (modelsEndpoint && modelsEndpoint !== '/v1/models') {
        provider.models_endpoint = modelsEndpoint;
    }

    const normalizedProvider = formatProviderForSave(provider);
    const isEdit = editingProviderIndex >= 0;
    const originalProvider = isEdit ? configData.providers[editingProviderIndex] : null;

    if (originalProvider && originalProvider.enabled === false) {
        normalizedProvider.enabled = false;
    }

    if (isEdit) {
        configData.providers[editingProviderIndex] = normalizedProvider;
    } else {
        configData.providers.push(normalizedProvider);
    }

    const success = await saveConfig();
    if (success) {
        closeProviderModal();
    } else {
        if (isEdit && originalProvider) {
            configData.providers[editingProviderIndex] = originalProvider;
        } else if (!isEdit) {
            configData.providers.pop();
        }
        renderProviders();
    }
}

async function deleteProvider(index) {
    if (!confirm('确定要删除这个 Provider 吗？')) return;

    const [removed] = configData.providers.splice(index, 1);
    const success = await saveConfig();
    if (!success && removed) {
        configData.providers.splice(index, 0, removed);
        renderProviders();
    }
}

async function toggleProviderEnabled(index) {
    if (!configData || !Array.isArray(configData.providers) || !configData.providers[index]) {
        return;
    }

    const originalSnapshot = formatProviderForSave(configData.providers[index]);
    const currentlyEnabled = originalSnapshot.enabled !== false;
    const updatedProvider = { ...originalSnapshot };

    if (currentlyEnabled) {
        updatedProvider.enabled = false;
    } else {
        delete updatedProvider.enabled;
    }

    configData.providers[index] = updatedProvider;

    const success = await saveConfig();
    if (!success) {
        configData.providers[index] = originalSnapshot;
        renderProviders();
    }
}

async function updateProviderPriority(index, newValue) {
    if (!configData || !Array.isArray(configData.providers) || !configData.providers[index]) {
        return;
    }

    const originalSnapshot = formatProviderForSave(configData.providers[index]);
    const priority = parseInt(newValue, 10);

    if (isNaN(priority)) {
        showError('优先级必须是有效的数字');
        renderProviders();
        return;
    }

    const updatedProvider = { ...originalSnapshot, priority };
    configData.providers[index] = updatedProvider;

    const success = await saveConfig();
    if (!success) {
        configData.providers[index] = originalSnapshot;
        renderProviders();
    }
}

// ==================== Preferences 操作 ====================
function openPreferencesModal() {
    const prefs = configData.preferences || {};
    document.getElementById('modelTimeout').value = getPreferenceNumber(prefs.model_timeout, 20);
    document.getElementById('cooldownPeriod').value = getPreferenceNumber(prefs.cooldown_period, 300);
    document.getElementById('proxy').value = prefs.proxy || '';

    document.getElementById('preferencesModal').classList.add('show');
}

function closePreferencesModal() {
    document.getElementById('preferencesModal').classList.remove('show');
}

async function handleSavePreferences(e) {
    e.preventDefault();

    if (!configData.preferences) {
        configData.preferences = {};
    }

    configData.preferences.model_timeout = parseNumberInput(document.getElementById('modelTimeout').value, 20);
    configData.preferences.cooldown_period = parseNumberInput(document.getElementById('cooldownPeriod').value, 300);

    const proxy = document.getElementById('proxy').value.trim();
    if (proxy) {
        configData.preferences.proxy = proxy;
    } else {
        delete configData.preferences.proxy;
    }

    const success = await saveConfig();
    if (success) {
        closePreferencesModal();
    }
}

// ==================== Models 管理 ====================
async function fetchModelsInProviderModal() {
    const base_url = document.getElementById('providerBaseUrl').value.trim();
    const api_key_val = document.getElementById('providerApiKey').value.trim();
    const models_endpoint = document.getElementById('providerModelsEndpoint').value.trim() || '/v1/models';
    const listEl = document.getElementById('modelsList');

    if (listEl) listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">加载中...</div>';

    try {
        if (!base_url || !api_key_val) {
            throw new Error('请先填写 Base URL 与 API Key');
        }

        const resp = await fetch('/admin/providers/_probe_models', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
            body: JSON.stringify({ base_url, api_key: api_key_val, models_endpoint }),
        });

        if (resp.status === 401) {
            showError('API Key 无效，请重新登录');
            handleLogout();
            return;
        }

        if (!resp.ok) throw new Error('获取模型失败');

        const data = await resp.json();
        const upstream = Array.isArray(data.models) ? data.models : [];
        const union = Array.from(new Set([...(providerModelsState.models || []), ...upstream]));
        providerModelsState.models = union;
        renderProviderModelsUI();
    } catch (e) {
        renderProviderModelsUI();
        showError(e.message || '获取模型失败');
    }
}

function renderProviderModelsUI() {
    const listEl = document.getElementById('modelsList');
    const master = document.getElementById('modelsMaster');
    const selectedCountEl = document.getElementById('modelsSelectedCount');
    const models = Array.isArray(providerModelsState.models) ? providerModelsState.models : [];
    const selected = providerModelsState.selected || new Set();
    const mappings = providerModelsState.mappings || {};
    const filter = (providerModelsState.filter || '').toLowerCase();

    if (!listEl) return;

    const visible = filter ? models.filter(m => m.toLowerCase().includes(filter)) : models;

    if (models.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">暂无模型，请先从上游获取或手动添加</div>';
    } else if (visible.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">无匹配结果</div>';
    } else {
        listEl.innerHTML = visible.map((m, i) => {
            const id = `mdl_${i}`;
            const checked = selected.has(m) ? 'checked' : '';
            const mappedValue = mappings[m] || '';
            const hasMappingClass = mappedValue ? ' has-mapping' : '';
            
            return `
            <div class="model-item-wrapper${hasMappingClass}" style="border-bottom: 1px solid var(--border-light);">
                <div class="model-item" style="border-bottom: none; display: flex; align-items: center; gap: 12px; padding: 10px 16px;">
                    <input type="checkbox" id="${id}" data-model="${escapeHtml(m)}" ${checked} style="cursor: pointer;">
                    <label for="${id}" style="flex: 1; cursor: pointer; margin: 0;">
                        <div style="font-weight: 500;">${escapeHtml(m)}</div>
                        ${mappedValue ? `<div style="font-size: 12px; color: var(--text-tertiary); margin-top: 2px;">→ ${escapeHtml(mappedValue)}</div>` : ''}
                    </label>
                    <button type="button" class="btn btn-ghost btn-icon" onclick="toggleModelMapping('${escapeHtml(m)}')" title="${mappedValue ? '编辑映射' : '添加映射'}" style="padding: 6px; font-size: 16px; min-width: 32px; height: 32px;">
                        ${mappedValue ? '✏️' : '➕'}
                    </button>
                </div>
                <div id="mapping_input_${i}" class="mapping-input-container" style="display: none; padding: 8px 16px 12px 40px; background: var(--bg-secondary);">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" 
                            class="form-input" 
                            placeholder="输入服务商模型名..." 
                            value="${escapeHtml(mappedValue)}" 
                            onkeydown="if(event.key==='Enter'){event.preventDefault();saveModelMapping('${escapeHtml(m)}',this.value,${i});}"
                            style="flex: 1; padding: 6px 10px; font-size: 13px;">
                        <button type="button" class="btn btn-success btn-icon" onclick="saveModelMapping('${escapeHtml(m)}',this.previousElementSibling.value,${i})" title="保存映射" style="padding: 6px 10px;">
                            ✓
                        </button>
                        <button type="button" class="btn btn-danger btn-icon" onclick="removeModelMapping('${escapeHtml(m)}',${i})" title="删除映射" style="padding: 6px 10px;">
                            ✕
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    if (selectedCountEl) selectedCountEl.textContent = `(${selected.size || 0})`;
    if (master) {
        const allVisibleSelected = visible.length > 0 && visible.every(m => selected.has(m));
        master.checked = allVisibleSelected;
        master.indeterminate = visible.length > 0 && !allVisibleSelected && visible.some(m => selected.has(m));
    }
}

function onModelsMasterToggle(checked) {
    const models = Array.isArray(providerModelsState.models) ? providerModelsState.models : [];
    const filter = (providerModelsState.filter || '').toLowerCase();
    const visible = filter ? models.filter(m => m.toLowerCase().includes(filter)) : models;

    if (checked) {
        visible.forEach(m => providerModelsState.selected.add(m));
    } else {
        visible.forEach(m => providerModelsState.selected.delete(m));
    }

    renderProviderModelsUI();
}

function onModelsSearchChange(val) {
    providerModelsState.filter = (val || '').trim();
    renderProviderModelsUI();
}

function addCustomModel() {
    const input = document.getElementById('customModelInput');
    if (!input) return;

    const value = input.value.trim();
    if (!value) return;

    const modelsSet = new Set(providerModelsState.models || []);
    modelsSet.add(value);
    providerModelsState.models = Array.from(modelsSet);
    providerModelsState.selected.add(value);
    input.value = '';
    renderProviderModelsUI();
    showSuccess(`已添加自定义模型: ${value}`);
}

function toggleModelMapping(clientModel) {
    const models = Array.isArray(providerModelsState.models) ? providerModelsState.models : [];
    const filter = (providerModelsState.filter || '').toLowerCase();
    const visible = filter ? models.filter(m => m.toLowerCase().includes(filter)) : models;
    const index = visible.indexOf(clientModel);
    
    if (index === -1) return;
    
    const inputContainer = document.getElementById(`mapping_input_${index}`);
    if (!inputContainer) return;
    
    // 关闭其他所有打开的映射输入框
    document.querySelectorAll('.mapping-input-container').forEach(el => {
        if (el !== inputContainer) {
            el.style.display = 'none';
        }
    });
    
    // 切换当前输入框
    const isVisible = inputContainer.style.display !== 'none';
    inputContainer.style.display = isVisible ? 'none' : 'block';
    
    // 如果打开，聚焦到输入框
    if (!isVisible) {
        const input = inputContainer.querySelector('input[type="text"]');
        if (input) {
            setTimeout(() => input.focus(), 50);
        }
    }
}

function saveModelMapping(clientModel, providerModel, index) {
    const trimmedValue = providerModel.trim();
    
    if (!trimmedValue) {
        showError('服务商模型名不能为空');
        return;
    }
    
    if (!providerModelsState.mappings) {
        providerModelsState.mappings = {};
    }
    
    providerModelsState.mappings[clientModel] = trimmedValue;
    
    // 隐藏输入框
    const inputContainer = document.getElementById(`mapping_input_${index}`);
    if (inputContainer) {
        inputContainer.style.display = 'none';
    }
    
    renderProviderModelsUI();
    showSuccess(`已设置映射: ${clientModel} → ${trimmedValue}`);
}

function removeModelMapping(clientModel, index) {
    if (!providerModelsState.mappings) {
        providerModelsState.mappings = {};
    }
    
    delete providerModelsState.mappings[clientModel];
    
    // 隐藏输入框
    const inputContainer = document.getElementById(`mapping_input_${index}`);
    if (inputContainer) {
        inputContainer.style.display = 'none';
    }
    
    renderProviderModelsUI();
    showSuccess(`已删除映射: ${clientModel}`);
}

// ==================== 状态轮询 ====================
function startStatusPolling() {
    stopStatusPolling();
    if (!apiKey) return;
    statusPollTimer = setInterval(() => {
        loadProviderStatus({ silent: true });
    }, STATUS_POLL_INTERVAL);
}

function stopStatusPolling() {
    if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
    }
}

async function loadProviderStatus(options = {}) {
    const { silent = false } = options;
    if (!apiKey) return;

    try {
        const response = await fetch('/admin/providers/status', {
            headers: { 'X-API-Key': apiKey }
        });

        if (response.status === 401) {
            if (!silent) showError('API Key 无效，请重新登录');
            handleLogout();
            return;
        }

        if (!response.ok) throw new Error('加载 Provider 状态失败');

        const data = await response.json();
        const runtimeList = Array.isArray(data.providers) ? data.providers : [];
        providerStatusMap = {};
        runtimeList.forEach(status => {
            if (status && status.name) {
                providerStatusMap[status.name] = status;
            }
        });

        if (configData && configData.providers) {
            renderProviders();
        }
    } catch (error) {
        if (!silent) showError(error.message);
    }
}

// ==================== 日志查看 ====================
async function initLogsView() {
    await loadRecentLogs();
    if (!logsConnected) {
        startLogStream();
    }
}

async function loadRecentLogs() {
    try {
        const resp = await fetch('/admin/logs/recent?limit=500', {
            headers: { 'X-API-Key': apiKey }
        });

        if (resp.status === 401) {
            showError('API Key 无效，请重新登录');
            handleLogout();
            return;
        }

        if (!resp.ok) throw new Error('加载最近日志失败');

        const data = await resp.json();
        const out = document.getElementById('logOutput');
        if (!out) return;

        out.textContent = '';
        (data.logs || []).forEach(item => appendLogItem(item));
    } catch (e) {
        showError(e.message || '加载最近日志失败');
    }
}

function startLogStream() {
    stopLogStream();
    logsAbortController = new AbortController();
    logsConnected = true;
    sseBuffer = '';

    logsReaderTask = (async () => {
        while (logsConnected) {
            try {
                const resp = await fetch('/admin/logs/stream', {
                    headers: { 'X-API-Key': apiKey },
                    signal: logsAbortController.signal,
                });

                if (resp.status === 401) {
                    showError('API Key 无效，请重新登录');
                    handleLogout();
                    return;
                }

                if (!resp.ok || !resp.body) throw new Error('连接日志流失败');

                const reader = resp.body.getReader();
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) processSseChunk(value);
                }
            } catch (err) {
                if (logsAbortController?.signal.aborted) break;
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    })();
}

function stopLogStream() {
    logsConnected = false;
    if (logsAbortController) {
        logsAbortController.abort();
        logsAbortController = null;
    }
    logsReaderTask = null;
    sseBuffer = '';
}

function processSseChunk(uint8) {
    const text = textDecoder.decode(uint8, { stream: true });
    sseBuffer += text;
    let idx;
    while ((idx = sseBuffer.indexOf('\n\n')) !== -1) {
        const eventBlock = sseBuffer.slice(0, idx);
        sseBuffer = sseBuffer.slice(idx + 2);
        const lines = eventBlock.split('\n');
        let dataLines = [];
        for (const line of lines) {
            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            }
        }
        if (dataLines.length) {
            const dataStr = dataLines.join('\n');
            try {
                const obj = JSON.parse(dataStr);
                appendLogItem(obj);
            } catch (_) { }
        }
    }
}

function appendLogItem(item) {
    const out = document.getElementById('logOutput');
    if (!out) return;

    const line = item && item.message ? item.message : JSON.stringify(item);
    if (logsPaused) {
        logsBufferWhilePaused.push(line);
        return;
    }

    out.textContent += (out.textContent ? '\n' : '') + line;
    maybeAutoScroll();
}

function maybeAutoScroll() {
    const out = document.getElementById('logOutput');
    if (!out) return;

    const auto = document.getElementById('autoScrollToggle');
    if (auto && auto.checked) {
        out.scrollTop = out.scrollHeight;
    }
}

function togglePauseLogs() {
    logsPaused = !logsPaused;
    const btn = document.getElementById('pauseLogsBtn');

    if (logsPaused) {
        btn.textContent = '继续';
    } else {
        btn.textContent = '暂停';
        if (logsBufferWhilePaused.length) {
            const out = document.getElementById('logOutput');
            if (out) {
                out.textContent += (out.textContent ? '\n' : '') + logsBufferWhilePaused.join('\n');
                logsBufferWhilePaused = [];
                maybeAutoScroll();
            }
        }
    }
}

function clearLogsView() {
    const out = document.getElementById('logOutput');
    if (out) out.textContent = '';
    logsBufferWhilePaused = [];
}

// ==================== 事件处理 ====================
async function handleGlobalClick(event) {
    // 复制字段
    const fieldTarget = event.target.closest('[data-field]');
    if (fieldTarget) {
        const providerIndex = Number(fieldTarget.dataset.providerIndex);
        const field = fieldTarget.dataset.field;
        if (!Number.isNaN(providerIndex) && field) {
            await copyProviderField(providerIndex, field);
        }
        return;
    }

    // 复制文本
    const copyTarget = event.target.closest('[data-copy-text]');
    if (copyTarget) {
        const text = copyTarget.dataset.copyText;
        if (text) {
            const success = await copyTextToClipboard(text);
            if (success) {
                showSuccess('已复制到剪贴板');
            } else {
                showError('复制失败，请手动复制');
            }
        }
        return;
    }
}

function handleGlobalChange(e) {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;

    const parent = target.parentElement?.parentElement;
    if (!parent || parent.id !== 'modelsList') return;

    const model = target.getAttribute('data-model');
    if (!model) return;

    if (target.checked) {
        providerModelsState.selected.add(model);
    } else {
        providerModelsState.selected.delete(model);
    }

    renderProviderModelsUI();
}

function handleGlobalKeydown(e) {
    if (e.key === 'Enter') {
        const el = document.activeElement;
        if (el && el.id === 'customModelInput') {
            e.preventDefault();
            addCustomModel();
        }
    }
}

// ==================== 工具函数 ====================
async function copyProviderField(providerIndex, field) {
    if (!configData || !Array.isArray(configData.providers)) {
        showError('尚未加载配置，无法复制');
        return;
    }

    const provider = configData.providers[providerIndex];
    if (!provider || typeof provider[field] !== 'string') {
        showError('未找到可复制的内容');
        return;
    }

    const success = await copyTextToClipboard(provider[field]);
    if (success) {
        showSuccess('已复制到剪贴板');
    } else {
        showError('复制失败，请手动复制');
    }
}

async function copyTextToClipboard(text) {
    if (!text) return false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // fall back
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    let succeeded = false;
    try {
        succeeded = document.execCommand('copy');
    } catch (err) {
        succeeded = false;
    }

    document.body.removeChild(textarea);
    return succeeded;
}

function formatProviderForSave(provider) {
    if (!provider) return provider;

    const priorityValue = Number.isFinite(provider.priority)
        ? provider.priority
        : parseInt(provider.priority, 10) || 0;

    const normalized = {
        provider: provider.provider,
        base_url: provider.base_url,
        api_key: provider.api_key,
        priority: priorityValue
    };

    if (Array.isArray(provider.model) && provider.model.length > 0) {
        normalized.model = provider.model.map(item => item);
    }

    if (provider.models_endpoint && provider.models_endpoint !== '/v1/models') {
        normalized.models_endpoint = provider.models_endpoint;
    }

    if (provider.enabled === false) {
        normalized.enabled = false;
    }

    const knownKeys = new Set(['provider', 'base_url', 'api_key', 'priority', 'model', 'models_endpoint', 'enabled']);
    Object.keys(provider).forEach((key) => {
        if (!knownKeys.has(key)) {
            normalized[key] = provider[key];
        }
    });

    return normalized;
}

function getPreferenceNumber(value, fallback) {
    return value === undefined || value === null ? fallback : value;
}

function parseNumberInput(value, fallback) {
    const trimmed = value.trim();
    if (trimmed === '') return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function maskApiKey(key) {
    if (!key || key.length <= 8) return '********';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

function showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    const duration = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showError(message) {
    showToast(message, 'error');
}

function showSuccess(message) {
    showToast(message, 'success');
}
