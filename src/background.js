(function () {
  "use strict";

  const api = browser;
  const REFRESH_CONFIG_KEYS = new Set([
    "controllerUrl",
    "secret",
    "refreshSeconds",
    "includeSuffixMatches",
    "matchStrategy",
    "backends",
    "activeBackendId",
    "filterMode"
  ]);
  const RESOURCE_URL_FILTER = {
    urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
  };
  const MAX_REQUESTS_PER_TAB = 500;
  const REQUEST_TTL_MS = 10 * 60 * 1000;

  let refreshTimer = null;
  let inFlightRefresh = null;
  let refreshGeneration = 0;
  let lastState = {
    status: "idle",
    message: "未连接",
    host: "",
    matchedConnections: [],
    totalConnections: 0,
    resourceRequests: []
  };
  const tabRequestMap = new Map();

  async function activeTab() {
    const tabs = await api.tabs.query({
      active: true,
      currentWindow: true
    });

    return tabs[0] || null;
  }

  function badgeText(value) {
    const count = Number(value) || 0;
    if (count <= 0) {
      return "0";
    }
    return count > 999 ? "999+" : String(count);
  }

  async function setBadge(tabId, state) {
    if (!tabId) {
      return;
    }

    let text = "";
    let color = "#6b7280";

    if (state.status === "ready" || state.status === "partial") {
      const count = (state.matchedConnections || []).length;
      text = badgeText(count);
      color = count > 0 ? "#16a34a" : "#6b7280";
      if (state.status === "partial") {
        color = "#d97706";
      }
    } else if (state.status === "error") {
      text = "!";
      color = "#dc2626";
    }

    await api.browserAction.setBadgeText({
      tabId,
      text
    });
    await api.browserAction.setBadgeBackgroundColor({
      tabId,
      color
    });
  }

  function emptyConnections() {
    return {
      uploadTotal: 0,
      downloadTotal: 0,
      connections: []
    };
  }

  function canonicalPageUrl(url) {
    if (!url) {
      return "";
    }

    try {
      const pageInfo = ClashFox.pageInfoFromUrl(url);
      if (!pageInfo) {
        return "";
      }

      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  function emptyRequestBucket(pageUrl) {
    return {
      pageUrl: pageUrl || "",
      createdAt: Date.now(),
      requests: new Map()
    };
  }

  function requestBucket(tabId) {
    const bucket = tabRequestMap.get(tabId);
    if (!bucket) {
      return null;
    }

    if (bucket.requests instanceof Map) {
      return bucket;
    }

    if (bucket instanceof Map) {
      const migrated = {
        pageUrl: "",
        createdAt: Date.now(),
        requests: bucket
      };
      tabRequestMap.set(tabId, migrated);
      return migrated;
    }

    return null;
  }

  function resetRequestBucket(tabId, pageUrl) {
    const bucket = emptyRequestBucket(pageUrl);
    tabRequestMap.set(tabId, bucket);
    return bucket;
  }

  function ensureRequestBucket(tabId, pageUrl) {
    let bucket = requestBucket(tabId);

    if (!bucket) {
      bucket = resetRequestBucket(tabId, pageUrl);
      return bucket;
    }

    if (pageUrl && bucket.pageUrl && bucket.pageUrl !== pageUrl) {
      bucket = resetRequestBucket(tabId, pageUrl);
      return bucket;
    }

    if (pageUrl && !bucket.pageUrl) {
      bucket.pageUrl = pageUrl;
    }

    return bucket;
  }

  function getTabRequests(tabId, pageUrl) {
    const bucket = requestBucket(tabId);
    if (!bucket || !(bucket.requests instanceof Map)) {
      return [];
    }

    const currentPageUrl = pageUrl || "";
    if (currentPageUrl && bucket.pageUrl && bucket.pageUrl !== currentPageUrl) {
      return [];
    }

    const now = Date.now();
    const fresh = Array.from(bucket.requests.values()).filter((request) => {
      const startedAt = Number(request.startedAt) || Number(request.timeStamp) || now;
      const samePage = !currentPageUrl || !request.pageUrl || request.pageUrl === currentPageUrl;
      return samePage && now - startedAt <= REQUEST_TTL_MS;
    });

    if (fresh.length !== bucket.requests.size) {
      const nextRequests = new Map();
      fresh.forEach((request) => nextRequests.set(request.requestId, request));
      bucket.requests = nextRequests;
      tabRequestMap.set(tabId, bucket);
    }

    return fresh;
  }

  function normalizeRequestDetails(details) {
    const info = ClashFox.resourceInfoFromUrl(details.url);
    if (!info) {
      return null;
    }

    return {
      requestId: details.requestId,
      url: details.url,
      host: info.hostname,
      address: info.host,
      protocol: info.protocol,
      port: info.port,
      effectivePort: info.effectivePort,
      method: details.method || "GET",
      type: details.type || "other",
      frameId: typeof details.frameId === "number" ? details.frameId : -1,
      parentFrameId: typeof details.parentFrameId === "number" ? details.parentFrameId : -1,
      documentUrl: details.documentUrl || "",
      originUrl: details.originUrl || "",
      thirdParty: !!details.thirdParty,
      timeStamp: details.timeStamp || Date.now()
    };
  }

  function pruneBucket(tabId, bucket) {
    if (!bucket || !(bucket.requests instanceof Map)) {
      return;
    }

    const now = Date.now();
    const sorted = Array.from(bucket.requests.values())
      .filter((request) => {
        const startedAt = Number(request.startedAt) || Number(request.timeStamp) || now;
        return now - startedAt <= REQUEST_TTL_MS;
      })
      .sort((left, right) => {
        return (Number(right.startedAt) || Number(right.timeStamp) || 0) - (Number(left.startedAt) || Number(left.timeStamp) || 0);
      })
      .slice(0, MAX_REQUESTS_PER_TAB);

    const nextRequests = new Map();
    sorted.forEach((request) => nextRequests.set(request.requestId, request));
    bucket.requests = nextRequests;
    tabRequestMap.set(tabId, bucket);
  }

  function rememberRequest(details, phase) {
    if (!details || typeof details.tabId !== "number" || details.tabId < 0 || !details.requestId || !details.url) {
      return;
    }

    const normalized = normalizeRequestDetails(details);
    if (!normalized) {
      return;
    }

    const tabId = details.tabId;
    const isMainFrame = normalized.type === "main_frame";
    const requestPageUrl = isMainFrame
      ? canonicalPageUrl(normalized.url)
      : canonicalPageUrl(normalized.documentUrl || normalized.originUrl);

    let bucket = null;

    if (phase === "before" && isMainFrame) {
      bucket = resetRequestBucket(tabId, requestPageUrl);
    } else {
      bucket = ensureRequestBucket(tabId, requestPageUrl);
    }

    if (requestPageUrl && bucket.pageUrl && requestPageUrl !== bucket.pageUrl) {
      return;
    }

    const previous = bucket.requests.get(normalized.requestId) || {};
    const startedAt = previous.startedAt || normalized.timeStamp || Date.now();
    const next = {
      ...previous,
      ...normalized,
      startedAt,
      pageUrl: bucket.pageUrl || requestPageUrl || previous.pageUrl || ""
    };

    if (phase === "before") {
      next.status = "pending";
    }

    if (phase === "redirect") {
      next.status = "redirect";
      next.statusCode = details.statusCode || previous.statusCode || 0;
      next.ip = details.ip || previous.ip || "";
      next.redirectUrl = details.redirectUrl || "";
      next.endedAt = details.timeStamp || Date.now();
    }

    if (phase === "completed") {
      next.status = "completed";
      next.statusCode = details.statusCode || 0;
      next.ip = details.ip || previous.ip || "";
      next.fromCache = !!details.fromCache;
      next.endedAt = details.timeStamp || Date.now();
      next.error = "";
    }

    if (phase === "error") {
      next.status = "error";
      next.error = details.error || "请求失败";
      next.endedAt = details.timeStamp || Date.now();
    }

    bucket.requests.set(normalized.requestId, next);
    pruneBucket(tabId, bucket);
  }

  async function buildResourceState(tab, config, pageInfo) {
    let connections = emptyConnections();
    let backendError = null;

    try {
      connections = await ClashFox.fetchConnections(config);
    } catch (error) {
      backendError = error;
    }

    const pageUrl = pageInfo && pageInfo.url ? canonicalPageUrl(pageInfo.url) : "";
    const summary = ClashFox.summarizeResources(getTabRequests(tab.id, pageUrl), connections, pageInfo, config);
    return {
      status: backendError ? "partial" : "ready",
      message: backendError ? `已捕获资源，mihomo 连接失败：${backendError.message || "连接失败"}` : "连接正常",
      backendError: backendError ? (backendError.message || "连接失败") : "",
      ...summary
    };
  }

  async function buildConnectionState(tab, config, pageInfo) {
    const connections = await ClashFox.fetchConnections(config);
    const summary = ClashFox.summarizeConnections(connections, pageInfo, config);

    return {
      status: "ready",
      message: "连接正常",
      resourceRequests: getTabRequests(tab.id, pageInfo && pageInfo.url ? canonicalPageUrl(pageInfo.url) : ""),
      ...summary
    };
  }

  async function buildStateForTab(tab) {
    if (!tab || !tab.url) {
      return {
        status: "idle",
        message: "没有活动标签页",
        host: "",
        matchedConnections: [],
        totalConnections: 0,
        resourceRequests: []
      };
    }

    const config = await ClashFox.getConfig();
    const pageInfo = ClashFox.pageInfoFromUrl(tab.url);
    const filterMode = ClashFox.normalizeFilterMode(config.filterMode);

    let effectiveFilterMode = filterMode;
    let effectivePageInfo = pageInfo;

    if (!pageInfo && filterMode !== "all") {
      effectiveFilterMode = "all";
      effectivePageInfo = {
        url: tab.url || "",
        protocol: "",
        host: "",
        hostname: "",
        port: "",
        effectivePort: ""
      };
    }

    if (effectiveFilterMode === "resources") {
      return buildResourceState(tab, {
        ...config,
        filterMode: effectiveFilterMode
      }, effectivePageInfo);
    }

    return buildConnectionState(tab, {
      ...config,
      filterMode: effectiveFilterMode
    }, effectivePageInfo);
  }

  async function refreshActiveTab(options) {
    const force = options && options.force === true;

    if (inFlightRefresh && !force) {
      return inFlightRefresh;
    }

    const generation = ++refreshGeneration;
    const work = (async () => {
      const tab = await activeTab();
      let nextState;

      try {
        nextState = await buildStateForTab(tab);
      } catch (error) {
        nextState = {
          status: "error",
          message: error && error.message ? error.message : "连接失败",
          host: tab ? ClashFox.hostnameFromUrl(tab.url) : "",
          matchedConnections: [],
          totalConnections: 0,
          resourceRequests: []
        };
      }

      if (generation === refreshGeneration) {
        lastState = nextState;
        await setBadge(tab && tab.id, lastState);
        return lastState;
      }

      return nextState;
    })();

    let trackedRefresh = null;
    trackedRefresh = work.then(
      (result) => {
        if (inFlightRefresh === trackedRefresh) {
          inFlightRefresh = null;
        }
        return result;
      },
      (error) => {
        if (inFlightRefresh === trackedRefresh) {
          inFlightRefresh = null;
        }
        throw error;
      }
    );
    inFlightRefresh = trackedRefresh;

    return trackedRefresh;
  }

  async function resetTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    const config = await ClashFox.getConfig();
    refreshTimer = setInterval(refreshActiveTab, config.refreshSeconds * 1000);
    await refreshActiveTab({
      force: true
    });
  }

  api.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) {
      return undefined;
    }

    if (message.type === "clashfox:get-state" || message.type === "clashfox:refresh") {
      return refreshActiveTab();
    }

    if (message.type === "clashfox:get-last-state") {
      return Promise.resolve(lastState);
    }

    if (message.type === "clashfox:get-tab-requests") {
      return activeTab().then((tab) => ({
        ok: true,
        requests: tab ? getTabRequests(tab.id) : []
      }));
    }

    if (message.type === "clashfox:config-updated") {
      return resetTimer().then(() => lastState);
    }

    if (message.type === "clashfox:switch-backend") {
      return ClashFox.setActiveBackend(message.backendId).then(() => refreshActiveTab({
        force: true
      }));
    }

    if (message.type === "clashfox:switch-filter-mode") {
      return ClashFox.setFilterMode(message.filterMode).then(() => refreshActiveTab({
        force: true
      }));
    }

    return undefined;
  });

  api.tabs.onActivated.addListener(() => {
    refreshActiveTab();
  });

  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      const pageUrl = canonicalPageUrl(changeInfo.url);
      if (pageUrl) {
        resetRequestBucket(tabId, pageUrl);
      } else {
        tabRequestMap.delete(tabId);
      }
    }

    if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
      refreshActiveTab();
    }
  });

  api.tabs.onRemoved.addListener((tabId) => {
    tabRequestMap.delete(tabId);
  });

  api.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== api.windows.WINDOW_ID_NONE) {
      refreshActiveTab();
    }
  });

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.keys(changes).some((key) => REFRESH_CONFIG_KEYS.has(key))) {
      resetTimer();
    }
  });

  if (api.webRequest) {
    api.webRequest.onBeforeRequest.addListener((details) => {
      rememberRequest(details, "before");
    }, RESOURCE_URL_FILTER);

    if (api.webRequest.onBeforeRedirect) {
      api.webRequest.onBeforeRedirect.addListener((details) => {
        rememberRequest(details, "redirect");
      }, RESOURCE_URL_FILTER);
    }

    api.webRequest.onCompleted.addListener((details) => {
      rememberRequest(details, "completed");
    }, RESOURCE_URL_FILTER);

    api.webRequest.onErrorOccurred.addListener((details) => {
      rememberRequest(details, "error");
    }, RESOURCE_URL_FILTER);
  }

  resetTimer();
})();
