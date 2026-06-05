(function () {
  "use strict";

  const status = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const host = document.getElementById("host");
  const backendSelect = document.getElementById("backendSelect");
  const backendUrl = document.getElementById("backendUrl");
  const filterButtons = Array.from(document.querySelectorAll("[data-filter-mode]"));
  const matchedCount = document.getElementById("matchedCount");
  const matchedCountLabel = document.getElementById("matchedCountLabel");
  const totalCount = document.getElementById("totalCount");
  const matchedTraffic = document.getElementById("matchedTraffic");
  const trafficLabel = document.getElementById("trafficLabel");
  const empty = document.getElementById("empty");
  const list = document.getElementById("list");
  const themeButton = document.getElementById("themeButton");
  const refreshButton = document.getElementById("refreshButton");
  const optionsButton = document.getElementById("optionsButton");

  let refreshTimer = null;
  let currentConfig = null;

  function text(value) {
    return String(value || "");
  }

  function setStatus(state) {
    status.className = `status ${state.status || ""}`.trim();
    statusText.textContent = state.message || "等待";
  }

  function backendLabel(backend) {
    return backend.name || backend.controllerUrl || "mihomo";
  }

  function renderBackendSelect(config) {
    backendSelect.replaceChildren();

    config.backends.forEach((backend) => {
      const option = document.createElement("option");
      option.value = backend.id;
      option.textContent = backendLabel(backend);
      backendSelect.append(option);
    });

    backendSelect.value = config.activeBackendId;
    backendUrl.textContent = config.activeBackend ? config.activeBackend.controllerUrl : "";
  }

  function renderThemeButton(theme) {
    const activeTheme = ClashFox.normalizeTheme(theme);
    themeButton.textContent = activeTheme === "dark" ? "☀" : "☾";
    themeButton.title = activeTheme === "dark" ? "切换到浅色主题" : "切换到深色主题";
    themeButton.setAttribute("aria-label", themeButton.title);
  }

  function setFilterButtonsDisabled(disabled) {
    filterButtons.forEach((button) => {
      button.disabled = disabled;
    });
  }

  function renderFilterMode(filterMode) {
    const activeFilterMode = ClashFox.normalizeFilterMode(filterMode);
    filterButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.filterMode === activeFilterMode);
    });
  }

  async function loadConfig() {
    currentConfig = await ClashFox.getConfig();
    ClashFox.applyTheme(currentConfig.theme);
    renderBackendSelect(currentConfig);
    renderFilterMode(currentConfig.filterMode);
    renderThemeButton(currentConfig.theme);
    return currentConfig;
  }

  function connectionMeta(connection) {
    return [
      connection.type,
      connection.network,
      connection.rule ? `${connection.rule}${connection.rulePayload ? `:${connection.rulePayload}` : ""}` : "",
      ClashFox.formatTime(connection.start)
    ].filter(Boolean);
  }

  function renderConnection(connection) {
    const item = document.createElement("article");
    item.className = "connection";

    const head = document.createElement("div");
    head.className = "connection-head";

    const destination = document.createElement("div");
    destination.className = "destination";
    destination.textContent = text(connection.destination) || "unknown";

    const traffic = document.createElement("div");
    traffic.className = "traffic";
    traffic.textContent = `${ClashFox.formatBytes(connection.download)} ↓ / ${ClashFox.formatBytes(connection.upload)} ↑`;

    head.append(destination, traffic);

    const meta = document.createElement("div");
    meta.className = "meta";
    connectionMeta(connection).forEach((value) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = value;
      meta.append(pill);
    });

    const chain = document.createElement("div");
    chain.className = "chain";
    if (connection.chains.length > 0) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = connection.chains.join(" -> ");
      chain.append(pill);
    }

    item.append(head, meta, chain);
    return item;
  }

  function render(state) {
    setStatus(state);

    const filterMode = state.filterMode || (currentConfig && currentConfig.filterMode) || "domain";

    host.textContent = filterMode === "all"
      ? "全部连接"
      : state.pageAddress || state.host || "当前页面";
    matchedCount.textContent = String((state.matchedConnections || []).length);
    totalCount.textContent = String(state.totalConnections || 0);
    matchedTraffic.textContent = ClashFox.formatBytes((state.matchedDownload || 0) + (state.matchedUpload || 0));
    matchedCountLabel.textContent = filterMode === "all" ? "显示" : "匹配";
    trafficLabel.textContent = filterMode === "all" ? "连接流量" : "页面流量";

    list.replaceChildren();
    const matches = state.matchedConnections || [];
    empty.hidden = matches.length > 0 || state.status === "error";

    matches.forEach((connection) => {
      list.append(renderConnection(connection));
    });

    if (state.status === "error") {
      empty.hidden = false;
      empty.textContent = state.message || "连接失败";
    } else {
      empty.textContent = filterMode === "all" ? "当前后端暂无连接" : "未发现匹配连接";
    }
  }

  async function loadState(type) {
    refreshButton.disabled = true;
    try {
      await loadConfig();
      const state = await browser.runtime.sendMessage({
        type
      });
      render(state);
    } catch (error) {
      render({
        status: "error",
        message: error && error.message ? error.message : "连接失败",
        matchedConnections: [],
        totalConnections: 0
      });
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function switchBackend() {
    const backendId = backendSelect.value;
    if (!backendId || (currentConfig && backendId === currentConfig.activeBackendId)) {
      return;
    }

    refreshButton.disabled = true;
    backendSelect.disabled = true;
    setStatus({
      status: "idle",
      message: "切换中"
    });

    try {
      const state = await browser.runtime.sendMessage({
        type: "clashfox:switch-backend",
        backendId
      });
      await loadConfig();
      render(state);
    } catch (error) {
      if (currentConfig) {
        renderBackendSelect(currentConfig);
      }
      render({
        status: "error",
        message: error && error.message ? error.message : "切换失败",
        matchedConnections: [],
        totalConnections: 0
      });
    } finally {
      refreshButton.disabled = false;
      backendSelect.disabled = false;
    }
  }

  async function switchFilterMode(event) {
    const filterMode = event.currentTarget.dataset.filterMode;
    if (!filterMode || (currentConfig && filterMode === currentConfig.filterMode)) {
      return;
    }

    refreshButton.disabled = true;
    setFilterButtonsDisabled(true);
    setStatus({
      status: "idle",
      message: "切换中"
    });

    try {
      const state = await browser.runtime.sendMessage({
        type: "clashfox:switch-filter-mode",
        filterMode
      });
      await loadConfig();
      render(state);
    } catch (error) {
      if (currentConfig) {
        renderFilterMode(currentConfig.filterMode);
      }
      render({
        status: "error",
        message: error && error.message ? error.message : "切换失败",
        matchedConnections: [],
        totalConnections: 0
      });
    } finally {
      refreshButton.disabled = false;
      setFilterButtonsDisabled(false);
    }
  }

  async function toggleTheme() {
    themeButton.disabled = true;

    try {
      const config = currentConfig || await loadConfig();
      const nextTheme = ClashFox.normalizeTheme(config.theme) === "dark" ? "light" : "dark";
      currentConfig = await ClashFox.saveConfig({
        ...config,
        theme: nextTheme
      });
      ClashFox.applyTheme(currentConfig.theme);
      renderThemeButton(currentConfig.theme);
    } finally {
      themeButton.disabled = false;
    }
  }

  async function startAutoRefresh() {
    const config = await loadConfig();
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(() => loadState("clashfox:refresh"), config.refreshSeconds * 1000);
  }

  backendSelect.addEventListener("change", switchBackend);
  filterButtons.forEach((button) => button.addEventListener("click", switchFilterMode));
  themeButton.addEventListener("click", toggleTheme);
  refreshButton.addEventListener("click", () => loadState("clashfox:refresh"));
  optionsButton.addEventListener("click", () => browser.runtime.openOptionsPage());

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadState("clashfox:refresh");
    }
  });

  loadState("clashfox:refresh");
  startAutoRefresh();
})();
