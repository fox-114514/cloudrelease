const els = {
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  deviceSummary: document.getElementById("deviceSummary"),
  connectionStatus: document.getElementById("connectionStatus"),
  serverValue: document.getElementById("serverValue"),
  deviceValue: document.getElementById("deviceValue"),
  lastConnectedValue: document.getElementById("lastConnectedValue"),
  lastDownloadValue: document.getElementById("lastDownloadValue"),
  identityCard: document.getElementById("identityCard"),
  boundUserValue: document.getElementById("boundUserValue"),
  profileValue: document.getElementById("profileValue"),
  effectivePermissionsValue: document.getElementById("effectivePermissionsValue"),
  errorLine: document.getElementById("errorLine"),
  ownerLoginForm: document.getElementById("ownerLoginForm"),
  ownerServerInput: document.getElementById("ownerServerInput"),
  ownerLoginInput: document.getElementById("ownerLoginInput"),
  ownerPasswordInput: document.getElementById("ownerPasswordInput"),
  bindForm: document.getElementById("bindForm"),
  bindServerInput: document.getElementById("bindServerInput"),
  bindCodeInput: document.getElementById("bindCodeInput"),
  bindDeviceNameInput: document.getElementById("bindDeviceNameInput"),
  bindProfileInput: document.getElementById("bindProfileInput"),
  loginProfileInput: document.getElementById("loginProfileInput"),
  serverInput: document.getElementById("serverInput"),
  deviceNameInput: document.getElementById("deviceNameInput"),
  downloadDirInput: document.getElementById("downloadDirInput"),
  autoReceiveInput: document.getElementById("autoReceiveInput"),
  copyInput: document.getElementById("copyInput"),
  notificationInput: document.getElementById("notificationInput"),
  startAtLoginInput: document.getElementById("startAtLoginInput"),
  tokenWarning: document.getElementById("tokenWarning"),
  allowInsecureHttpInput: document.getElementById("allowInsecureHttpInput"),
  insecureHttpBanner: document.getElementById("insecureHttpBanner"),
  httpConfirmationBanner: document.getElementById("httpConfirmationBanner"),
  httpConfirmContinueBtn: document.getElementById("httpConfirmContinueBtn"),
  httpConfirmDismissBtn: document.getElementById("httpConfirmDismissBtn"),
  bindAllowInsecureHttpInput: document.getElementById("bindAllowInsecureHttpInput"),
  ownerAllowInsecureHttpInput: document.getElementById("ownerAllowInsecureHttpInput"),
  adminAllowInsecureHttpInput: document.getElementById("adminAllowInsecureHttpInput"),
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
  clearWatchRecordsButton: document.getElementById("clearWatchRecordsButton"),
  connectButton: document.getElementById("connectButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  chooseDirButton: document.getElementById("chooseDirButton"),
  openDirButton: document.getElementById("openDirButton"),
  fetchPendingButton: document.getElementById("fetchPendingButton"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  pendingPrompt: document.getElementById("pendingPrompt"),
  pendingPromptText: document.getElementById("pendingPromptText"),
  acceptPendingButton: document.getElementById("acceptPendingButton"),
  skipPendingButton: document.getElementById("skipPendingButton"),
  manualUploadButton: document.getElementById("manualUploadButton"),
  manualUploadResult: document.getElementById("manualUploadResult"),
  historyList: document.getElementById("historyList"),
  libraryList: document.getElementById("libraryList"),
  libraryError: document.getElementById("libraryError"),
  refreshLibraryButton: document.getElementById("refreshLibraryButton"),
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

let httpConfirmationDismissed = false;

const PROFILE_LABELS = {
  manual_only: "只手动分享",
  upload_only: "只上传截图",
  receive_own: "只接收我的图片",
  sync_own: "我的设备双向同步",
  custom: "自定义(高级)",
};

const RECEIVE_SCOPE_LABELS = {
  disabled: "不接收",
  same_user_only: "仅接收我的设备",
  selected_devices: "接收指定设备",
  all_authorized_sources: "接收空间全部设备",
};

const THEME_KEY = "studyshot.theme";
let currentState = null;
let libraryImages = [];

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
  if (name === "library") loadLibrary();
}

function showLibraryError(message) {
  els.libraryError.textContent = message || "";
  els.libraryError.hidden = !message;
}

function renderLibrary() {
  els.libraryList.replaceChildren();
  if (!libraryImages.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "当前没有可下载的有效图片。";
    els.libraryList.append(empty);
    return;
  }
  for (const image of libraryImages) {
    const row = document.createElement("li");
    row.className = "record-item";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${image.uploadedBy.deviceName} · ${formatDate(image.createdAt)}`;
    const meta = document.createElement("p");
    meta.className = "record-meta";
    meta.textContent = `${image.uploadedBy.userDisplayName} · ${(image.fileSize / 1024).toFixed(1)} KB · ${image.mimeType}`;
    details.append(title, meta);
    const button = document.createElement("button");
    button.className = "btn primary";
    button.type = "button";
    button.textContent = "下载";
    button.addEventListener("click", async () => {
      setBusy(button, true);
      showLibraryError("");
      try {
        const result = await window.studyshot.downloadLibraryImage(image);
        button.textContent = result.copiedToClipboard ? "已下载并复制" : "已下载";
      } catch (err) {
        showLibraryError(err.message || String(err));
      } finally {
        setBusy(button, false);
      }
    });
    row.append(details, button);
    els.libraryList.append(row);
  }
}

async function loadLibrary() {
  setBusy(els.refreshLibraryButton, true);
  showLibraryError("");
  try {
    const page = await window.studyshot.listLibraryImages();
    libraryImages = page.images || [];
    renderLibrary();
  } catch (err) {
    libraryImages = [];
    renderLibrary();
    showLibraryError(err.message || String(err));
  } finally {
    setBusy(els.refreshLibraryButton, false);
  }
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

    const hideBtn = document.createElement("button");
    hideBtn.className = "btn small";
    hideBtn.textContent = "隐藏";
    hideBtn.addEventListener("click", async () => {
      try {
        await window.studyshot.hideHistory(record.deliveryId);
      } catch (err) {
        showError(err.message || String(err));
      }
    });
    side.append(hideBtn);

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
    const hideBtn = document.createElement("button");
    hideBtn.className = "btn small";
    hideBtn.textContent = "隐藏";
    hideBtn.addEventListener("click", async () => {
      renderState(await window.studyshot.hideWatchUpload(ev.uploadedAt));
    });
    side.append(hideBtn);
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

  const isOwner = admin.user && admin.user.role === "owner";
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

    const profileItem = document.createElement("label");
    profileItem.className = "permission-item";
    const profileLabel = document.createElement("span");
    profileLabel.className = "permission-label";
    profileLabel.textContent = "安全用途预设";
    const profileSelect = document.createElement("select");
    profileSelect.className = "select";
    for (const value of ["manual_only", "upload_only", "receive_own", "sync_own"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = PROFILE_LABELS[value];
      option.selected = device.profile === value;
      profileSelect.append(option);
    }
    if (device.profile === "custom") {
      const option = document.createElement("option");
      option.value = "custom";
      option.textContent = PROFILE_LABELS.custom;
      option.selected = true;
      option.disabled = true;
      profileSelect.prepend(option);
    }
    profileSelect.disabled = Boolean(device.revokedAt);
    profileSelect.addEventListener("change", async () => {
      try {
        const state = await window.studyshot.adminUpdateProfile(device.id, profileSelect.value);
        renderState(state);
      } catch (err) {
        showAdminError(err.message || String(err));
        renderState(currentState);
      }
    });
    profileItem.append(profileLabel, profileSelect);

    const permGrid = document.createElement("div");
    permGrid.className = "permission-grid";
    permGrid.append(profileItem);
    const editablePermissionKeys = isOwner
      ? Object.keys(PERMISSION_LABELS)
      : ["canManualUpload", "canManualDownload"];
    for (const key of editablePermissionKeys) {
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
    for (const v of RECEIVE_SCOPES.filter((scope) => isOwner || scope !== "all_authorized_sources")) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = RECEIVE_SCOPE_LABELS[v];
      opt.selected = device.permissions.autoReceiveScope === v;
      receiveSelect.append(opt);
    }
    receiveSelect.disabled = Boolean(device.revokedAt);
    receiveScopeItem.append(receiveScopeLabel, receiveSelect);

    if (isOwner) permGrid.append(uploadScopeItem);

    const sourceList = document.createElement("div");
    sourceList.className = "permission-grid";
    const selectedSources = new Set(device.receiveSourceDeviceIds || []);
    const sourceCandidates = admin.devices.filter((candidate) =>
      candidate.id !== device.id && !candidate.revokedAt && (isOwner || candidate.userId === device.userId)
    );
    const renderSources = () => {
      sourceList.replaceChildren();
      sourceList.hidden = receiveSelect.value !== "selected_devices";
      if (sourceList.hidden) return;
      if (!sourceCandidates.length) {
        sourceList.textContent = "没有可用的来源设备。";
        return;
      }
      for (const source of sourceCandidates) {
        const label = document.createElement("label");
        label.className = "permission-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedSources.has(source.id);
        checkbox.disabled = Boolean(device.revokedAt);
        const text = document.createElement("span");
        text.textContent = source.userId === device.userId
          ? source.name
          : `${source.name} (${source.userDisplayName || source.userId})`;
        checkbox.addEventListener("change", async () => {
          checkbox.checked ? selectedSources.add(source.id) : selectedSources.delete(source.id);
          if (!selectedSources.size) {
            showAdminError("至少保留一个来源设备；如需停止接收，请选择“不接收”。");
            checkbox.checked = true;
            selectedSources.add(source.id);
            return;
          }
          try {
            const state = await window.studyshot.adminUpdateReceiveConfig(
              device.id,
              "selected_devices",
              Array.from(selectedSources),
            );
            renderState(state);
          } catch (err) {
            showAdminError(err.message || String(err));
            renderState(currentState);
          }
        });
        label.append(checkbox, text);
        sourceList.append(label);
      }
    };

    receiveSelect.addEventListener("change", async () => {
      if (receiveSelect.value === "selected_devices" && !selectedSources.size) {
        renderSources();
        showAdminError("请先选择至少一个来源设备，勾选后会立即保存。");
        return;
      }
      if (
        receiveSelect.value === "all_authorized_sources" &&
        !confirm("此设置会接收其他成员上传的图片，确认继续吗？")
      ) {
        renderState(currentState);
        return;
      }
      try {
        const state = await window.studyshot.adminUpdateReceiveConfig(
          device.id,
          receiveSelect.value,
          receiveSelect.value === "selected_devices" ? Array.from(selectedSources) : [],
        );
        renderState(state);
      } catch (err) {
        showAdminError(err.message || String(err));
        renderState(currentState);
      }
    });
    permGrid.append(receiveScopeItem);
    renderSources();

    card.append(head, rename, permGrid, sourceList);
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
  els.identityCard.hidden = !settings.isBound;
  if (settings.isBound) {
    const user = settings.boundUser;
    const role = user && user.role === "owner" ? "空间管理员" : "成员";
    els.boundUserValue.textContent = user
      ? `${user.displayName || user.id} · ${role}`
      : "等待从服务器刷新身份";
    els.profileValue.textContent = PROFILE_LABELS[settings.lastKnownProfile] || settings.lastKnownProfile || "-";
    const permissions = settings.lastKnownPermissions;
    els.effectivePermissionsValue.textContent = permissions
      ? [
          permissions.canAutoUpload ? "自动上传" : null,
          permissions.canManualUpload ? "手动上传" : null,
          permissions.canAutoReceive ? "自动接收" : null,
          permissions.canManualDownload ? "手动下载" : null,
        ].filter(Boolean).join("、") || "无运行权限"
      : "尚未同步";
  }

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

  // Reflect the stored allowInsecureHttp flag and surface a persistent banner
  // whenever the stored URL is a non-loopback http:// address. Bind/admin
  // forms default their per-form checkbox to this saved value so a user
  // rebinding to the same server doesn't have to re-check the box each time.
  const allowInsecureHttp = settings.allowInsecureHttp === true;
  if (els.allowInsecureHttpInput) {
    els.allowInsecureHttpInput.checked = allowInsecureHttp;
  }
  if (els.bindAllowInsecureHttpInput) {
    els.bindAllowInsecureHttpInput.checked = allowInsecureHttp;
  }
  if (els.ownerAllowInsecureHttpInput) {
    els.ownerAllowInsecureHttpInput.checked = allowInsecureHttp;
  }
  if (els.adminAllowInsecureHttpInput) {
    els.adminAllowInsecureHttpInput.checked = allowInsecureHttp;
  }
  if (els.insecureHttpBanner) {
    els.insecureHttpBanner.textContent = settings.insecureHttpWarning || "";
    els.insecureHttpBanner.hidden = !settings.insecureHttpWarning;
  }

  // R0-2: gate all token-bearing activity until the user explicitly
  // confirms plaintext HTTP for a migrated 0.5.0 config. Guard on both
  // the pending flag and the computed warning so a stale renderer state
  // cannot keep this banner visible after switching to HTTPS.
  if (els.httpConfirmationBanner) {
    const httpConfirmationActive = Boolean(settings.httpConfirmationPending && settings.insecureHttpWarning);
    if (!httpConfirmationActive) {
      httpConfirmationDismissed = false;
    }
    els.httpConfirmationBanner.hidden = !httpConfirmationActive || httpConfirmationDismissed;
  }

  els.watchDirInput.value = settings.watchDir || "";
  renderWatchExcludedDirs(settings.watchExcludedDirs || []);
  els.autoUploadInput.checked = Boolean(settings.autoUpload);
  const permissions = settings.lastKnownPermissions;
  const watchActive = Boolean(watch && watch.active);
  const watchEnabled = Boolean(watch && watch.enabled);
  let statusLabel;
  if (!settings.watchDir) {
    statusLabel = "未配置目录";
    els.watchStatusDot.dataset.state = "off";
  } else if (!settings.isBound) {
    statusLabel = "等待设备绑定";
    els.watchStatusDot.dataset.state = "off";
  } else if (permissions && !permissions.canAutoUpload) {
    statusLabel = "服务端未允许自动上传";
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
    !settings.isBound || permissions?.canAutoReceive === false || status === "connected" || status === "connecting";
  els.disconnectButton.disabled = status === "stopped" || status === "idle";
  els.fetchPendingButton.disabled = !settings.isBound || permissions?.canAutoReceive === false;
  els.manualUploadButton.disabled = !settings.isBound || permissions?.canManualUpload === false;
  els.autoReceiveInput.disabled = !settings.isBound || permissions?.canAutoReceive === false;
  els.autoUploadInput.disabled = !settings.isBound || !settings.watchDir || permissions?.canAutoUpload === false;

  renderHistory(state.recentDownloads);
  els.pendingPrompt.hidden = !(state.pendingOfflineCount > 0);
  els.pendingPromptText.textContent = `设备离线期间收到 ${state.pendingOfflineCount || 0} 张图片，是否现在接收？`;
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
    await window.studyshot.bindWithLogin({
      serverBaseUrl: els.ownerServerInput.value,
      login: els.ownerLoginInput.value,
      password: els.ownerPasswordInput.value,
      deviceNameHint: els.bindDeviceNameInput.value,
      profile: els.loginProfileInput.value,
      allowInsecureHttp: els.ownerAllowInsecureHttpInput.checked,
    });
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
    const preview = await window.studyshot.previewBindCode(
      els.bindServerInput.value,
      els.bindCodeInput.value,
      els.bindAllowInsecureHttpInput.checked,
    );
    const target = preview.targetUser.displayName || preview.targetUser.id;
    const role = preview.targetUser.role === "owner" ? "空间管理员" : "成员";
    if (!confirm(`绑定目标：${target}（${role}）\n空间：${preview.space.displayName}\n确认绑定到这个成员吗？`)) {
      return;
    }
    const state = await window.studyshot.registerDevice({
      serverBaseUrl: els.bindServerInput.value,
      bindCode: els.bindCodeInput.value,
      deviceName: els.bindDeviceNameInput.value,
      profile: els.bindProfileInput.value,
      allowInsecureHttp: els.bindAllowInsecureHttpInput.checked,
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
      allowInsecureHttp: els.allowInsecureHttpInput.checked,
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
    try {
      // Selecting a directory is itself an explicit user action. Persist it
      // immediately so an asynchronous state refresh cannot restore the old
      // default path before the separate Save button is clicked.
      renderState(await window.studyshot.saveSettings({ downloadDir: selected }));
    } catch (err) {
      showError(err.message || String(err));
    }
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
  if (!selected) return;
  try {
    // Persist immediately so an asynchronous state refresh cannot restore the
    // old watchDir input value before the user clicks "保存" on the form.
    // This mirrors how the download-dir chooser behaves and stops the
    // "watchDir reverted after selection" symptom from iteration 0.5.1.
    els.watchDirInput.value = selected;
    const state = await window.studyshot.saveSettings({ watchDir: selected });
    renderState(state);
  } catch (err) {
    showWatchError(err.message || String(err));
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

els.acceptPendingButton.addEventListener("click", async () => {
  setBusy(els.acceptPendingButton, true);
  try {
    renderState(await window.studyshot.fetchPending());
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(els.acceptPendingButton, false);
  }
});

els.skipPendingButton.addEventListener("click", async () => {
  setBusy(els.skipPendingButton, true);
  try {
    renderState(await window.studyshot.skipPending());
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(els.skipPendingButton, false);
  }
});

els.clearHistoryButton.addEventListener("click", async () => {
  try {
    renderState(await window.studyshot.clearHistory());
  } catch (err) {
    showError(err.message || String(err));
  }
});

els.refreshLibraryButton.addEventListener("click", loadLibrary);

els.clearWatchRecordsButton.addEventListener("click", async () => {
  try {
    renderState(await window.studyshot.clearWatchUploads());
  } catch (err) {
    showWatchError(err.message || String(err));
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
      allowInsecureHttp: els.adminAllowInsecureHttpInput.checked,
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

// R0-2: confirm/dimiss the migrated plaintext-HTTP config. Confirming
// persists allowInsecureHttp=true which clears httpConfirmationPending and
// lets the main process connect + start the watcher. Dismissing keeps the
// config bound but blocks token-bearing requests until the user changes
// the URL to https:// or comes back to confirm.
if (els.httpConfirmContinueBtn) {
  els.httpConfirmContinueBtn.addEventListener("click", async () => {
    try {
      const state = await window.studyshot.saveSettings({ allowInsecureHttp: true });
      renderState(state);
    } catch (err) {
      showError(err.message || String(err));
    }
  });
}
if (els.httpConfirmDismissBtn) {
  els.httpConfirmDismissBtn.addEventListener("click", () => {
    httpConfirmationDismissed = true;
    if (els.httpConfirmationBanner) els.httpConfirmationBanner.hidden = true;
  });
}

initTheme();
window.studyshot.onStateChanged(renderState);
loadState().catch((err) => showError(err.message || String(err)));
