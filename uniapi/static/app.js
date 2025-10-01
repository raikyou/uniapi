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

const STATUS_POLL_INTERVAL = 10000;

async function fetchConfigFromServer(options = {}) {
    const { silent = false } = options;
    try {
        const response = await fetch('/admin/config', {
            headers: {
                'X-API-Key': apiKey
            }
        });

        if (response.status === 401) {
            if (!silent) {
                showError('API Key 无效');
            }
            return { success: false, unauthorized: true };
        }

        if (!response.ok) {
            throw new Error('加载配置失败');
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        if (!silent) {
            showError(error.message || '加载配置失败');
        }
        return { success: false, error };
    }
}

function getPreferenceNumber(value, fallback) {
    return value === undefined || value === null ? fallback : value;
}

function parseNumberInput(value, fallback) {
    const trimmed = value.trim();
    if (trimmed === '') {
        return fallback;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function copyTextToClipboard(text) {
    if (!text) {
        return false;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // fall back below
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

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否已登录
    const savedApiKey = sessionStorage.getItem('apiKey');
    if (savedApiKey) {
        apiKey = savedApiKey;
        login();
    }

    // 绑定事件
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    const addProviderBtn = document.getElementById('addProviderBtn');
    if (addProviderBtn) {
        addProviderBtn.addEventListener('click', () => openProviderModal());
    }
    const editPreferencesBtn = document.getElementById('editPreferencesBtn');
    if (editPreferencesBtn) {
        editPreferencesBtn.addEventListener('click', openPreferencesModal);
    }
    const providerFormEl = document.getElementById('providerForm');
    if (providerFormEl) {
        providerFormEl.addEventListener('submit', handleSaveProvider);
    }
    const preferencesFormEl = document.getElementById('preferencesForm');
    if (preferencesFormEl) {
        preferencesFormEl.addEventListener('submit', handleSavePreferences);
    }

    // 日志控制按钮
    const pauseBtn = document.getElementById('pauseLogsBtn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', togglePauseLogs);
    }
    const clearBtn = document.getElementById('clearLogsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearLogsView);
    }

    document.addEventListener('click', async (event) => {
        // 处理 base_url 和 api_key 的复制
        const copyWrapper = event.target.closest('.copy-wrapper');
        if (copyWrapper) {
            const providerIndex = Number(copyWrapper.dataset.providerIndex);
            const field = copyWrapper.dataset.field;
            if (!Number.isNaN(providerIndex) && field) {
                copyProviderField(providerIndex, field);
            }
            return;
        }

        // 处理 provider name 和 model tag 的复制
        const copyElement = event.target.closest('[data-copy-text]');
        if (copyElement) {
            const text = copyElement.dataset.copyText;
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
    });
});

function switchTab(tab) {
    const configTab = document.getElementById('configTab');
    const logsTab = document.getElementById('logsTab');
    const tabConfigBtn = document.getElementById('tabConfig');
    const tabLogsBtn = document.getElementById('tabLogs');

    if (tab === 'logs') {
        configTab.classList.remove('active');
        logsTab.classList.add('active');
        tabConfigBtn.classList.remove('active');
        tabLogsBtn.classList.add('active');
        initLogsView();
    } else {
        logsTab.classList.remove('active');
        configTab.classList.add('active');
        tabLogsBtn.classList.remove('active');
        tabConfigBtn.classList.add('active');
    }
}

// 登录处理
async function handleLogin(e) {
    e.preventDefault();
    const key = document.getElementById('apiKey').value.trim();
    if (!key) return;

    apiKey = key;
    sessionStorage.setItem('apiKey', key);
    await login();
}

// 登录并加载配置
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

    // 如果当前在日志页，初始化日志
    const logsTabVisible = document.getElementById('logsTab')?.classList.contains('active');
    if (logsTabVisible) {
        initLogsView();
    }
}

// 登出
function handleLogout() {
    apiKey = '';
    configData = null;
    providerStatusMap = {};
    stopStatusPolling();
    sessionStorage.removeItem('apiKey');
    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('mainView').classList.add('hidden');
    document.getElementById('apiKey').value = '';

    // 停止日志连接
    stopLogStream();
    const out = document.getElementById('logOutput');
    if (out) out.textContent = '';
}

// 渲染 Providers 列表
function renderProviders() {
    const container = document.getElementById('providersList');
    if (!configData || !configData.providers || configData.providers.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无 Provider 配置</div>';
        return;
    }

    // 按优先级降序排序，并记录原始索引
    const providersWithIndex = configData.providers.map((provider, index) => ({
        provider,
        originalIndex: index
    }));
    providersWithIndex.sort((a, b) => {
        const priorityDiff = (b.provider.priority || 0) - (a.provider.priority || 0);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        const nameA = a.provider.provider || '';
        const nameB = b.provider.provider || '';
        return nameA.localeCompare(nameB);
    });

    // 构建表格
    container.innerHTML = `
        <table class="providers-table">
            <thead>
                <tr>
                    <th style="width: 110px; padding-right: 12px;">Provider</th>
                    <th style="width: 220px; padding-left: 12px;">Base URL</th>
                    <th style="width: 140px;">API Key</th>
                    <th style="width: 85px;">优先级</th>
                    <th>Models</th>
                    <th style="width: 140px;">状态</th>
                    <th style="width: 160px;">操作</th>
                </tr>
            </thead>
            <tbody>
                ${providersWithIndex.map(({provider, originalIndex}) => {
                    const showModelsEndpoint = provider.models_endpoint && provider.models_endpoint !== '/v1/models';
                    const manuallyEnabled = provider.enabled !== false;
                    const statusInfo = determineProviderStatus(provider);
                    const statusDetail = statusInfo.detail
                        ? `<div class="status-detail" title="${escapeHtml(statusInfo.detail)}">${escapeHtml(statusInfo.detail)}</div>`
                        : '';
                    const statusTitle = statusInfo.detail ? statusInfo.detail : statusInfo.label;
                    const statusTitleEscaped = escapeHtml(statusTitle);
                    const statusLabelEscaped = escapeHtml(statusInfo.label);
                    const toggleLabel = manuallyEnabled ? '禁用' : '启用';
                    const toggleTitle = manuallyEnabled ? '手动禁用此 Provider' : '手动启用此 Provider';

                    return `
                    <tr>
                        <td style="padding-right: 12px;">
                            <span class="provider-name" data-copy-text="${escapeHtml(provider.provider)}" title="点击复制">${escapeHtml(provider.provider)}</span>
                        </td>
                        <td style="padding-left: 12px;">
                            <div class="copy-wrapper" data-provider-index="${originalIndex}" data-field="base_url" title="点击复制">
                                <span>${escapeHtml(provider.base_url)}</span>
                            </div>
                        </td>
                        <td>
                            <div class="copy-wrapper" data-provider-index="${originalIndex}" data-field="api_key" title="点击复制">
                                <span>${maskApiKey(provider.api_key)}</span>
                            </div>
                        </td>
                        <td>${provider.priority || 0}</td>
                        <td style="max-width: 400px;">
                            ${provider.model ? `
                                <div class="model-list">
                                    ${provider.model.map(m => `<span class="model-tag" data-copy-text="${escapeHtml(m)}" title="点击复制">${escapeHtml(m)}</span>`).join('')}
                                </div>
                            ` : '<span style="color: #a0aec0;">-</span>'}
                            ${showModelsEndpoint ? `<div style="margin-top: 4px; font-size: 12px; color: #718096;">Endpoint: ${escapeHtml(provider.models_endpoint)}</div>` : ''}
                        </td>
                        <td>
                            <div class="status-cell">
                                <span class="status-pill ${statusInfo.className}" title="${statusTitleEscaped}">${statusLabelEscaped}</span>
                                ${statusDetail}
                            </div>
                        </td>
                        <td>
                            <div class="provider-actions">
                                <a class="action-link" onclick="toggleProviderEnabled(${originalIndex})" title="${toggleTitle}">${toggleLabel}</a>
                                <a class="action-link edit" onclick="openProviderModal(${originalIndex})" title="编辑">编辑</a>
                                <a class="action-link danger" onclick="deleteProvider(${originalIndex})" title="删除">删除</a>
                            </div>
                        </td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function isProviderEnabled(provider) {
    return provider && provider.enabled !== false;
}

function determineProviderStatus(provider) {
    const runtimeStatus = provider && provider.provider ? providerStatusMap[provider.provider] : null;
    const manualEnabled = isProviderEnabled(provider);

    if (!manualEnabled) {
        return {
            label: '已禁用',
            className: 'status-disabled',
            detail: ''
        };
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
        return {
            label: '自动禁用',
            className: 'status-auto',
            detail
        };
    }

    return {
        label: '已启用',
        className: 'status-enabled',
        detail: ''
    };
}

function formatProviderForSave(provider) {
    if (!provider) {
        return provider;
    }

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

// 渲染 Preferences
function renderPreferences() {
    const container = document.getElementById('headerPrefsView');
    const prefs = configData.preferences || {};
    const modelTimeout = getPreferenceNumber(prefs.model_timeout, 20);
    const cooldownPeriod = getPreferenceNumber(prefs.cooldown_period, 300);

    container.innerHTML = `
        <div class="header-prefs-item">
            <strong>Timeout:</strong>
            <span>${modelTimeout}s</span>
        </div>
        <div class="header-prefs-divider"></div>
        <div class="header-prefs-item">
            <strong>Cooldown:</strong>
            <span>${cooldownPeriod}s</span>
        </div>
        <div class="header-prefs-divider"></div>
        <div class="header-prefs-item">
            <strong>Proxy:</strong>
            <span>${prefs.proxy ? escapeHtml(prefs.proxy) : '未设置'}</span>
        </div>
        <a class="action-link edit" onclick="openPreferencesModal()" title="编辑 Preferences" style="margin-left: 8px;">编辑</a>
    `;
}

function startStatusPolling() {
    stopStatusPolling();
    if (!apiKey) {
        return;
    }
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
    if (!apiKey) {
        return;
    }

    try {
        const response = await fetch('/admin/providers/status', {
            headers: {
                'X-API-Key': apiKey
            }
        });

        if (response.status === 401) {
            if (!silent) {
                showError('API Key 无效，请重新登录');
            }
            handleLogout();
            return;
        }

        if (!response.ok) {
            throw new Error('加载 Provider 状态失败');
        }

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
        if (!silent) {
        showError(error.message);
        }
    }
}

// 打开 Provider 编辑模态框
function openProviderModal(index = -1) {
    editingProviderIndex = index;
    const modal = document.getElementById('providerModal');
    const title = document.getElementById('providerModalTitle');

    if (index >= 0) {
        // 编辑模式
        title.textContent = '编辑 Provider';
        const provider = configData.providers[index];
        document.getElementById('providerName').value = provider.provider;
        document.getElementById('providerBaseUrl').value = provider.base_url;
        document.getElementById('providerApiKey').value = provider.api_key;
        document.getElementById('providerPriority').value = provider.priority || 0;
        document.getElementById('providerModels').value = provider.model ? provider.model.join('\n') : '';
        document.getElementById('providerModelsEndpoint').value = provider.models_endpoint || '/v1/models';
        document.getElementById('providerEnabled').checked = provider.enabled !== false;
    } else {
        // 添加模式
        title.textContent = '添加 Provider';
        document.getElementById('providerForm').reset();
        document.getElementById('providerPriority').value = '0';
        document.getElementById('providerModelsEndpoint').value = '/v1/models';
        document.getElementById('providerEnabled').checked = true;
    }

    modal.classList.add('show');
}

// 关闭 Provider 模态框
function closeProviderModal() {
    document.getElementById('providerModal').classList.remove('show');
    editingProviderIndex = -1;
}

// 保存 Provider
async function handleSaveProvider(e) {
    e.preventDefault();

    const provider = {
        provider: document.getElementById('providerName').value.trim(),
        base_url: document.getElementById('providerBaseUrl').value.trim(),
        api_key: document.getElementById('providerApiKey').value.trim(),
        priority: parseInt(document.getElementById('providerPriority').value) || 0
    };

    const modelsText = document.getElementById('providerModels').value.trim();
    if (modelsText) {
        provider.model = modelsText.split('\n').map(m => m.trim()).filter(m => m);
    }

    const modelsEndpoint = document.getElementById('providerModelsEndpoint').value.trim();
    // 只有在非默认值时才保存 models_endpoint
    if (modelsEndpoint && modelsEndpoint !== '/v1/models') {
        provider.models_endpoint = modelsEndpoint;
    }

    if (document.getElementById('providerEnabled').checked) {
        delete provider.enabled;
    } else {
        provider.enabled = false;
    }

    const normalizedProvider = formatProviderForSave(provider);
    const isEdit = editingProviderIndex >= 0;
    const originalProvider = isEdit ? configData.providers[editingProviderIndex] : null;

    // 更新本地配置
    if (isEdit) {
        configData.providers[editingProviderIndex] = normalizedProvider;
    } else {
        configData.providers.push(normalizedProvider);
    }

    // 保存到服务器
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

// 删除 Provider
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

// 打开 Preferences 编辑模态框
function openPreferencesModal() {
    const prefs = configData.preferences || {};
    document.getElementById('modelTimeout').value = getPreferenceNumber(prefs.model_timeout, 20);
    document.getElementById('cooldownPeriod').value = getPreferenceNumber(prefs.cooldown_period, 300);
    document.getElementById('proxy').value = prefs.proxy || '';

    document.getElementById('preferencesModal').classList.add('show');
}

// 关闭 Preferences 模态框
function closePreferencesModal() {
    document.getElementById('preferencesModal').classList.remove('show');
}

// 保存 Preferences
async function handleSavePreferences(e) {
    e.preventDefault();

    // 保持原有的 preferences 对象，只更新修改的字段
    if (!configData.preferences) {
        configData.preferences = {};
    }

    configData.preferences.model_timeout = parseNumberInput(document.getElementById('modelTimeout').value, 20);
    configData.preferences.cooldown_period = parseNumberInput(document.getElementById('cooldownPeriod').value, 300);

    const proxy = document.getElementById('proxy').value.trim();
    if (proxy) {
        configData.preferences.proxy = proxy;
    } else {
        // 如果 proxy 为空，删除该字段
        delete configData.preferences.proxy;
    }

    const success = await saveConfig();
    if (success) {
        closePreferencesModal();
    }
}

// 保存配置到服务器
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
            if (refreshed.unauthorized) {
                showError('API Key 无效，请重新登录');
                handleLogout();
                return false;
            }
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

// 显示 Toast 提示
function showToast(message, type = 'success') {
    // 移除已存在的 toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    // 创建新的 toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发动画
    setTimeout(() => toast.classList.add('show'), 10);

    // 自动移除
    const duration = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// 显示错误信息
function showError(message) {
    showToast(message, 'error');
}

// 显示成功信息
function showSuccess(message) {
    showToast(message, 'success');
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 遮盖 API Key
function maskApiKey(key) {
    if (!key || key.length <= 8) return '********';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

// ---------------- 日志查看 ----------------
async function initLogsView() {
    // 加载最近日志
    await loadRecentLogs();
    // 开始流式
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
                if (logsAbortController?.signal.aborted) {
                    break;
                }
                // 断线重连
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
            } catch (_) { /* ignore parse errors */ }
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
