(function () {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  const previewMode = !extensionApi || !extensionApi.runtime;

  const popup = document.querySelector(".popup");
  const status = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const host = document.getElementById("host");
  const backendSelect = document.getElementById("backendSelect");
  const backendUrl = document.getElementById("backendUrl");
  const backendBadge = document.querySelector(".backend-badge");
  const filterButtons = Array.from(document.querySelectorAll("[data-filter-mode]"));
  const matchedCount = document.getElementById("matchedCount");
  const matchedCountLabel = document.getElementById("matchedCountLabel");
  const totalCount = document.getElementById("totalCount");
  const totalCountLabel = document.getElementById("totalCountLabel");
  const matchedTraffic = document.getElementById("matchedTraffic");
  const trafficLabel = document.getElementById("trafficLabel");
  const empty = document.getElementById("empty");
  const list = document.getElementById("list");
  const themeButton = document.getElementById("themeButton");
  const refreshButton = document.getElementById("refreshButton");
  const optionsButton = document.getElementById("optionsButton");

  let refreshTimer = null;
  let currentConfig = null;
  let detailIdCounter = 0;
  let configRenderSignature = "";
  let listRenderSignature = "";
  let stateRequestId = 0;
  let activeRefreshes = 0;
  const expandedDetailKeys = new Set();

  const ICONS = {
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19v-3"/><path d="M8 19v-7"/><path d="M12 19v-5"/><path d="M16 19V9"/><path d="M20 19V5"/><path d="m4 14 5-5 4 4 7-7"/><path d="m16 6h4v4"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 7.4A9 9 0 1 1 12 3Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill-shape" d="M8 5.4v13.2c0 1.1 1.3 1.8 2.2 1.1l10-6.6a1.4 1.4 0 0 0 0-2.3l-10-6.5C9.3 3.6 8 4.3 8 5.4Z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.2 6.5"/><path d="M3 12A9 9 0 0 1 18.2 5.5"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>',
    // Lucide settings icon. Inline SVG keeps the extension popup offline-safe and avoids remote icon-font loading.
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>',
    zap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill-shape" d="M13.2 2.5 4.6 13.1c-.5.7-.1 1.7.8 1.7h5.1l-.8 6c-.1 1 .9 1.6 1.6.9l8.3-10.8c.5-.7 0-1.6-.8-1.6h-5l.7-5.9c.2-.9-.8-1.5-1.3-.9Z"/></svg>'
  };

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function createElement(tagName, className, content) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (content !== undefined) {
      element.textContent = content;
    }
    return element;
  }

  function setIcon(element, kind) {
    const names = {
      cloud: "cloud",
      play: "play",
      zap: "zap"
    };
    element.dataset.icon = kind;
    replaceIcon(element, names[kind] || "globe", "connection-svg");
  }

  function iconElement(name, className) {
    const template = document.createElement("template");
    template.innerHTML = ICONS[name] || ICONS.globe;
    const svg = template.content.firstElementChild;
    svg.classList.add("ui-icon");
    if (className) {
      svg.classList.add(className);
    }
    return svg;
  }

  function replaceIcon(container, name, className) {
    container.replaceChildren(iconElement(name, className));
  }

  function setButtonIcon(button, name) {
    const existing = button.querySelector(".button-icon");
    if (existing) {
      existing.remove();
    }
    const icon = iconElement(name, "button-icon");
    button.prepend(icon);
  }

  function renderStaticIcons() {
    replaceIcon(document.querySelector(".metric-links .metric-icon"), "link", "metric-svg");
    replaceIcon(document.querySelector(".metric-total .metric-icon"), "layers", "metric-svg");
    replaceIcon(document.querySelector(".metric-traffic .metric-icon"), "chart", "metric-svg");
    setButtonIcon(refreshButton, "refresh");
    if (optionsButton) {
      setButtonIcon(optionsButton, "settings");
    }
  }

  function localPreviewConfig() {
    const backend = {
      id: "default",
      name: "家里 mihomo",
      controllerUrl: "http://127.0.0.1:9090",
      secret: ""
    };

    return {
      controllerUrl: backend.controllerUrl,
      secret: "",
      refreshSeconds: 3,
      includeSuffixMatches: true,
      matchStrategy: "smart",
      backends: [backend],
      activeBackendId: backend.id,
      activeBackend: backend,
      theme: "light",
      filterMode: "all"
    };
  }

  function localPreviewState() {
    return {
      status: "ready",
      message: "连接正常",
      host: "example.com",
      pageAddress: "example.com",
      filterMode: "all",
      totalConnections: 128,
      matchedUpload: 234 * 1024 + 98 * 1024 + 1120 * 1024,
      matchedDownload: 1230 * 1024 + 512 * 1024 + 6700 * 1024,
      matchedConnections: [
        {
          destination: "api.example.com:443",
          network: "tcp",
          type: "HTTP",
          upload: 234 * 1024,
          download: 1230 * 1024,
          chains: ["Hong Kong"],
          rule: "Proxy",
          rulePayload: ""
        },
        {
          destination: "static.example.com:443",
          network: "tcp",
          type: "HTTPS",
          upload: 98 * 1024,
          download: 512 * 1024,
          chains: ["DIRECT"],
          rule: "Direct",
          rulePayload: ""
        },
        {
          destination: "video.example.com:443",
          network: "tcp",
          type: "HTTPS",
          upload: 1120 * 1024,
          download: 6700 * 1024,
          chains: ["Japan"],
          rule: "Proxy",
          rulePayload: ""
        }
      ],
      resourceRequests: []
    };
  }

  function displayStatusMessage(state) {
    const message = state.message || "等待";
    if (state.status === "ready" && message === "已连接") {
      return "连接正常";
    }
    if (state.status === "idle" && message === "未连接") {
      return "等待连接";
    }
    return message;
  }

  function setStatus(state) {
    status.className = `status ${state.status || ""}`.trim();
    const message = displayStatusMessage(state);
    statusText.textContent = message;
    statusText.title = message;
  }

  function backendLabel(backend) {
    return backend.name || backend.controllerUrl || "mihomo";
  }

  function controllerScope(url) {
    try {
      const parsed = new URL(url);
      const hostName = parsed.hostname.toLowerCase();
      return hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1" ? "本地" : "远程";
    } catch (error) {
      return "当前";
    }
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
    const activeUrl = config.activeBackend ? config.activeBackend.controllerUrl : "";
    backendUrl.textContent = activeUrl;
    backendUrl.title = activeUrl;
    backendBadge.textContent = controllerScope(activeUrl);
  }

  function renderThemeButton(theme) {
    const activeTheme = ClashFox.normalizeTheme(theme);
    themeButton.textContent = "主题";
    themeButton.dataset.icon = activeTheme === "dark" ? "sun" : "moon";
    setButtonIcon(themeButton, activeTheme === "dark" ? "sun" : "moon");
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

  function configSignature(config) {
    return JSON.stringify({
      activeBackendId: config.activeBackendId,
      activeUrl: config.activeBackend ? config.activeBackend.controllerUrl : "",
      backends: (config.backends || []).map((backend) => [
        backend.id,
        backend.name,
        backend.controllerUrl
      ]),
      filterMode: config.filterMode,
      theme: ClashFox.normalizeTheme(config.theme)
    });
  }

  function renderConfig(config, force) {
    const signature = configSignature(config);
    if (!force && signature === configRenderSignature) {
      return;
    }

    configRenderSignature = signature;
    ClashFox.applyTheme(config.theme);
    renderBackendSelect(config);
    renderFilterMode(config.filterMode);
    renderThemeButton(config.theme);
  }

  async function loadConfig(options) {
    currentConfig = previewMode ? localPreviewConfig() : await ClashFox.getConfig();
    renderConfig(currentConfig, options && options.force);
    return currentConfig;
  }

  function iconKindForConnection(connection) {
    const destination = text(connection.destination).toLowerCase();
    const type = text(connection.type || connection.network).toLowerCase();
    if (destination.includes("video") || destination.includes("media") || destination.includes("youtube")) {
      return "play";
    }
    if (destination.includes("static") || destination.includes("cdn") || destination.includes("asset")) {
      return "cloud";
    }
    if (type.includes("udp")) {
      return "zap";
    }
    return "globe";
  }

  function iconKindForResource(resource) {
    const type = text(resource.type).toLowerCase();
    const url = text(resource.url).toLowerCase();
    if (type.includes("image")) {
      return "globe";
    }
    if (type.includes("script") || url.endsWith(".js")) {
      return "cloud";
    }
    if (type.includes("stylesheet") || url.endsWith(".css")) {
      return "cloud";
    }
    if (type.includes("websocket") || url.startsWith("ws://") || url.startsWith("wss://")) {
      return "globe";
    }
    if (type.includes("media") || type.includes("video")) {
      return "play";
    }
    return "globe";
  }

  function tagText(value, fallback) {
    const raw = text(value).trim() || fallback;
    return raw.length <= 5 ? raw.toUpperCase() : raw;
  }

  function ruleText(connection) {
    if (!connection || !connection.rule) {
      return "未知";
    }
    return connection.rulePayload ? `${connection.rule}: ${connection.rulePayload}` : connection.rule;
  }

  function chainText(connection) {
    if (!connection || !Array.isArray(connection.chains) || connection.chains.length === 0) {
      return "DIRECT";
    }
    return connection.chains.join(" / ");
  }

  function matchReasonText(resource) {
    if (!resource || !resource.connection) {
      return "";
    }
    const reason = text(resource.matchReason).trim() || "已关联";
    const score = Number(resource.matchScore) || 0;
    return score ? `${reason} ${Math.round(score)}` : reason;
  }

  function matchStrategyText(value) {
    const strategy = ClashFox.normalizeMatchStrategy ? ClashFox.normalizeMatchStrategy(value) : text(value);
    if (strategy === "strict") {
      return "严格";
    }
    if (strategy === "loose") {
      return "宽松";
    }
    return "智能";
  }

  function appendMeta(container, label, value) {
    if (!value) {
      return;
    }

    const item = createElement("span", "meta-item");
    const labelElement = createElement("span", "meta-label", `${label}: `);
    item.append(labelElement, document.createTextNode(value));
    container.append(item);
  }

  function detailValue(value, fallback) {
    const normalized = text(value).trim();
    return normalized || fallback || "";
  }

  function appendDetail(container, label, value, options) {
    const normalized = detailValue(value);
    if (!normalized) {
      return;
    }

    const item = createElement("div", "detail-item");
    if (options && options.wide) {
      item.classList.add("wide");
    }

    item.append(
      createElement("div", "detail-label", label),
      createElement("div", "detail-value", normalized)
    );
    container.append(item);
  }

  function renderDetails(rows) {
    detailIdCounter += 1;
    const details = createElement("div", "connection-details");
    details.id = `connection-details-${detailIdCounter}`;
    details.hidden = true;
    rows.forEach((row) => appendDetail(details, row.label, row.value, row));
    return details;
  }

  function setDetailsExpanded(item, button, details, expanded) {
    item.classList.toggle("expanded", expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", expanded ? "收起详情" : "查看详情");
    details.hidden = !expanded;
  }

  function toggleDetails(item, button, details) {
    const expanded = !item.classList.contains("expanded");
    const detailKey = item.dataset.detailKey || "";
    setDetailsExpanded(item, button, details, expanded);
    if (!detailKey) {
      return;
    }
    if (expanded) {
      expandedDetailKeys.add(detailKey);
    } else {
      expandedDetailKeys.delete(detailKey);
    }
  }

  function wireDetailsToggle(item, button, details, detailKey) {
    item.dataset.detailKey = detailKey || "";
    button.type = "button";
    button.setAttribute("aria-label", "查看详情");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", details.id);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDetails(item, button, details);
    });

    item.tabIndex = 0;
    item.addEventListener("click", (event) => {
      if (event.target.closest("button") || event.target.closest(".connection-details")) {
        return;
      }
      toggleDetails(item, button, details);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      toggleDetails(item, button, details);
    });

    if (detailKey && expandedDetailKeys.has(detailKey)) {
      setDetailsExpanded(item, button, details, true);
    }
  }

  function detailKeyForConnection(connection) {
    return [
      "connection",
      connection.id,
      connection.destination,
      connection.network,
      connection.type,
      ruleText(connection),
      chainText(connection)
    ].filter(Boolean).join("|");
  }

  function detailKeyForResource(resource) {
    return [
      "resource",
      resource.requestId,
      resource.url,
      resource.address,
      resource.host,
      resource.method,
      resource.type
    ].filter(Boolean).join("|");
  }

  function trafficBlock(download, upload) {
    const traffic = createElement("div", "traffic");
    const down = createElement("div", "traffic-line down", `↓ ${ClashFox.formatBytes(download)}`);
    const up = createElement("div", "traffic-line up", `↑ ${ClashFox.formatBytes(upload)}`);
    traffic.append(down, up);
    return traffic;
  }

  function statusBlock(resource) {
    const traffic = createElement("div", "traffic");
    const statusLine = createElement("div", `traffic-line ${resourceStatusClass(resource) || ""}`.trim(), resource.statusText || "-");
    const duration = createElement("div", "traffic-line", resource.durationMs ? ClashFox.formatDuration(resource.durationMs) : resource.method || "");
    traffic.append(statusLine, duration);
    return traffic;
  }

  function renderConnection(connection) {
    const item = createElement("article", "connection");

    const icon = createElement("div", "connection-icon");
    setIcon(icon, iconKindForConnection(connection));

    const main = createElement("div", "connection-main");
    const titleLine = createElement("div", "connection-title-line");
    const destination = createElement("div", "destination", text(connection.destination) || "unknown");
    destination.title = text(connection.destination);
    const protocol = createElement("span", "protocol-pill", tagText(connection.network || connection.type, "TCP"));
    titleLine.append(destination, protocol);

    const meta = createElement("div", "connection-meta-line");
    appendMeta(meta, "Rule", ruleText(connection));
    appendMeta(meta, "节点", chainText(connection));
    if (connection.process) {
      appendMeta(meta, "进程", connection.process);
    }
    if (connection.start) {
      appendMeta(meta, "开始", ClashFox.formatTime(connection.start));
    }

    main.append(titleLine, meta);

    const details = renderDetails([
      { label: "目标地址", value: connection.destination || "unknown", wide: true },
      { label: "协议", value: tagText(connection.network || connection.type, "TCP") },
      { label: "类型", value: connection.type },
      { label: "规则", value: ruleText(connection) },
      { label: "节点", value: chainText(connection), wide: true },
      { label: "下载", value: ClashFox.formatBytes(connection.download) },
      { label: "上传", value: ClashFox.formatBytes(connection.upload) },
      { label: "进程", value: connection.process, wide: true },
      { label: "开始时间", value: ClashFox.formatTime(connection.start) },
      { label: "连接 ID", value: connection.id, wide: true }
    ]);
    const chevron = createElement("button", "chevron-button");
    setButtonIcon(chevron, "chevronRight");
    wireDetailsToggle(item, chevron, details, detailKeyForConnection(connection));
    item.append(icon, main, trafficBlock(connection.download, connection.upload), chevron, details);
    return item;
  }

  function resourceStatusClass(resource) {
    if (resource.error || resource.status === "error") {
      return "error";
    }
    if (resource.statusCode >= 400) {
      return "warn";
    }
    if (resource.statusCode >= 200 && resource.statusCode < 400) {
      return "ok";
    }
    return "";
  }

  function renderResource(resource) {
    const item = createElement("article", "connection resource");
    item.classList.toggle("has-match", !!resource.connection);
    item.classList.toggle("unmatched", !resource.connection);

    const icon = createElement("div", "connection-icon");
    setIcon(icon, iconKindForResource(resource));

    const main = createElement("div", "connection-main");
    const titleLine = createElement("div", "connection-title-line");
    const destinationText = resource.address || resource.host || "unknown";
    const destination = createElement("div", "destination", destinationText);
    destination.title = resource.url || destinationText;
    const statusPill = createElement("span", `status-pill ${resourceStatusClass(resource)}`.trim(), resource.statusText || "-");
    titleLine.append(destination, statusPill);

    const meta = createElement("div", "connection-meta-line");
    appendMeta(meta, "类型", tagText(resource.type, "OTHER"));
    appendMeta(meta, "方法", resource.method || "GET");
    if (resource.ip) {
      appendMeta(meta, "IP", resource.ip);
    }
    if (resource.connection) {
      appendMeta(meta, "Rule", ruleText(resource.connection));
      appendMeta(meta, "节点", chainText(resource.connection));
      appendMeta(meta, "匹配", matchReasonText(resource));
    } else {
      appendMeta(meta, "关联", "未匹配 mihomo 连接");
    }

    main.append(titleLine, meta);

    const details = renderDetails([
      { label: "资源地址", value: resource.url || destinationText, wide: true },
      { label: "资源路径", value: resource.path, wide: true },
      { label: "类型", value: tagText(resource.type, "OTHER") },
      { label: "方法", value: resource.method || "GET" },
      { label: "状态", value: resource.statusText || "-" },
      { label: "耗时", value: resource.durationMs ? ClashFox.formatDuration(resource.durationMs) : "" },
      { label: "服务器 IP", value: resource.ip },
      { label: "缓存", value: resource.fromCache ? "命中缓存" : "" },
      { label: "第三方资源", value: resource.thirdParty ? "是" : "" },
      { label: "关联规则", value: resource.connection ? ruleText(resource.connection) : "未匹配 mihomo 连接", wide: true },
      { label: "关联节点", value: resource.connection ? chainText(resource.connection) : "", wide: true },
      { label: "匹配依据", value: resource.connection ? matchReasonText(resource) : "", wide: true },
      { label: "匹配策略", value: resource.connection ? matchStrategyText(resource.matchStrategy) : "" },
      { label: "下载", value: resource.connection ? ClashFox.formatBytes(resource.connection.download) : "" },
      { label: "上传", value: resource.connection ? ClashFox.formatBytes(resource.connection.upload) : "" }
    ]);
    const chevron = createElement("button", "chevron-button");
    setButtonIcon(chevron, "chevronRight");
    wireDetailsToggle(item, chevron, details, detailKeyForResource(resource));
    item.append(
      icon,
      main,
      resource.connection ? trafficBlock(resource.connection.download, resource.connection.upload) : statusBlock(resource),
      chevron,
      details
    );
    return item;
  }

  function renderMetrics(state) {
    matchedCount.textContent = String((state.matchedConnections || []).length);
    totalCount.textContent = String(state.totalConnections || 0);
    matchedTraffic.textContent = ClashFox.formatBytes((state.matchedDownload || 0) + (state.matchedUpload || 0));

    matchedCountLabel.textContent = "连接";
    totalCountLabel.textContent = "总连接";
    trafficLabel.textContent = "流量";
  }

  function hostTitle(state, filterMode) {
    if (filterMode === "all") {
      return "全部连接";
    }
    if (filterMode === "resources") {
      return `${state.pageAddress || state.host || "当前页面"} 资源`;
    }
    return state.pageAddress || state.host || "当前页面";
  }

  function connectionSignature(connection) {
    return [
      detailKeyForConnection(connection),
      connection.destination,
      connection.network,
      connection.type,
      ruleText(connection),
      chainText(connection),
      connection.upload,
      connection.download,
      connection.process,
      connection.start
    ];
  }

  function resourceSignature(resource) {
    return [
      detailKeyForResource(resource),
      resource.address,
      resource.host,
      resource.type,
      resource.method,
      resource.statusText,
      resource.durationMs,
      resource.ip,
      resource.connection ? detailKeyForConnection(resource.connection) : "",
      resource.matchScore,
      resource.matchReason
    ];
  }

  function listSignature(state, filterMode) {
    const rows = filterMode === "resources"
      ? (state.resourceRequests || []).map(resourceSignature)
      : (state.matchedConnections || []).map(connectionSignature);

    return JSON.stringify({
      filterMode,
      status: state.status || "",
      message: state.status === "error" ? state.message || "" : "",
      rows
    });
  }

  function replaceListIfChanged(signature, rows, renderRow) {
    if (signature === listRenderSignature) {
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      fragment.append(renderRow(row));
    });

    const scrollTop = list.scrollTop;
    list.replaceChildren(fragment);
    list.scrollTop = scrollTop;
    listRenderSignature = signature;
  }

  function render(state) {
    setStatus(state);

    const filterMode = state.filterMode || (currentConfig && currentConfig.filterMode) || "domain";
    renderFilterMode(filterMode);
    host.textContent = hostTitle(state, filterMode);
    host.title = host.textContent;
    renderMetrics(state);

    if (filterMode === "resources") {
      const resources = state.resourceRequests || [];
      empty.hidden = resources.length > 0 || state.status === "error";
      replaceListIfChanged(listSignature(state, filterMode), resources, renderResource);

      if (state.status === "error") {
        empty.hidden = false;
        empty.textContent = state.message || "连接失败";
      } else {
        empty.textContent = "还没有捕获到当前页面生命周期内的资源请求，请刷新页面后再查看";
      }
      return;
    }

    const matches = state.matchedConnections || [];
    empty.hidden = matches.length > 0 || state.status === "error";
    replaceListIfChanged(listSignature(state, filterMode), matches, renderConnection);

    if (state.status === "error") {
      empty.hidden = false;
      empty.textContent = state.message || "连接失败";
    } else {
      empty.textContent = filterMode === "all" ? "当前后端暂无连接" : "未发现匹配连接";
    }
  }

  function setRefreshing(refreshing) {
    if (!popup) {
      return;
    }
    popup.dataset.refreshing = refreshing ? "true" : "false";
    popup.setAttribute("aria-busy", String(refreshing));
  }

  function beginRefresh() {
    activeRefreshes += 1;
    setRefreshing(true);
  }

  function endRefresh() {
    activeRefreshes = Math.max(0, activeRefreshes - 1);
    setRefreshing(activeRefreshes > 0);
  }

  async function loadState(type, options) {
    const silent = !!(options && options.silent);
    const requestId = ++stateRequestId;
    beginRefresh();
    if (!silent) {
      refreshButton.disabled = true;
    }
    try {
      await loadConfig({
        force: !!(options && options.forceConfig)
      });
      const state = previewMode ? localPreviewState() : await extensionApi.runtime.sendMessage({
        type
      });
      if (requestId !== stateRequestId) {
        return;
      }
      render({
        ...state,
        filterMode: state.filterMode || currentConfig.filterMode
      });
    } catch (error) {
      if (requestId !== stateRequestId) {
        return;
      }
      render({
        status: "error",
        message: error && error.message ? error.message : "连接失败",
        matchedConnections: [],
        totalConnections: 0,
        resourceRequests: []
      });
    } finally {
      if (!silent) {
        refreshButton.disabled = false;
      }
      endRefresh();
    }
  }

  async function switchBackend() {
    const backendId = backendSelect.value;
    if (!backendId || (currentConfig && backendId === currentConfig.activeBackendId)) {
      return;
    }

    if (previewMode) {
      return;
    }

    stateRequestId += 1;
    refreshButton.disabled = true;
    backendSelect.disabled = true;
    setStatus({
      status: "idle",
      message: "切换中"
    });

    try {
      const state = await extensionApi.runtime.sendMessage({
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
        totalConnections: 0,
        resourceRequests: []
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
    stateRequestId += 1;
    setStatus({
      status: "idle",
      message: "切换中"
    });

    try {
      if (previewMode) {
        currentConfig = {
          ...currentConfig,
          filterMode
        };
        render({
          ...localPreviewState(),
          filterMode
        });
      } else {
        const state = await extensionApi.runtime.sendMessage({
          type: "clashfox:switch-filter-mode",
          filterMode
        });
        await loadConfig();
        render(state);
      }
    } catch (error) {
      if (currentConfig) {
        renderFilterMode(currentConfig.filterMode);
      }
      render({
        status: "error",
        message: error && error.message ? error.message : "切换失败",
        matchedConnections: [],
        totalConnections: 0,
        resourceRequests: []
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
      if (previewMode) {
        currentConfig = {
          ...config,
          theme: nextTheme
        };
      } else {
        currentConfig = await ClashFox.saveConfig({
          ...config,
          theme: nextTheme
        });
      }
      ClashFox.applyTheme(currentConfig.theme);
      renderThemeButton(currentConfig.theme);
    } finally {
      themeButton.disabled = false;
    }
  }

  async function openOptionsPage() {
    if (!extensionApi || !extensionApi.runtime || !extensionApi.runtime.openOptionsPage) {
      return;
    }
    await extensionApi.runtime.openOptionsPage();
  }

  async function startAutoRefresh() {
    const config = await loadConfig();
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    if (!previewMode) {
      refreshTimer = setInterval(() => loadState("clashfox:refresh", {
        silent: true
      }), config.refreshSeconds * 1000);
    }
  }

  backendSelect.addEventListener("change", switchBackend);
  filterButtons.forEach((button) => button.addEventListener("click", switchFilterMode));
  themeButton.addEventListener("click", toggleTheme);
  refreshButton.addEventListener("click", () => loadState("clashfox:refresh"));
  if (optionsButton) {
    optionsButton.addEventListener("click", openOptionsPage);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadState("clashfox:refresh", {
        silent: true
      });
    }
  });

  renderStaticIcons();
  loadState("clashfox:refresh", {
    forceConfig: true
  });
  startAutoRefresh();
})();
