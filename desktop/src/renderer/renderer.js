const els = {
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
  settingsForm: document.getElementById("settingsForm"),
  serverInput: document.getElementById("serverInput"),
  deviceNameInput: document.getElementById("deviceNameInput"),
  downloadDirInput: document.getElementById("downloadDirInput"),
  autoReceiveInput: document.getElementById("autoReceiveInput"),
  copyInput: document.getElementById("copyInput"),
  notificationInput: document.getElementById("notificationInput"),
  startAtLoginInput: document.getElementById("startAtLoginInput"),
  tokenWarning: document.getElementById("tokenWarning"),
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
  refreshDevicesButton: document.getElementById("refreshDevicesButton"),
  adminLogoutButton: document.getElementById("adminLogoutButton"),
  adminDeviceList: document.getElementById("adminDeviceList"),
};

const statusText = {
  idle: "未连接",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  stopped: "已停止",
  error: "错误",
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function showError(message) {
  els.errorLine.textContent = message;
  els.errorLine.hidden = !message;
}

function renderHistory(records) {
  els.historyList.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无记录";
    els.historyList.append(empty);
    return;
  }

  for (const record of records) {
    const item = document.createElement("article");
    item.className = "history-item";

    const main = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${record.sourceDeviceName || "未知设备"} · ${formatDate(record.receivedAt)}`;
    const pathLine = document.createElement("p");
    pathLine.textContent = record.savedPath || record.error || "-";
    const clipLine = document.createElement("p");
    clipLine.textContent = record.clipboardError
      ? `剪贴板：${record.clipboardError}`
      : record.copiedToClipboard
        ? "剪贴板：已复制"
        : "剪贴板：未复制";
    main.append(title, pathLine, clipLine);

    const side = document.createElement("div");
    side.className = "history-actions";
    const state = document.createElement("div");
    state.className = `history-state ${record.status === "failed" ? "failed" : ""}`;
    state.textContent = record.status === "downloaded" ? "完成" : record.status === "failed" ? "失败" : "跳过";
    side.append(state);

    if (record.savedPath) {
      const copyButton = document.createElement("button");
      copyButton.className = "secondary compact-button";
      copyButton.textContent = "复制";
      copyButton.addEventListener("click", async () => {
        try {
          await window.studyshot.copyHistoryToClipboard(record.deliveryId);
        } catch (err) {
          showError(err.message || String(err));
        }
      });

      const showButton = document.createElement("button");
      showButton.className = "secondary compact-button";
      showButton.textContent = "定位";
      showButton.addEventListener("click", async () => {
        try {
          await window.studyshot.showHistoryInFolder(record.deliveryId);
        } catch (err) {
          showError(err.message || String(err));
        }
      });

      side.append(copyButton, showButton);
    }

    item.append(main, side);
    els.historyList.append(item);
  }
}

function permissionLabel(key) {
  return {
    canAutoUpload: "自动上传",
    canManualUpload: "手动上传",
    canAutoReceive: "自动接收",
    canManualDownload: "手动下载",
    canManageSpace: "管理空间",
    canCreateInvite: "创建邀请",
  }[key];
}

function renderAdminDevices(admin) {
  els.adminDeviceList.replaceChildren();

  els.refreshDevicesButton.disabled = !admin.isLoggedIn;
  els.adminLogoutButton.disabled = !admin.isLoggedIn;

  if (!admin.isLoggedIn) {
    const empty = document.createElement("div");
    empty.className = "device-empty";
    empty.textContent = "请先登录管理会话";
    els.adminDeviceList.append(empty);
    return;
  }

  if (!admin.devices.length) {
    const empty = document.createElement("div");
    empty.className = "device-empty";
    empty.textContent = "暂无设备";
    els.adminDeviceList.append(empty);
    return;
  }

  for (const device of admin.devices) {
    const item = document.createElement("article");
    item.className = "device-item";

    const head = document.createElement("div");
    head.className = "device-head";
    const titleWrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${device.name} · ${device.platform}`;
    const meta = document.createElement("p");
    meta.textContent = `${device.userDisplayName || device.userId} · ${device.revokedAt ? "已撤销" : "有效"} · ${device.id}`;
    const renameRow = document.createElement("div");
    renameRow.className = "rename-row";
    const renameInput = document.createElement("input");
    renameInput.value = device.name;
    renameInput.disabled = Boolean(device.revokedAt);
    const renameButton = document.createElement("button");
    renameButton.className = "secondary compact-button";
    renameButton.textContent = "保存名称";
    renameButton.disabled = Boolean(device.revokedAt);
    renameButton.addEventListener("click", async () => {
      try {
        const state = await window.studyshot.adminRenameDevice(device.id, renameInput.value);
        renderState(state);
      } catch (err) {
        showError(err.message || String(err));
      }
    });
    renameRow.append(renameInput, renameButton);
    titleWrap.append(title, meta, renameRow);

    const revokeButton = document.createElement("button");
    revokeButton.className = "secondary compact-button";
    revokeButton.textContent = "撤销";
    revokeButton.disabled = Boolean(device.revokedAt);
    revokeButton.addEventListener("click", async () => {
      if (!confirm(`确认撤销设备「${device.name}」？`)) return;
      try {
        const state = await window.studyshot.adminRevokeDevice(device.id);
        renderState(state);
      } catch (err) {
        showError(err.message || String(err));
      }
    });
    head.append(titleWrap, revokeButton);

    const grid = document.createElement("div");
    grid.className = "permission-grid";
    const permissionKeys = [
      "canAutoUpload",
      "canManualUpload",
      "canAutoReceive",
      "canManualDownload",
      "canManageSpace",
      "canCreateInvite",
    ];

    for (const key of permissionKeys) {
      const label = document.createElement("label");
      label.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(device.permissions[key]);
      input.disabled = Boolean(device.revokedAt);
      input.addEventListener("change", async () => {
        try {
          const state = await window.studyshot.adminUpdatePermissions(device.id, {
            [key]: input.checked,
          });
          renderState(state);
        } catch (err) {
          showError(err.message || String(err));
          input.checked = !input.checked;
        }
      });
      const span = document.createElement("span");
      span.textContent = permissionLabel(key);
      label.append(input, span);
      grid.append(label);
    }

    const uploadScope = document.createElement("label");
    uploadScope.className = "permission-select";
    uploadScope.innerHTML = `<span>上传范围</span>`;
    const uploadSelect = document.createElement("select");
    for (const value of ["screenshot_only", "selected_album", "manual_share_only", "all_images"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = device.permissions.autoUploadScope === value;
      uploadSelect.append(option);
    }
    uploadSelect.disabled = Boolean(device.revokedAt);
    uploadSelect.addEventListener("change", async () => {
      try {
        const state = await window.studyshot.adminUpdatePermissions(device.id, {
          autoUploadScope: uploadSelect.value,
        });
        renderState(state);
      } catch (err) {
        showError(err.message || String(err));
      }
    });
    uploadScope.append(uploadSelect);

    const receiveScope = document.createElement("label");
    receiveScope.className = "permission-select";
    receiveScope.innerHTML = `<span>接收范围</span>`;
    const receiveSelect = document.createElement("select");
    for (const value of ["disabled", "all_authorized_sources", "same_user_only", "selected_devices"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = device.permissions.autoReceiveScope === value;
      receiveSelect.append(option);
    }
    receiveSelect.disabled = Boolean(device.revokedAt);
    receiveSelect.addEventListener("change", async () => {
      try {
        const state = await window.studyshot.adminUpdatePermissions(device.id, {
          autoReceiveScope: receiveSelect.value,
        });
        renderState(state);
      } catch (err) {
        showError(err.message || String(err));
      }
    });
    receiveScope.append(receiveSelect);
    grid.append(uploadScope, receiveScope);

    item.append(head, grid);
    els.adminDeviceList.append(item);
  }
}

function renderState(state) {
  const settings = state.settings;
  const connection = state.connection;
  const latest = state.recentDownloads[0];

  els.deviceSummary.textContent = settings.isBound
    ? `${settings.deviceName} · ${settings.deviceId || ""}`
    : "未绑定";
  els.serverValue.textContent = settings.serverBaseUrl || "-";
  els.deviceValue.textContent = settings.isBound ? settings.deviceName : "-";
  els.lastConnectedValue.textContent = formatDate(connection.lastConnectedAt);
  els.lastDownloadValue.textContent = latest ? formatDate(latest.receivedAt) : "-";

  els.connectionStatus.textContent = statusText[connection.status] || connection.status;
  els.connectionStatus.className = `status-pill ${connection.status}`;
  showError(connection.lastError || "");

  els.bindServerInput.value = settings.serverBaseUrl || "";
  els.ownerServerInput.value = settings.serverBaseUrl || "";
  els.adminServerInput.value = settings.serverBaseUrl || "";
  els.bindDeviceNameInput.value = settings.deviceName || "";
  els.serverInput.value = settings.serverBaseUrl || "";
  els.deviceNameInput.value = settings.deviceName || "";
  els.downloadDirInput.value = settings.downloadDir || "";
  els.autoReceiveInput.checked = settings.autoReceive;
  els.copyInput.checked = settings.copyToClipboard;
  els.notificationInput.checked = settings.showNotification;
  els.startAtLoginInput.checked = settings.startAtLogin;

  els.tokenWarning.textContent = settings.tokenStorageWarning || "";
  els.tokenWarning.hidden = !settings.tokenStorageWarning;

  els.connectButton.disabled = !settings.isBound || connection.status === "connected" || connection.status === "connecting";
  els.disconnectButton.disabled = connection.status === "stopped" || connection.status === "idle";
  els.fetchPendingButton.disabled = !settings.isBound;
  els.manualUploadButton.disabled = !settings.isBound;

  renderHistory(state.recentDownloads);
  renderAdminDevices(state.admin);
}

async function loadState() {
  const state = await window.studyshot.getState();
  renderState(state);
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(`view-${button.dataset.tab}`).classList.add("active");
  });
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
    els.manualUploadResult.textContent = `${result.fileName} 上传成功，生成 ${result.createdDeliveriesCount} 个投递${result.deduplicated ? "，服务端判定为重复图片" : ""}`;
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
  showError("");
  try {
    const state = await window.studyshot.adminLogin({
      serverBaseUrl: els.adminServerInput.value,
      login: els.adminLoginInput.value,
      password: els.adminPasswordInput.value,
    });
    els.adminPasswordInput.value = "";
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(submit, false);
  }
});

els.refreshDevicesButton.addEventListener("click", async () => {
  setBusy(els.refreshDevicesButton, true);
  showError("");
  try {
    const state = await window.studyshot.adminRefreshDevices();
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(els.refreshDevicesButton, false);
  }
});

els.adminLogoutButton.addEventListener("click", async () => {
  try {
    const state = await window.studyshot.adminLogout();
    renderState(state);
  } catch (err) {
    showError(err.message || String(err));
  }
});

window.studyshot.onStateChanged(renderState);
loadState().catch((err) => showError(err.message || String(err)));
