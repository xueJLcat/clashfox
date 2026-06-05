(function (global) {
  "use strict";

  const DEFAULT_CONTROLLER_URL = "http://127.0.0.1:9090";
  const DEFAULT_BACKEND_ID = "default";
  const THEMES = ["light", "dark"];
  const FILTER_MODES = ["domain", "address", "all", "resources"];
  const MATCH_STRATEGIES = ["smart", "strict", "loose"];
  const FILTER_MODE_LABELS = {
    domain: "主域名",
    address: "完整地址",
    all: "全部连接",
    resources: "页面资源"
  };
  const MATCH_STRATEGY_LABELS = {
    smart: "智能",
    strict: "严格",
    loose: "宽松"
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
    matchStrategy: "smart",
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

  function normalizeMatchStrategy(value, legacyIncludeSuffixMatches) {
    const strategy = String(value || "").trim().toLowerCase();
    if (MATCH_STRATEGIES.includes(strategy)) {
      return strategy;
    }
    return legacyIncludeSuffixMatches === false ? "strict" : DEFAULT_CONFIG.matchStrategy;
  }

  function includeSuffixMatchesForStrategy(strategy) {
    return normalizeMatchStrategy(strategy) !== "strict";
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
    const stored = await api.storage.local.get(null);
    const source = {
      ...DEFAULT_CONFIG,
      ...stored
    };
    const backends = normalizeBackends(stored.backends, stored);
    const activeBackend = activeBackendFrom(backends, source.activeBackendId);
    const hasMatchStrategy = Object.prototype.hasOwnProperty.call(stored, "matchStrategy");
    const matchStrategy = normalizeMatchStrategy(hasMatchStrategy ? stored.matchStrategy : "", source.includeSuffixMatches);

    return {
      controllerUrl: activeBackend.controllerUrl,
      secret: activeBackend.secret,
      refreshSeconds: Math.max(1, Number(source.refreshSeconds) || DEFAULT_CONFIG.refreshSeconds),
      includeSuffixMatches: includeSuffixMatchesForStrategy(matchStrategy),
      matchStrategy,
      backends,
      activeBackendId: activeBackend.id,
      activeBackend,
      theme: normalizeTheme(source.theme),
      filterMode: normalizeFilterMode(source.filterMode)
    };
  }

  async function saveConfig(config) {
    const api = extensionApi();
    const current = await getConfig();
    const backends = normalizeBackends(config.backends, current);
    const activeBackend = activeBackendFrom(backends, config.activeBackendId || current.activeBackendId);
    const refreshSeconds = Math.max(1, Number(config.refreshSeconds) || current.refreshSeconds);
    const hasMatchStrategy = Object.prototype.hasOwnProperty.call(config, "matchStrategy");
    const hasLegacySuffixSetting = Object.prototype.hasOwnProperty.call(config, "includeSuffixMatches");
    const matchStrategy = hasMatchStrategy
      ? normalizeMatchStrategy(config.matchStrategy, current.includeSuffixMatches)
      : hasLegacySuffixSetting
        ? normalizeMatchStrategy("", config.includeSuffixMatches)
        : current.matchStrategy;
    const includeSuffixMatches = includeSuffixMatchesForStrategy(matchStrategy);
    const theme = normalizeTheme(config.theme || current.theme);
    const filterMode = normalizeFilterMode(config.filterMode || current.filterMode);

    await api.storage.local.set({
      backends,
      activeBackendId: activeBackend.id,
      controllerUrl: activeBackend.controllerUrl,
      secret: activeBackend.secret,
      refreshSeconds,
      includeSuffixMatches,
      matchStrategy,
      theme,
      filterMode
    });

    return {
      controllerUrl: activeBackend.controllerUrl,
      secret: activeBackend.secret,
      refreshSeconds,
      includeSuffixMatches,
      matchStrategy,
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

  function defaultPortForProtocol(protocol) {
    if (protocol === "http:" || protocol === "ws:") {
      return "80";
    }
    if (protocol === "https:" || protocol === "wss:") {
      return "443";
    }
    return "";
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
        port: parsed.port || "",
        effectivePort: parsed.port || defaultPortForProtocol(parsed.protocol)
      };
    } catch (error) {
      return null;
    }
  }

  function resourceInfoFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
        return null;
      }

      return {
        url,
        protocol: parsed.protocol,
        host: parsed.host.toLowerCase(),
        hostname: normalizeHost(parsed.hostname),
        port: parsed.port || "",
        effectivePort: parsed.port || defaultPortForProtocol(parsed.protocol),
        path: `${parsed.pathname || "/"}${parsed.search || ""}`,
        origin: parsed.origin
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

  function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function connectionCandidates(connection) {
    const metadata = connection.metadata || {};
    return uniqueValues([
      metadata.host,
      metadata.destinationHost,
      metadata.remoteDestination,
      metadata.destinationIP,
      metadata.destinationAddress,
      metadata.resolvedIP,
      metadata.dstIP
    ].map(normalizeHost));
  }

  function connectionPorts(connection) {
    const metadata = connection.metadata || {};
    return uniqueValues([
      metadata.destinationPort,
      metadata.remoteDestinationPort,
      metadata.dstPort,
      metadata.port
    ].map((value) => String(value || "").trim()).filter(Boolean));
  }

  function connectionDestination(connection) {
    const metadata = connection.metadata || {};
    const host = normalizeHost(metadata.host)
      || normalizeHost(metadata.remoteDestination)
      || normalizeHost(metadata.destinationHost)
      || normalizeHost(metadata.destinationIP)
      || normalizeHost(metadata.destinationAddress);
    const port = metadata.destinationPort || metadata.remoteDestinationPort || metadata.dstPort || "";

    return port && host ? `${host}:${port}` : host;
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

  function addMapEntry(map, key, entry) {
    if (!key) {
      return;
    }

    const entries = map.get(key) || [];
    entries.push(entry);
    map.set(key, entries);
  }

  function indexedConnectionEntry(connection, index) {
    const candidates = connectionCandidates(connection);
    const hosts = uniqueValues(candidates.filter((candidate) => !isIpLike(candidate)));
    const ips = uniqueValues(candidates.filter(isIpLike));
    const domains = uniqueValues(hosts.map(baseDomainFromHost).filter(Boolean));
    const ports = connectionPorts(connection);
    const view = connectionView(connection);

    return {
      index,
      connection,
      view,
      hosts,
      ips,
      domains,
      hostSet: new Set(hosts),
      ipSet: new Set(ips),
      domainSet: new Set(domains),
      portSet: new Set(ports),
      traffic: view.upload + view.download
    };
  }

  function buildConnectionIndex(data) {
    const connections = data && Array.isArray(data.connections) ? data.connections : [];
    const entries = connections.map(indexedConnectionEntry);
    const byHost = new Map();
    const byIp = new Map();
    const byDomain = new Map();

    entries.forEach((entry) => {
      entry.hosts.forEach((host) => addMapEntry(byHost, host, entry));
      entry.ips.forEach((ip) => addMapEntry(byIp, ip, entry));
      entry.domains.forEach((domain) => addMapEntry(byDomain, domain, entry));
    });

    return {
      entries,
      byHost,
      byIp,
      byDomain
    };
  }

  function addCandidateEntries(target, entries) {
    (entries || []).forEach((entry) => target.add(entry));
  }

  function pagePortMatches(entry, pageInfo) {
    const effectivePort = pageInfo && pageInfo.effectivePort ? String(pageInfo.effectivePort) : "";
    const explicitPort = pageInfo && pageInfo.port ? String(pageInfo.port) : "";

    if (!effectivePort || entry.portSet.size === 0) {
      return true;
    }

    return entry.portSet.has(effectivePort) || (!!explicitPort && entry.portSet.has(explicitPort));
  }

  function entryMatchesExactAddress(entry, pageInfo) {
    if (!pageInfo || !pageInfo.hostname) {
      return false;
    }

    const hostname = normalizeHost(pageInfo.hostname);
    const matchesHost = entry.hostSet.has(hostname) || entry.ipSet.has(hostname);

    return matchesHost && pagePortMatches(entry, pageInfo);
  }

  function entryMatchesMainDomain(entry, pageInfo, config) {
    if (!pageInfo || !pageInfo.hostname) {
      return false;
    }

    const strategy = normalizeMatchStrategy(config && config.matchStrategy, config && config.includeSuffixMatches);
    const hostname = normalizeHost(pageInfo.hostname);
    const baseDomain = baseDomainFromHost(hostname);

    if (!baseDomain || isIpLike(baseDomain) || strategy === "strict") {
      return entryMatchesExactAddress(entry, pageInfo);
    }

    if (entry.hostSet.has(hostname) || entry.ipSet.has(hostname)) {
      return true;
    }

    if (strategy === "smart") {
      return entry.domainSet.has(baseDomain);
    }

    return entry.domainSet.has(baseDomain) || entry.hosts.some((host) => hostMatches(host, hostname, true));
  }

  function connectionMatchesFilter(entry, pageInfo, config) {
    const filterMode = normalizeFilterMode(config.filterMode);

    if (filterMode === "all" || filterMode === "resources") {
      return true;
    }

    if (filterMode === "address") {
      return entryMatchesExactAddress(entry, pageInfo);
    }

    return entryMatchesMainDomain(entry, pageInfo, config);
  }

  function summarizeConnections(data, pageContext, config) {
    const pageInfo = typeof pageContext === "string"
      ? {
        url: "",
        protocol: "",
        host: pageContext,
        hostname: normalizeHost(pageContext),
        port: "",
        effectivePort: ""
      }
      : pageContext;
    const filterMode = normalizeFilterMode(config.filterMode);
    const connectionIndex = buildConnectionIndex(data);
    const matches = connectionIndex.entries
      .filter((entry) => connectionMatchesFilter(entry, pageInfo, {
        ...config,
        filterMode
      }))
      .map((entry) => entry.view)
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

  function requestStatusText(request) {
    if (request.error) {
      return "ERR";
    }
    if (request.statusCode) {
      return String(request.statusCode);
    }
    return request.status === "pending" ? "..." : "-";
  }

  function requestDuration(request) {
    const start = Number(request.startedAt) || Number(request.timeStamp) || 0;
    const end = Number(request.endedAt) || 0;
    if (!start || !end || end < start) {
      return 0;
    }
    return Math.round(end - start);
  }

  function dedupeRequests(requests) {
    const map = new Map();
    (Array.isArray(requests) ? requests : []).forEach((request) => {
      if (!request || !request.url) {
        return;
      }
      const key = request.requestId || `${request.method || "GET"} ${request.url}`;
      map.set(key, request);
    });
    return Array.from(map.values());
  }

  function resourceMatchThreshold(strategy) {
    if (strategy === "strict") {
      return 100;
    }
    if (strategy === "loose") {
      return 52;
    }
    return 72;
  }

  function resourceCandidateEntries(resource, connectionIndex, strategy) {
    const resourceHost = normalizeHost(resource.host || resource.hostname);
    const resourceIp = normalizeHost(resource.ip);
    const candidates = new Set();

    if (resourceHost) {
      addCandidateEntries(candidates, connectionIndex.byHost.get(resourceHost));
      addCandidateEntries(candidates, connectionIndex.byIp.get(resourceHost));
    }

    if (resourceIp) {
      addCandidateEntries(candidates, connectionIndex.byIp.get(resourceIp));
    }

    if (resourceHost && !isIpLike(resourceHost) && strategy !== "strict") {
      addCandidateEntries(candidates, connectionIndex.byDomain.get(baseDomainFromHost(resourceHost)));
    }

    return Array.from(candidates);
  }

  function bestHostScore(entry, resource, strategy) {
    const resourceHost = normalizeHost(resource.host || resource.hostname);
    const resourceIp = normalizeHost(resource.ip);
    const resourceBaseDomain = resourceHost && !isIpLike(resourceHost) ? baseDomainFromHost(resourceHost) : "";
    let score = 0;
    let reason = "";

    if (resourceHost && entry.hostSet.has(resourceHost)) {
      score = 120;
      reason = "Host 精确";
    }

    if (resourceHost && entry.ipSet.has(resourceHost) && score < 116) {
      score = 116;
      reason = "IP 精确";
    }

    if (resourceIp && entry.ipSet.has(resourceIp) && score < 112) {
      score = 112;
      reason = "服务器 IP";
    }

    if (strategy !== "strict" && resourceBaseDomain && entry.domainSet.has(resourceBaseDomain) && score < 84) {
      score = strategy === "loose" ? 76 : 84;
      reason = "主域名";
    }

    if (strategy === "loose" && resourceHost && score < 64 && entry.hosts.some((host) => hostMatches(host, resourceHost, true))) {
      score = 64;
      reason = "后缀匹配";
    }

    return {
      score,
      reason
    };
  }

  function scoreIndexedConnectionForResource(entry, resource, config) {
    const strategy = normalizeMatchStrategy(config && config.matchStrategy, config && config.includeSuffixMatches);
    const resourcePort = String(resource.effectivePort || resource.port || "");
    const hostScore = bestHostScore(entry, resource, strategy);
    let score = hostScore.score;
    let reason = hostScore.reason;

    if (score <= 0) {
      return null;
    }

    if (resourcePort && entry.portSet.size > 0) {
      if (entry.portSet.has(resourcePort) || entry.portSet.has(String(resource.port || ""))) {
        score += 12;
        reason = reason ? `${reason} / 端口一致` : "端口一致";
      } else if (strategy !== "loose") {
        return null;
      } else {
        score -= 14;
        reason = reason ? `${reason} / 端口不同` : "端口不同";
      }
    }

    return {
      score,
      reason
    };
  }

  function findConnectionForResource(resource, connectionIndex, config) {
    const strategy = normalizeMatchStrategy(config && config.matchStrategy, config && config.includeSuffixMatches);
    const candidates = resourceCandidateEntries(resource, connectionIndex, strategy);
    const threshold = resourceMatchThreshold(strategy);
    let bestConnection = null;
    let bestScore = 0;
    let bestReason = "";

    candidates.forEach((entry) => {
      const result = scoreIndexedConnectionForResource(entry, resource, config);
      if (result && result.score > bestScore) {
        bestScore = result.score;
        bestReason = result.reason;
        bestConnection = entry;
      }
    });

    if (!bestConnection || bestScore < threshold) {
      return null;
    }

    return {
      score: bestScore,
      reason: bestReason || MATCH_STRATEGY_LABELS[strategy],
      connection: bestConnection.connection,
      view: bestConnection.view
    };
  }

  function resourceView(request, connectionIndex, pageInfo, config) {
    const urlInfo = resourceInfoFromUrl(request.url) || {};
    const resource = {
      requestId: request.requestId || "",
      url: request.url || "",
      host: normalizeHost(request.host || urlInfo.hostname),
      address: urlInfo.host || request.host || "",
      path: urlInfo.path || "",
      protocol: urlInfo.protocol || "",
      port: urlInfo.port || "",
      effectivePort: urlInfo.effectivePort || "",
      method: request.method || "GET",
      type: request.type || "other",
      status: request.status || "pending",
      statusCode: Number(request.statusCode) || 0,
      statusText: requestStatusText(request),
      error: request.error || "",
      ip: normalizeHost(request.ip),
      fromCache: !!request.fromCache,
      thirdParty: !!request.thirdParty,
      frameId: Number.isFinite(Number(request.frameId)) ? Number(request.frameId) : -1,
      parentFrameId: Number.isFinite(Number(request.parentFrameId)) ? Number(request.parentFrameId) : -1,
      documentUrl: request.documentUrl || "",
      originUrl: request.originUrl || "",
      pageUrl: request.pageUrl || "",
      startedAt: Number(request.startedAt) || Number(request.timeStamp) || 0,
      endedAt: Number(request.endedAt) || 0,
      durationMs: requestDuration(request),
      isMainFrame: request.type === "main_frame",
      isSameHost: !!(pageInfo && pageInfo.hostname && normalizeHost(request.host || urlInfo.hostname) === pageInfo.hostname)
    };

    const match = findConnectionForResource(resource, connectionIndex, config);
    if (match) {
      resource.matchScore = match.score;
      resource.matchReason = match.reason;
      resource.matchStrategy = normalizeMatchStrategy(config && config.matchStrategy, config && config.includeSuffixMatches);
      resource.connection = match.view;
    }

    return resource;
  }

  function uniqueMatchedConnections(resources) {
    const map = new Map();
    resources.forEach((resource) => {
      if (!resource.connection) {
        return;
      }
      const key = resource.connection.id || resource.connection.destination || `${resource.host}:${resource.effectivePort}`;
      if (!map.has(key)) {
        map.set(key, resource.connection);
      }
    });
    return Array.from(map.values()).sort((left, right) => {
      return (right.upload + right.download) - (left.upload + left.download);
    });
  }

  function summarizeResources(requests, data, pageInfo, config) {
    const filterMode = "resources";
    const connections = data && Array.isArray(data.connections) ? data.connections : [];
    const connectionIndex = buildConnectionIndex(data);
    const currentPageUrl = (() => {
      if (!pageInfo || !pageInfo.url) {
        return "";
      }
      try {
        const parsed = new URL(pageInfo.url);
        parsed.hash = "";
        return parsed.href;
      } catch (error) {
        return pageInfo.url;
      }
    })();
    const views = dedupeRequests(requests)
      .filter((request) => !currentPageUrl || !request.pageUrl || request.pageUrl === currentPageUrl)
      .map((request) => resourceView(request, connectionIndex, pageInfo, config))
      .sort((left, right) => {
        if (left.isMainFrame !== right.isMainFrame) {
          return left.isMainFrame ? -1 : 1;
        }
        return (right.startedAt || 0) - (left.startedAt || 0);
      });
    const matchedConnections = uniqueMatchedConnections(views);
    const resourceHosts = new Set(views.map((resource) => resource.host).filter(Boolean));

    return {
      host: pageInfo ? pageInfo.hostname : "",
      pageUrl: pageInfo ? pageInfo.url : "",
      pageAddress: pageInfo ? pageInfo.host : "",
      filterMode,
      filterLabel: FILTER_MODE_LABELS[filterMode],
      fetchedAt: new Date().toISOString(),
      totalConnections: connections.length,
      uploadTotal: Number(data && data.uploadTotal) || 0,
      downloadTotal: Number(data && data.downloadTotal) || 0,
      resourceRequests: views,
      resourceCount: views.length,
      resourceHostCount: resourceHosts.size,
      matchedResourceCount: views.filter((resource) => !!resource.connection).length,
      relatedConnectionCount: matchedConnections.length,
      matchedConnections,
      matchedUpload: matchedConnections.reduce((sum, connection) => sum + connection.upload, 0),
      matchedDownload: matchedConnections.reduce((sum, connection) => sum + connection.download, 0)
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

    let fractionDigits = 0;
    if (unitIndex > 1 && amount < 10) {
      fractionDigits = 2;
    } else if (unitIndex > 1 && amount < 100) {
      fractionDigits = 1;
    }

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

  function formatDuration(ms) {
    const value = Number(ms) || 0;
    if (!value) {
      return "";
    }
    if (value < 1000) {
      return `${value} ms`;
    }
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
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
    normalizeMatchStrategy,
    applyTheme,
    normalizeControllerUrl,
    validateControllerUrl,
    fetchConnections,
    hostnameFromUrl,
    pageInfoFromUrl,
    resourceInfoFromUrl,
    normalizeHost,
    baseDomainFromHost,
    summarizeConnections,
    summarizeResources,
    formatBytes,
    formatTime,
    formatDuration
  };
})(globalThis);
