const els = {
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  deviceSummary: document.getElementById("deviceSummary"),
  connectionStatus: document.getElementById("connectionStatus"),
  serverValue: document.getElementById("serverValue"),
  deviceValue: document.getElementById("deviceValue"),
  lastConnectedValue: document.getElementById("lastConnectedValue"),
  lastDownloadValue: document.getElementById("lastDownloadValue"),
  errorLine: document.getElementById("errorLine"),
  ownerLoginForm: document.getElementById("ownerLoginForm"),
  ownerServerInput: document.getElementById("ownerServerInput"),
  ownerLoginInput: document.getElementById("ownerLoginInput"),
  ownerPasswordInput: document.getElementById("ownerPasswordInput"),
  bindForm: document.getElementById("bindForm"),
  bindServerInput: document.getElementById("bindServerInput"),
  bindCodeInput: document.getElementById("bindCodeInput"),
  bindDeviceNameInput: document.getElementById("bindDeviceNameInput"),
  serverInput: document.getElementById("serverInput"),
  deviceNameInput: document.getElementById("deviceNameInput"),
  downloadDirInput: document.getElementById("downloadDirInput"),
  autoReceiveInput: document.getElementById("autoReceiveInput"),
  copyInput: document.getElementById("copyInput"),
  notificationInput: document.getElementById("notificationInput"),
  startAtLoginInput: document.getElementById("startAtLoginInput"),
  tokenWarning: document.getElementById("tokenWarning"),
  watchForm: document.getElementById("watchForm"),
  watchDirInput: document.getElementById("watchDirInput"),
  chooseWatchDirButton: document.getElementById("chooseWatchDirButton"),
  openWatchDirButton: document.getElementById("openWatchDirButton"),
  addWatchExcludedDirButton: document.getElementById("addWatchExcludedDirButton"),
  watchExcludedDirList: document.getElementById("watchExcludedDirList"),
  autoUploadInput: document.getElementById("autoUploadInput"),
  watchStatusText: document.getElementById("watchStatusText"),
  watchStatusDot: document.getElementById("watchStatusDot"),
  watchErrorLine: document.getElementById("watchErrorLine"),
  watchEventList: document.getElementById("watchEventList"),
  connectButton: document.getElementById("connectButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  chooseDirButton: document.getElementById("chooseDirButton"),
  openDirButton: document.getElementById("openDirButton"),
  fetchPendingButton: document.getElementById("fetchPendingButton"),
  manualUploadButton: document.getElementById("manualUploadButton"),
  manualUploadResult: document.getElementById("manualUploadResult"),
  historyList: document.getElementById("historyList"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminServerInput: document.getElementById("adminServerInput"),
  adminLoginInput: document.getElementById("adminLoginInput"),
  adminPasswordInput: document.getElementById("adminPasswordInput"),
  adminLoginError: document.getElementById("adminLoginError"),
  adminLoginCard: document.getElementById("adminLoginCard"),
  refreshDevicesButton: document.getElementById("refreshDevicesButton"),
  adminLogoutButton: document.getElementById("adminLogoutButton"),
  adminDeviceList: document.getElementById("adminDeviceList"),
  themeToggle: document.getElementById("themeToggle"),
};

const STATUS_TEXT = {
  idle: "未连接",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  stopped: "已停止",
  error: "错误",
};

const PERMISSION_LABELS = {
  canAutoUpload: "自动上传",
  canManualUpload: "手动上传",
  canAutoReceive: "自动接收",
  canManualDownload: "手动下载",
  canManageSpace: "管理空间",
  canCreateInvite: "创建邀请",
};

const UPLOAD_SCOPES = [
  "screenshot_only",
  "selected_album",
  "manual_share_only",
  "all_images",
];

const RECEIVE_SCOPES = [
  "disabled",
  "all_authorized_sources",
  "same_user_only",
  "selected_devices",
];

const THEME_KEY = "studyshot.theme";
let currentState = null;

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function showError(message) {
  els.errorLine.textContent = message || "";
  els.errorLine.hidden = !message;
}

function showAdminError(message) {
  els.adminLoginError.textContent = message || "";
  els.adminLoginError.hidden = !message;
}

function showWatchError(message) {
  els.watchErrorLine.textContent = message || "";
  els.watchErrorLine.hidden = !message;
}

function applyTab(name) {
  els.navItems.forEach((n) => n.classList.toggle("active", n.dataset.tab === name));
  els.views.forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

function initTheme() {
  const stored = readStoredTheme();
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
  } else {
    applyTheme(null);
  }

  els.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = current ? current === "dark" : systemDark;
    const next = isDark ? "light" : "dark";
    applyTheme(next);
    storeTheme(next);
  });
}

function renderHistory(records) {
  els.historyList.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "本机还没有收到过图片。";
    els.historyList.append(empty);
    return;
  }
  for (const record of records) {
    const li = document.createElement("li");

    const main = document.createElement("div");
    const title = document.createElement("div");
    title.className = "record-title";
    title.textContent = `${record.sourceDeviceName || "未知设备"} · ${formatDate(record.receivedAt)}`;
    const meta = document.createElement("div");
    meta.className = "record-meta";
    meta.textContent = record.savedPath || record.error || "-";
    main.append(title, meta);

    const side = document.createElement("div");
    side.className = "record-side";

    const tag = document.createElement("span");
    if (record.status === "downloaded") {
      tag.className = "tag ok";
      tag.textContent = record.copiedToClipboard ? "完成 · 剪贴板" : "完成";
    } else if (record.status === "failed") {
      tag.className = "tag fail";
      tag.textContent = "失败";
    } else {
      tag.className = "tag";
      tag.textContent = "跳过";
    }
    side.append(tag);

    if (record.savedPath) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn small";
      copyBtn.textContent = "复制";
      copyBtn.addEventListener("click", async () => {
        try {
          await window.studyshot.copyHistoryToClipboard(record.deliveryId);
        } catch (err) {
          showError(err.message || String(err));
        }
      });
      side.append(copyBtn);

      const showBtn = document.createElement("button");
      showBtn.className = "btn small";
      showBtn.textContent = "定位";
      showBtn.addEventListener("click", async () => {
        try {
          await window.studyshot.showHistoryInFolder(record.deliveryId);
        } catch (err) {
          showError(err.message || String(err));
        }
      });
      side.append(showBtn);
    }

    li.append(main, side);
    els.historyList.append(li);
  }
}

function renderWatchEvents(events) {
  els.watchEventList.replaceChildren();
  if (!events || !events.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "还没有监听上传记录。在上方选择目录后启用监听,新图片会自动上传。";
    els.watchEventList.append(empty);
    return;
  }
  for (const ev of events) {
    const li = document.createElement("li");
    const main = document.createElement("div");
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = ev.fileName;
    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = ev.message ? `${formatTime(ev.uploadedAt)} · ${ev.message}` : formatTime(ev.uploadedAt);
    main.append(title, meta);

    const side = document.createElement("div");
    side.className = "event-side";
    const tag = document.createElement("span");
    tag.className = ev.ok ? "tag ok" : "tag fail";
    tag.textContent = ev.ok ? "已上传" : "失败";
    side.append(tag);
    li.append(main, side);
    els.watchEventList.append(li);
  }
}

function renderWatchExcludedDirs(excludedDirs) {
  els.watchExcludedDirList.replaceChildren();
  if (!excludedDirs.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "当前未排除子文件夹，监听目录内的图片都会上传。";
    els.watchExcludedDirList.append(empty);
    return;
  }

  for (const dir of excludedDirs) {
    const item = document.createElement("li");
    const pathLabel = document.createElement("code");
    pathLabel.textContent = dir;
    pathLabel.title = dir;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn small";
    removeButton.textContent = "取消排除";
    removeButton.addEventListener("click", async () => {
      try {
        const state = await window.studyshot.saveSettings({
          watchExcludedDirs: (currentState.settings.watchExcludedDirs || []).filter(
            (value) => value !== dir,
          ),
        });
        renderState(state);
      } catch (err) {
        showWatchError(err.message || String(err));
      }
    });
    item.append(pathLabel, removeButton);
    els.watchExcludedDirList.append(item);
  }
}

function renderAdminDevices(admin) {
  els.adminDeviceList.replaceChildren();
  els.refreshDevicesButton.disabled = !admin.isLoggedIn;
  els.adminLogoutButton.hidden = !admin.isLoggedIn;
  els.adminLoginCard.hidden = admin.isLoggedIn;

  if (!admin.isLoggedIn) {
    return;
  }

  if (!admin.devices.length) {
    const empty = document.createElement("div");
    empty.className = "device-card";
    empty.textContent = "本空间下还没有设备。";
    els.adminDeviceList.append(empty);
    return;
  }

  for (const device of admin.devices) {
    const card = document.createElement("article");
    card.className = "device-card";

    const head = document.createElement("div");
    head.className = "device-card-head";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "device-name";
    title.textContent = device.name;
    if (device.revokedAt) {
      const revokedTag = document.createElement("span");
      revokedTag.className = "revoked";
      revokedTag.textContent = "已撤销";
      title.append(revokedTag);
    }
    const sub = document.createElement("p");
    sub.className = "device-sub";
    sub.textContent = `${device.userDisplayName || device.userId} · ${device.platform || "?"} · ${device.id}`;
    titleWrap.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "device-actions";
    const revokeBtn = document.createElement("button");
    revokeBtn.className = "btn small danger";
    revokeBtn.textContent = "撤销";
    revokeBtn.disabled = Boolean(device.revokedAt);
    revokeBtn.addEventListener("click", async () => {
      if (!confirm(`确认撤销设备「${device.name}」?`)) return;
      try {
        const state = await window.studyshot.adminRevokeDevice(device.id);
        renderState(state);
      } catch (err) {
        showAdminError(err.message || String(err));
      }
    });
    actions.append(revokeBtn);
    head.append(titleWrap, actions);

    const rename = document.createElement("div");
    rename.className = "rename-row";
    const renameInput = document.createElement("input");
    renameInput.className = "input";
    renameInput.value = device.name;
    renameInput.disabled = Boolean(device.revokedAt);
    const renameBtn = document.createElement("button");
    renameBtn.className = "btn small";
    renameBtn.textContent = "保存名称";
    renameBtn.disabled = Boolean(device.revokedAt);
    renameBtn.addEventListener("click", async () => {
      try {
        const state = await window.studyshot.adminRenameDevice(device.id, renameInput.value);
        renderState(state);
      } catch (err) {
        showAdminError(err.message || String(err));
      }
    });
    rename.append(renameInput, renameBtn);

    const permGrid = document.createElement("div");
    permGrid.className = "permission-grid";
    for (const key of Object.keys(PERMISSION_LABELS)) {
      const item = document.createElement("label");
      item.className = "permission-item";
      const label = document.createElement("span");
      label.className = "permission-label";
      label.textContent = PERMISSION_LABELS[key];
      const select = document.createElement("select");
      select.className = "select";
      for (const v of ["true", "false"]) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v === "true" ? "允许" : "禁止";
        opt.selected = Boolean(device.permissions[key]) === (v === "true");
        select.append(opt);
      }
      select.disabled = Boolean(device.revokedAt);
      select.addEventListener("change", async () => {
        try {
          const state = await window.studyshot.adminUpdatePermissions(device.id, {
            [key]: select.value === "true",
          });
          renderState(state);
        } catch (err) {
          showAdminError(err.message || String(err));
          select.value = String(Boolean(device.permissions[key]));
        }
      });
      item.append(label, select);
      permGrid.append(item);
    }

    const uploadScopeItem = document.createElement("label");
    uploadScopeItem.className = "permission-item";
    const uploadScopeLabel = document.createElement("span");
    uploadScopeLabel.className = "permission-label";
    uploadScopeLabel.textContent = "上传范围";
    const uploadSelect = document.createElement("select");
    uploadSelect.className = "select";
    for (const v of UPLOAD_SCOPES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      opt.selected = device.permissions.autoUploadScope === v;
      uploadSelect.append(opt);
    }
    uploadSelect.disabled = Boolean(device.revokedAt);
    uploadSelect.addEventListener("change", async () => {
      try {
        const state = await window.studyshot.adminUpdatePermissions(device.id, {
          autoUploadScope: uploadSelect.value,
        });
        renderState(state);
      } catch (err) {
        showAdminError(err.message || String(err));
      }
    });
    uploadScopeItem.append(uploadScopeLabel, uploadSelect);

    const receiveScopeItem = document.createElement("label");
    receiveScopeItem.className = "permission-item";
    const receiveScopeLabel = document.createElement("span");
    receiveScopeLabel.className = "permission-label";
    receiveScopeLabel.textContent = "接收范围";
    const receiveSelect = document.createElement("select");
    receiveSelect.className = "select";
    for (const v of RECEIVE_SCOPES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      opt.selected = device.permissions.autoReceiveScope === v;
      receiveSelect.append(opt);
    }
    receiveSelect.disabled = Boolean(device.revokedAt);
    receiveSelect.addEventListener("change", async () => {
      try {
        const state = await window.studyshot.adminUpdatePermissions(device.id, {
          autoReceiveScope: receiveSelect.value,
        });
        renderState(state);
      } catch (err) {
        showAdminError(err.message || String(err));
      }
    });
    receiveScopeItem.append(receiveScopeLabel, receiveSelect);

    permGrid.append(uploadScopeItem, receiveScopeItem);

    card.append(head, rename, permGrid);
    els.adminDeviceList.append(card);
  }
}

function renderState(state) {
  currentState = state;
  const { settings, connection, watch } = state;
  const latest = state.recentDownloads[0];

  els.deviceSummary.textContent = settings.isBound
    ? `${settings.deviceName}${settings.deviceId ? " · " + settings.deviceId : ""}`
    : "未绑定";
  els.serverValue.textContent = settings.serverBaseUrl || "-";
  els.deviceValue.textContent = settings.isBound ? settings.deviceName : "-";
  els.lastConnectedValue.textContent = formatDate(connection.lastConnectedAt);
  els.lastDownloadValue.textContent = latest ? formatDate(latest.receivedAt) : "-";

  const status = connection.status || "idle";
  els.connectionStatus.textContent = STATUS_TEXT[status] || status;
  els.connectionStatus.dataset.status = status;
  showError(connection.lastError || "");

  els.bindServerInput.value = settings.serverBaseUrl || "";
  els.ownerServerInput.value = settings.serverBaseUrl || "";
  els.adminServerInput.value = settings.serverBaseUrl || "";
  els.bindDeviceNameInput.value = settings.deviceName || "";
  els.serverInput.value = settings.serverBaseUrl || "";
  els.deviceNameInput.value = settings.deviceName || "";
  els.downloadDirInput.value = settings.downloadDir || "";
  els.autoReceiveInput.checked = Boolean(settings.autoReceive);
  els.copyInput.checked = Boolean(settings.copyToClipboard);
  els.notificationInput.checked = Boolean(settings.showNotification);
  els.startAtLoginInput.checked = Boolean(settings.startAtLogin);
  els.tokenWarning.textContent = settings.tokenStorageWarning || "";
  els.tokenWarning.hidden = !settings.tokenStorageWarning;

  els.watchDirInput.value = settings.watchDir || "";
  renderWatchExcludedDirs(settings.watchExcludedDirs || []);
  els.autoUploadInput.checked = Boolean(settings.autoUpload);
  const watchActive = Boolean(watch && watch.active);
  const watchEnabled = Boolean(watch && watch.enabled);
  let statusLabel;
  if (!settings.watchDir) {
    statusLabel = "未配置目录";
    els.watchStatusDot.dataset.state = "off";
  } else if (!settings.isBound) {
    statusLabel = "等待设备绑定";
    els.watchStatusDot.dataset.state = "off";
  } else if (!settings.autoUpload) {
    statusLabel = "已暂停";
    els.watchStatusDot.dataset.state = "off";
  } else if (watchActive) {
    statusLabel = "运行中";
    els.watchStatusDot.dataset.state = "on";
  } else {
    statusLabel = "未启动";
    els.watchStatusDot.dataset.state = "off";
  }
  els.watchStatusText.textContent = watchEnabled && !watchActive
    ? `${statusLabel} · 设置已启用,将在条件满足时启动`
    : statusLabel;
  showWatchError(watch && watch.lastError ? watch.lastError : "");
  renderWatchEvents(watch && watch.recentUploads ? watch.recentUploads : []);

  els.connectButton.disabled =
    !settings.isBound || status === "connected" || status === "connecting";
  els.disconnectButton.disabled = status === "stopped" || status === "idle";
  els.fetchPendingButton.disabled = !settings.isBound;
  els.manualUploadButton.disabled = !settings.isBound;
  els.autoUploadInput.disabled = !settings.isBound || !settings.watchDir;

  renderHistory(state.recentDownloads);
  renderAdminDevices(state.admin);
}

async function loadState() {
  const state = await window.studyshot.getState();
  renderState(state);
}

els.navItems.forEach((button) => {
  button.addEventListener("click", () => applyTab(button.dataset.tab));
});

els.ownerLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = els.ownerLoginForm.querySelector("button[type='submit']");
  setBusy(submit, true);
  showError("");
  try {
    const result = await window.studyshot.createBindCodeWithLogin({
      serverBaseUrl: els.ownerServerInput.value,
      login: els.ownerLoginInput.value,
      password: els.ownerPasswordInput.value,
      deviceNameHint: els.bindDeviceNameInput.value,
    });
    els.bindServerInput.value = els.ownerServerInput.value;
    els.bindCodeInput.value = result.bindCode;
    els.ownerPasswordInput.value = "";
    await loadState();
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(submit, false);
  }
});

els.bindForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = els.bindForm.querySelector("button[type='submit']");
  setBusy(submit, true);
  showError("");
  try {
    const state = await window.studyshot.registerDevice({
      serverBaseUrl: els.bindServerInput.value,
      bindCode: els.bindCodeInput.value,
      deviceName: els.bindDeviceNameInput.value,
    });
    els.bindCodeInput.value = "";
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(submit, false);
  }
});

els.saveSettingsButton.addEventListener("click", async () => {
  setBusy(els.saveSettingsButton, true);
  showError("");
  try {
    const state = await window.studyshot.saveSettings({
      serverBaseUrl: els.serverInput.value,
      deviceName: els.deviceNameInput.value,
      downloadDir: els.downloadDirInput.value,
      autoReceive: els.autoReceiveInput.checked,
      copyToClipboard: els.copyInput.checked,
      showNotification: els.notificationInput.checked,
      startAtLogin: els.startAtLoginInput.checked,
    });
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(els.saveSettingsButton, false);
  }
});

els.chooseDirButton.addEventListener("click", async () => {
  const selected = await window.studyshot.chooseDownloadDir();
  if (selected) {
    els.downloadDirInput.value = selected;
  }
});

els.openDirButton.addEventListener("click", async () => {
  try {
    await window.studyshot.openDownloadDir();
  } catch (err) {
    showError(err.message || String(err));
  }
});

els.watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const state = await window.studyshot.saveSettings({
      watchDir: els.watchDirInput.value,
    });
    renderState(state);
  } catch (err) {
    showWatchError(err.message || String(err));
  }
});

els.chooseWatchDirButton.addEventListener("click", async () => {
  const selected = await window.studyshot.chooseWatchDir();
  if (selected) {
    els.watchDirInput.value = selected;
  }
});

els.openWatchDirButton.addEventListener("click", async () => {
  try {
    await window.studyshot.openWatchDir();
  } catch (err) {
    showWatchError(err.message || String(err));
  }
});

els.addWatchExcludedDirButton.addEventListener("click", async () => {
  try {
    const selected = await window.studyshot.chooseWatchExcludedDir();
    if (!selected) return;
    const excludedDirs = Array.from(
      new Set([...(currentState.settings.watchExcludedDirs || []), selected]),
    );
    const state = await window.studyshot.saveSettings({ watchExcludedDirs: excludedDirs });
    renderState(state);
  } catch (err) {
    showWatchError(err.message || String(err));
  }
});

els.autoUploadInput.addEventListener("change", async () => {
  try {
    const state = await window.studyshot.saveSettings({
      autoUpload: els.autoUploadInput.checked,
    });
    renderState(state);
  } catch (err) {
    showWatchError(err.message || String(err));
    els.autoUploadInput.checked = !els.autoUploadInput.checked;
  }
});

els.connectButton.addEventListener("click", async () => {
  try {
    const state = await window.studyshot.connect();
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  }
});

els.disconnectButton.addEventListener("click", async () => {
  try {
    const state = await window.studyshot.disconnect();
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  }
});

els.fetchPendingButton.addEventListener("click", async () => {
  setBusy(els.fetchPendingButton, true);
  showError("");
  try {
    const state = await window.studyshot.fetchPending();
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(els.fetchPendingButton, false);
  }
});

els.manualUploadButton.addEventListener("click", async () => {
  setBusy(els.manualUploadButton, true);
  showError("");
  els.manualUploadResult.hidden = true;
  els.manualUploadResult.textContent = "";
  try {
    const result = await window.studyshot.chooseAndUploadImage();
    if (!result) return;
    els.manualUploadResult.textContent = `${result.fileName} 上传成功,生成 ${result.createdDeliveriesCount} 个投递${result.deduplicated ? "(服务端判定为重复)" : ""}`;
    els.manualUploadResult.hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(els.manualUploadButton, false);
  }
});

els.adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = els.adminLoginForm.querySelector("button[type='submit']");
  setBusy(submit, true);
  showAdminError("");
  try {
    const state = await window.studyshot.adminLogin({
      serverBaseUrl: els.adminServerInput.value,
      login: els.adminLoginInput.value,
      password: els.adminPasswordInput.value,
    });
    els.adminPasswordInput.value = "";
    renderState(state);
  } catch (err) {
    showAdminError(err.message || String(err));
  } finally {
    setBusy(submit, false);
  }
});

els.refreshDevicesButton.addEventListener("click", async () => {
  setBusy(els.refreshDevicesButton, true);
  showAdminError("");
  try {
    const state = await window.studyshot.adminRefreshDevices();
    renderState(state);
  } catch (err) {
    showAdminError(err.message || String(err));
  } finally {
    setBusy(els.refreshDevicesButton, false);
  }
});

els.adminLogoutButton.addEventListener("click", async () => {
  try {
    const state = await window.studyshot.adminLogout();
    renderState(state);
  } catch (err) {
    showAdminError(err.message || String(err));
  }
});

initTheme();
window.studyshot.onStateChanged(renderState);
loadState().catch((err) => showError(err.message || String(err)));
