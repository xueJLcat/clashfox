(function () {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  const previewMode = !extensionApi || !extensionApi.storage;
  const form = document.getElementById("settingsForm");
  const backendList = document.getElementById("backendList");
  const backendName = document.getElementById("backendName");
  const controllerUrl = document.getElementById("controllerUrl");
  const secret = document.getElementById("secret");
  const refreshSeconds = document.getElementById("refreshSeconds");
  const themeInputs = Array.from(document.querySelectorAll('input[name="theme"]'));
  const matchStrategyInputs = Array.from(document.querySelectorAll('input[name="matchStrategy"]'));
  const matchStrategyHint = document.getElementById("matchStrategyHint");
  const addBackendButton = document.getElementById("addBackendButton");
  const deleteBackendButton = document.getElementById("deleteBackendButton");
  const setActiveButton = document.getElementById("setActiveButton");
  const testButton = document.getElementById("testButton");
  const message = document.getElementById("message");

  let backends = [];
  let selectedBackendId = "";
  let activeBackendId = "";
  let previewConfig = null;

  const MATCH_STRATEGY_HINTS = {
    strict: "严格模式：只接受精确 Host/IP，已知端口不一致时不关联。",
    smart: "智能模式：精确优先，必要时用主域名辅助判断。",
    loose: "宽松模式：允许更多同域名后缀归属，适合后端连接信息较少的场景。"
  };

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = kind || "";
  }

  function themeValue() {
    const checkedTheme = themeInputs.find((input) => input.checked);
    return ClashFox.normalizeTheme(checkedTheme ? checkedTheme.value : ClashFox.DEFAULT_CONFIG.theme);
  }

  function setThemeValue(theme) {
    const normalizedTheme = ClashFox.normalizeTheme(theme);
    themeInputs.forEach((input) => {
      input.checked = input.value === normalizedTheme;
    });
    ClashFox.applyTheme(normalizedTheme);
  }

  function matchStrategyValue() {
    const checkedStrategy = matchStrategyInputs.find((input) => input.checked);
    return ClashFox.normalizeMatchStrategy(checkedStrategy ? checkedStrategy.value : ClashFox.DEFAULT_CONFIG.matchStrategy);
  }

  function setMatchStrategyValue(strategy) {
    const normalizedStrategy = ClashFox.normalizeMatchStrategy(strategy);
    matchStrategyInputs.forEach((input) => {
      input.checked = input.value === normalizedStrategy;
    });
    matchStrategyHint.textContent = MATCH_STRATEGY_HINTS[normalizedStrategy] || MATCH_STRATEGY_HINTS.smart;
  }

  function selectedBackend() {
    return backends.find((backend) => backend.id === selectedBackendId) || backends[0];
  }

  function backendLabel(backend) {
    return backend.name || backend.controllerUrl || "mihomo";
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
      filterMode: "domain"
    };
  }

  function readBackendEditor() {
    const validation = ClashFox.validateControllerUrl(controllerUrl.value);

    if (validation.error) {
      throw new Error(validation.error);
    }

    return {
      id: selectedBackendId || ClashFox.generateBackendId(),
      name: backendName.value.trim() || validation.url,
      controllerUrl: validation.url,
      secret: secret.value.trim()
    };
  }

  function writeBackendEditor(backend) {
    backendName.value = backend ? backend.name : "";
    controllerUrl.value = backend ? backend.controllerUrl : "";
    secret.value = backend ? backend.secret : "";
  }

  function commitSelectedBackend() {
    const backend = selectedBackend();
    if (!backend) {
      return;
    }

    const editedBackend = readBackendEditor();
    backends = backends.map((item) => item.id === backend.id ? editedBackend : item);
    selectedBackendId = editedBackend.id;
  }

  function renderBackendList() {
    backendList.replaceChildren();

    backends.forEach((backend) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "backend-row";
      if (backend.id === selectedBackendId) {
        item.classList.add("selected");
      }
      if (backend.id === activeBackendId) {
        item.classList.add("active");
      }

      const name = document.createElement("span");
      name.className = "backend-row-name";
      name.textContent = backendLabel(backend);

      const url = document.createElement("span");
      url.className = "backend-row-url";
      url.textContent = backend.controllerUrl;

      const badge = document.createElement("span");
      badge.className = "backend-row-badge";
      badge.textContent = backend.id === activeBackendId ? "当前" : "";

      item.append(name, url, badge);
      item.addEventListener("click", () => {
        if (backend.id === selectedBackendId) {
          return;
        }

        try {
          commitSelectedBackend();
        } catch (error) {
          showMessage(error && error.message ? error.message : "后端设置无效", "error");
          return;
        }

        selectedBackendId = backend.id;
        writeBackendEditor(selectedBackend());
        renderBackendList();
        showMessage("", "");
      });

      backendList.append(item);
    });

    deleteBackendButton.disabled = backends.length <= 1;
    setActiveButton.disabled = selectedBackendId === activeBackendId;
  }

  function readForm() {
    commitSelectedBackend();

    if (backends.length === 0) {
      throw new Error("至少保留一个后端");
    }

    return {
      backends,
      activeBackendId: activeBackendId || backends[0].id,
      refreshSeconds: Math.max(1, Number(refreshSeconds.value) || ClashFox.DEFAULT_CONFIG.refreshSeconds),
      matchStrategy: matchStrategyValue(),
      theme: themeValue()
    };
  }

  async function load() {
    const config = previewMode ? (previewConfig || localPreviewConfig()) : await ClashFox.getConfig();
    previewConfig = config;
    backends = config.backends.map((backend) => ({
      ...backend
    }));
    selectedBackendId = config.activeBackendId;
    activeBackendId = config.activeBackendId;
    refreshSeconds.value = String(config.refreshSeconds);
    setMatchStrategyValue(config.matchStrategy);
    setThemeValue(config.theme);
    writeBackendEditor(selectedBackend());
    renderBackendList();
  }

  async function save(event) {
    event.preventDefault();

    let config;
    try {
      config = readForm();
    } catch (error) {
      showMessage(error && error.message ? error.message : "设置无效", "error");
      return;
    }

    const savedConfig = previewMode ? {
      ...config,
      includeSuffixMatches: config.matchStrategy !== "strict",
      activeBackend: backends.find((backend) => backend.id === config.activeBackendId) || backends[0]
    } : await ClashFox.saveConfig(config);
    previewConfig = savedConfig;
    backends = savedConfig.backends.map((backend) => ({
      ...backend
    }));
    selectedBackendId = savedConfig.activeBackendId;
    activeBackendId = savedConfig.activeBackendId;
    setThemeValue(savedConfig.theme);
    setMatchStrategyValue(savedConfig.matchStrategy);
    writeBackendEditor(selectedBackend());
    renderBackendList();

    try {
      if (!previewMode && extensionApi.runtime) {
        await extensionApi.runtime.sendMessage({
          type: "clashfox:config-updated"
        });
      }
    } catch (error) {
      // The background page may be restarting; storage is already updated.
    }
    showMessage("已保存", "success");
  }

  async function testConnection() {
    testButton.disabled = true;
    showMessage("测试中...", "");

    try {
      if (previewMode) {
        readBackendEditor();
        showMessage("连接成功，当前 128 条连接", "success");
      } else {
        const data = await ClashFox.fetchConnections(readBackendEditor());
        showMessage(`连接成功，当前 ${data.connections.length} 条连接`, "success");
      }
    } catch (error) {
      showMessage(error && error.message ? error.message : "连接失败", "error");
    } finally {
      testButton.disabled = false;
    }
  }

  function addBackend() {
    try {
      commitSelectedBackend();
    } catch (error) {
      showMessage(error && error.message ? error.message : "后端设置无效", "error");
      return;
    }

    const backend = {
      id: ClashFox.generateBackendId(),
      name: "新后端",
      controllerUrl: ClashFox.DEFAULT_CONFIG.controllerUrl,
      secret: ""
    };

    backends.push(backend);
    selectedBackendId = backend.id;
    writeBackendEditor(backend);
    renderBackendList();
    backendName.focus();
    backendName.select();
    showMessage("已新增后端，保存后生效", "");
  }

  function deleteBackend() {
    if (backends.length <= 1) {
      showMessage("至少保留一个后端", "error");
      return;
    }

    const deletingActiveBackend = selectedBackendId === activeBackendId;
    backends = backends.filter((backend) => backend.id !== selectedBackendId);
    selectedBackendId = backends[0].id;

    if (deletingActiveBackend) {
      activeBackendId = selectedBackendId;
    }

    writeBackendEditor(selectedBackend());
    renderBackendList();
    showMessage("已删除后端，保存后生效", "");
  }

  function setActiveBackend() {
    try {
      commitSelectedBackend();
    } catch (error) {
      showMessage(error && error.message ? error.message : "后端设置无效", "error");
      return;
    }

    activeBackendId = selectedBackendId;
    renderBackendList();
    showMessage("已设为当前，保存后生效", "");
  }

  async function saveTheme() {
    const theme = themeValue();
    ClashFox.applyTheme(theme);

    try {
      if (previewMode) {
        previewConfig = {
          ...(previewConfig || localPreviewConfig()),
          theme
        };
      } else {
        const config = await ClashFox.getConfig();
        await ClashFox.saveConfig({
          ...config,
          theme
        });
      }
      showMessage("主题已保存", "success");
    } catch (error) {
      showMessage(error && error.message ? error.message : "主题保存失败", "error");
    }
  }

  form.addEventListener("submit", save);
  testButton.addEventListener("click", testConnection);
  addBackendButton.addEventListener("click", addBackend);
  deleteBackendButton.addEventListener("click", deleteBackend);
  setActiveButton.addEventListener("click", setActiveBackend);
  themeInputs.forEach((input) => input.addEventListener("change", saveTheme));
  matchStrategyInputs.forEach((input) => input.addEventListener("change", () => {
    setMatchStrategyValue(input.value);
  }));

  load();
})();
