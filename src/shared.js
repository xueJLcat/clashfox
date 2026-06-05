(function (global) {
  "use strict";

  const DEFAULT_CONTROLLER_URL = "http://127.0.0.1:9090";
  const DEFAULT_BACKEND_ID = "default";
  const THEMES = ["light", "dark"];
  const FILTER_MODES = ["domain", "address", "all"];
  const FILTER_MODE_LABELS = {
    domain: "主域名",
    address: "完整地址",
    all: "全部连接"
  };
  const MULTI_PART_PUBLIC_SUFFIXES = new Set([
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "edu.cn",
    "co.uk",
    "org.uk",
    "ac.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.jp",
    "ne.jp",
    "or.jp",
    "co.kr",
    "com.br",
    "com.hk",
    "com.sg",
    "com.tw"
  ]);

  const DEFAULT_CONFIG = {
    controllerUrl: DEFAULT_CONTROLLER_URL,
    secret: "",
    refreshSeconds: 3,
    includeSuffixMatches: true,
    backends: [],
    activeBackendId: DEFAULT_BACKEND_ID,
    theme: "light",
    filterMode: "domain"
  };

  const REQUEST_TIMEOUT_MS = 5000;

  function extensionApi() {
    return global.browser || global.chrome;
  }

  function normalizeControllerUrl(value) {
    const raw = String(value || DEFAULT_CONFIG.controllerUrl).trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, "");
  }

  function validateControllerUrl(value) {
    const normalized = normalizeControllerUrl(value);

    try {
      const parsed = new URL(normalized);
      const hasPath = parsed.pathname && parsed.pathname !== "/";

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          url: normalized,
          error: "控制器地址只支持 http 或 https"
        };
      }

      if (!parsed.hostname) {
        return {
          url: normalized,
          error: "控制器地址缺少主机名"
        };
      }

      if (hasPath || parsed.search || parsed.hash) {
        return {
          url: normalized,
          error: "只填写 API 控制器地址，例如 http://192.168.20.2:9090"
        };
      }

      return {
        url: normalized,
        error: ""
      };
    } catch (error) {
      return {
        url: normalized,
        error: "控制器地址格式无效"
      };
    }
  }

  function generateBackendId() {
    return `backend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function backendNameFromUrl(url) {
    try {
      const parsed = new URL(normalizeControllerUrl(url));
      return parsed.host || "mihomo";
    } catch (error) {
      return "mihomo";
    }
  }

  function normalizeBackend(backend, index, usedIds) {
    const source = backend || {};
    const validation = validateControllerUrl(source.controllerUrl || DEFAULT_CONTROLLER_URL);

    if (validation.error) {
      return null;
    }

    let id = String(source.id || "").trim();
    if (!id || usedIds.has(id)) {
      id = index === 0 && !usedIds.has(DEFAULT_BACKEND_ID) ? DEFAULT_BACKEND_ID : generateBackendId();
    }
    usedIds.add(id);

    return {
      id,
      name: String(source.name || "").trim() || backendNameFromUrl(validation.url),
      controllerUrl: validation.url,
      secret: String(source.secret || "")
    };
  }

  function normalizeBackends(backends, legacyConfig) {
    const sourceBackends = Array.isArray(backends) && backends.length > 0
      ? backends
      : [{
        id: DEFAULT_BACKEND_ID,
        name: backendNameFromUrl(legacyConfig.controllerUrl || DEFAULT_CONTROLLER_URL),
        controllerUrl: legacyConfig.controllerUrl || DEFAULT_CONTROLLER_URL,
        secret: legacyConfig.secret || ""
      }];

    const usedIds = new Set();
    const normalized = sourceBackends
      .map((backend, index) => normalizeBackend(backend, index, usedIds))
      .filter(Boolean);

    if (normalized.length > 0) {
      return normalized;
    }

    return [{
      id: DEFAULT_BACKEND_ID,
      name: backendNameFromUrl(DEFAULT_CONTROLLER_URL),
      controllerUrl: DEFAULT_CONTROLLER_URL,
      secret: ""
    }];
  }

  function activeBackendFrom(backends, activeBackendId) {
    return backends.find((backend) => backend.id === activeBackendId) || backends[0];
  }

  function normalizeTheme(value) {
    const theme = String(value || "").trim().toLowerCase();
    return THEMES.includes(theme) ? theme : DEFAULT_CONFIG.theme;
  }

  function normalizeFilterMode(value) {
    const filterMode = String(value || "").trim().toLowerCase();
    return FILTER_MODES.includes(filterMode) ? filterMode : DEFAULT_CONFIG.filterMode;
  }

  function applyTheme(value) {
    const theme = normalizeTheme(value);

    if (global.document && global.document.documentElement) {
      global.document.documentElement.dataset.theme = theme;
      global.document.documentElement.style.colorScheme = theme;
    }

    return theme;
  }

  async function getConfig() {
    const api = extensionApi();
    const stored = await api.storage.local.get(DEFAULT_CONFIG);
    const backends = normalizeBackends(stored.backends, stored);
    const activeBackend = activeBackendFrom(backends, stored.activeBackendId);

    return {
      controllerUrl: activeBackend.controllerUrl,
      secret: activeBackend.secret,
      refreshSeconds: Math.max(1, Number(stored.refreshSeconds) || DEFAULT_CONFIG.refreshSeconds),
      includeSuffixMatches: stored.includeSuffixMatches !== false,
      backends,
      activeBackendId: activeBackend.id,
      activeBackend,
      theme: normalizeTheme(stored.theme),
      filterMode: normalizeFilterMode(stored.filterMode)
    };
  }

  async function saveConfig(config) {
    const api = extensionApi();
    const current = await getConfig();
    const backends = normalizeBackends(config.backends, current);
    const activeBackend = activeBackendFrom(backends, config.activeBackendId || current.activeBackendId);
    const refreshSeconds = Math.max(1, Number(config.refreshSeconds) || current.refreshSeconds);
    const includeSuffixMatches = config.includeSuffixMatches !== false;
    const theme = normalizeTheme(config.theme || current.theme);
    const filterMode = normalizeFilterMode(config.filterMode || current.filterMode);

    await api.storage.local.set({
      backends,
      activeBackendId: activeBackend.id,
      controllerUrl: activeBackend.controllerUrl,
      secret: activeBackend.secret,
      refreshSeconds,
      includeSuffixMatches,
      theme,
      filterMode
    });

    return {
      controllerUrl: activeBackend.controllerUrl,
      secret: activeBackend.secret,
      refreshSeconds,
      includeSuffixMatches,
      backends,
      activeBackendId: activeBackend.id,
      activeBackend,
      theme,
      filterMode
    };
  }

  async function setActiveBackend(activeBackendId) {
    const config = await getConfig();
    if (!config.backends.some((backend) => backend.id === activeBackendId)) {
      throw new Error("后端不存在");
    }

    return saveConfig({
      ...config,
      activeBackendId
    });
  }

  async function setFilterMode(filterMode) {
    const config = await getConfig();

    return saveConfig({
      ...config,
      filterMode: normalizeFilterMode(filterMode)
    });
  }

  function authHeaders(secret) {
    if (!secret) {
      return {};
    }

    return {
      Authorization: `Bearer ${secret}`
    };
  }

  function friendlyFetchError(error, endpoint) {
    if (error && error.name === "AbortError") {
      return new Error(`连接 mihomo 后端超时：${endpoint}`);
    }

    if (error && error.name === "SyntaxError") {
      return new Error(`mihomo 后端返回内容不是 JSON：${endpoint}`);
    }

    if (error && error.message) {
      return new Error(error.message);
    }

    return new Error(`无法连接 mihomo 后端：${endpoint}`);
  }

  async function fetchJsonWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = global.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await global.fetch(url, {
        ...options,
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`mihomo 鉴权失败：HTTP ${response.status}，请检查 Secret`);
        }
        throw new Error(`mihomo 请求失败：HTTP ${response.status} ${response.statusText}`.trim());
      }

      try {
        return await response.json();
      } catch (error) {
        throw friendlyFetchError(error, url);
      }
    } catch (error) {
      if (error && /^(mihomo |连接 mihomo|无法连接|mihomo 请求失败|mihomo 鉴权失败)/.test(error.message || "")) {
        throw error;
      }
      throw friendlyFetchError(error, url);
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  async function fetchConnections(config) {
    const validation = validateControllerUrl(config && config.controllerUrl);
    if (validation.error) {
      throw new Error(validation.error);
    }

    const endpoint = `${validation.url}/connections`;
    const data = await fetchJsonWithTimeout(endpoint, {
      headers: authHeaders(config && config.secret)
    });

    return {
      uploadTotal: Number(data.uploadTotal) || 0,
      downloadTotal: Number(data.downloadTotal) || 0,
      connections: Array.isArray(data.connections) ? data.connections : []
    };
  }

  function hostnameFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }

      return normalizeHost(parsed.hostname);
    } catch (error) {
      return "";
    }
  }

  function pageInfoFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      return {
        url,
        protocol: parsed.protocol,
        host: parsed.host.toLowerCase(),
        hostname: normalizeHost(parsed.hostname),
        port: parsed.port || ""
      };
    } catch (error) {
      return null;
    }
  }

  function normalizeHost(value) {
    let text = String(value || "").trim().toLowerCase();
    if (!text) {
      return "";
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      try {
        text = new URL(text).hostname;
      } catch (error) {
        return "";
      }
    }

    const slashIndex = text.indexOf("/");
    if (slashIndex >= 0) {
      text = text.slice(0, slashIndex);
    }

    const atIndex = text.lastIndexOf("@");
    if (atIndex >= 0) {
      text = text.slice(atIndex + 1);
    }

    if (text.startsWith("[")) {
      const end = text.indexOf("]");
      return end > 0 ? text.slice(1, end) : text;
    }

    const colonCount = (text.match(/:/g) || []).length;
    if (colonCount === 1) {
      text = text.split(":")[0];
    }

    return text.replace(/\.$/, "");
  }

  function isIpLike(host) {
    return /^[0-9.]+$/.test(host) || host.includes(":");
  }

  function baseDomainFromHost(host) {
    const normalizedHost = normalizeHost(host);

    if (!normalizedHost || isIpLike(normalizedHost)) {
      return normalizedHost;
    }

    const labels = normalizedHost.split(".").filter(Boolean);
    if (labels.length <= 2) {
      return normalizedHost;
    }

    const publicSuffix = labels.slice(-2).join(".");
    if (MULTI_PART_PUBLIC_SUFFIXES.has(publicSuffix) && labels.length >= 3) {
      return labels.slice(-3).join(".");
    }

    return labels.slice(-2).join(".");
  }

  function hostMatches(candidateHost, tabHost, includeSuffixMatches) {
    const candidate = normalizeHost(candidateHost);
    const target = normalizeHost(tabHost);

    if (!candidate || !target) {
      return false;
    }

    if (candidate === target) {
      return true;
    }

    if (!includeSuffixMatches || isIpLike(candidate) || isIpLike(target)) {
      return false;
    }

    if (!candidate.includes(".") || !target.includes(".")) {
      return false;
    }

    return candidate.endsWith(`.${target}`) || target.endsWith(`.${candidate}`);
  }

  function connectionCandidates(connection) {
    const metadata = connection.metadata || {};
    return [
      metadata.host,
      metadata.destinationHost,
      metadata.remoteDestination,
      metadata.destinationIP,
      metadata.destinationAddress,
      metadata.resolvedIP,
      metadata.dstIP
    ].map(normalizeHost).filter(Boolean);
  }

  function connectionPorts(connection) {
    const metadata = connection.metadata || {};
    return [
      metadata.destinationPort,
      metadata.remoteDestinationPort,
      metadata.dstPort,
      metadata.port
    ].map((value) => String(value || "")).filter(Boolean);
  }

  function connectionMatchesHost(connection, tabHost, config) {
    return connectionCandidates(connection).some((candidate) => {
      return hostMatches(candidate, tabHost, config.includeSuffixMatches);
    });
  }

  function connectionMatchesExactAddress(connection, pageInfo) {
    if (!pageInfo || !pageInfo.hostname) {
      return false;
    }

    const matchesHost = connectionCandidates(connection).some((candidate) => {
      return normalizeHost(candidate) === pageInfo.hostname;
    });

    if (!matchesHost || !pageInfo.port) {
      return matchesHost;
    }

    return connectionPorts(connection).some((port) => port === pageInfo.port);
  }

  function connectionMatchesMainDomain(connection, pageInfo) {
    if (!pageInfo || !pageInfo.hostname) {
      return false;
    }

    const baseDomain = baseDomainFromHost(pageInfo.hostname);
    if (!baseDomain || isIpLike(baseDomain)) {
      return connectionMatchesExactAddress(connection, pageInfo);
    }

    return connectionCandidates(connection).some((candidate) => {
      const host = normalizeHost(candidate);
      return host === baseDomain || host.endsWith(`.${baseDomain}`);
    });
  }

  function connectionMatchesFilter(connection, pageInfo, config) {
    const filterMode = normalizeFilterMode(config.filterMode);

    if (filterMode === "all") {
      return true;
    }

    if (filterMode === "address") {
      return connectionMatchesExactAddress(connection, pageInfo);
    }

    return connectionMatchesMainDomain(connection, pageInfo);
  }

  function connectionDestination(connection) {
    const metadata = connection.metadata || {};
    const host = normalizeHost(metadata.host)
      || normalizeHost(metadata.remoteDestination)
      || normalizeHost(metadata.destinationHost)
      || normalizeHost(metadata.destinationIP)
      || normalizeHost(metadata.destinationAddress);
    const port = metadata.destinationPort || metadata.remoteDestinationPort || "";

    return port ? `${host}:${port}` : host;
  }

  function connectionView(connection) {
    const metadata = connection.metadata || {};
    return {
      id: connection.id || "",
      destination: connectionDestination(connection),
      network: metadata.network || "",
      type: metadata.type || "",
      process: metadata.process || metadata.processPath || "",
      upload: Number(connection.upload) || 0,
      download: Number(connection.download) || 0,
      start: connection.start || "",
      chains: Array.isArray(connection.chains) ? connection.chains : [],
      rule: connection.rule || "",
      rulePayload: connection.rulePayload || ""
    };
  }

  function summarizeConnections(data, pageContext, config) {
    const pageInfo = typeof pageContext === "string"
      ? {
        url: "",
        protocol: "",
        host: pageContext,
        hostname: normalizeHost(pageContext),
        port: ""
      }
      : pageContext;
    const filterMode = normalizeFilterMode(config.filterMode);
    const matches = data.connections
      .filter((connection) => connectionMatchesFilter(connection, pageInfo, {
        ...config,
        filterMode
      }))
      .map(connectionView)
      .sort((left, right) => {
        return (right.upload + right.download) - (left.upload + left.download);
      });

    return {
      host: pageInfo ? pageInfo.hostname : "",
      pageUrl: pageInfo ? pageInfo.url : "",
      pageAddress: pageInfo ? pageInfo.host : "",
      filterMode,
      filterLabel: FILTER_MODE_LABELS[filterMode],
      fetchedAt: new Date().toISOString(),
      totalConnections: data.connections.length,
      uploadTotal: data.uploadTotal,
      downloadTotal: data.downloadTotal,
      matchedConnections: matches,
      matchedUpload: matches.reduce((sum, connection) => sum + connection.upload, 0),
      matchedDownload: matches.reduce((sum, connection) => sum + connection.download, 0)
    };
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = value;
    let unitIndex = 0;

    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }

    const fractionDigits = amount >= 10 || unitIndex === 0 ? 0 : 1;
    return `${amount.toFixed(fractionDigits)} ${units[unitIndex]}`;
  }

  function formatTime(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  global.ClashFox = {
    DEFAULT_CONFIG,
    getConfig,
    saveConfig,
    setActiveBackend,
    setFilterMode,
    generateBackendId,
    normalizeTheme,
    normalizeFilterMode,
    applyTheme,
    normalizeControllerUrl,
    validateControllerUrl,
    fetchConnections,
    hostnameFromUrl,
    pageInfoFromUrl,
    baseDomainFromHost,
    summarizeConnections,
    formatBytes,
    formatTime
  };
})(globalThis);
