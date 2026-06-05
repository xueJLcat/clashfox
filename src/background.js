(function () {
  "use strict";

  const api = browser;
  const REFRESH_CONFIG_KEYS = new Set([
    "controllerUrl",
    "secret",
    "refreshSeconds",
    "includeSuffixMatches",
    "backends",
    "activeBackendId",
    "filterMode"
  ]);
  let refreshTimer = null;
  let inFlightRefresh = null;
  let refreshGeneration = 0;
  let lastState = {
    status: "idle",
    message: "未连接",
    host: "",
    matchedConnections: [],
    totalConnections: 0
  };

  async function activeTab() {
    const tabs = await api.tabs.query({
      active: true,
      currentWindow: true
    });

    return tabs[0] || null;
  }

  async function setBadge(tabId, state) {
    if (!tabId) {
      return;
    }

    let text = "";
    let color = "#6b7280";

    if (state.status === "ready") {
      text = state.matchedConnections.length > 0 ? String(state.matchedConnections.length) : "0";
      color = state.matchedConnections.length > 0 ? "#16a34a" : "#6b7280";
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

  async function buildStateForTab(tab) {
    if (!tab || !tab.url) {
      return {
        status: "idle",
        message: "没有活动标签页",
        host: "",
        matchedConnections: [],
        totalConnections: 0
      };
    }

    const config = await ClashFox.getConfig();
    const pageInfo = ClashFox.pageInfoFromUrl(tab.url);
    if (!pageInfo && config.filterMode !== "all") {
      return {
        status: "unsupported",
        message: "当前页面不是 HTTP/HTTPS",
        host: "",
        matchedConnections: [],
        totalConnections: 0
      };
    }

    const connections = await ClashFox.fetchConnections(config);
    const summary = ClashFox.summarizeConnections(connections, pageInfo, config);

    return {
      status: "ready",
      message: "已连接",
      ...summary
    };
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
          totalConnections: 0
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
    trackedRefresh = work.finally(() => {
      if (inFlightRefresh === trackedRefresh) {
        inFlightRefresh = null;
      }
    });
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
    if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
      refreshActiveTab();
    }
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

  resetTimer();
})();
