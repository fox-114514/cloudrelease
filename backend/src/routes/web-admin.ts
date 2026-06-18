import type { FastifyInstance } from "fastify";

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StudyShot Relay Admin</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7f8;
        --panel: #ffffff;
        --panel-2: #edf2f5;
        --text: #1d252d;
        --muted: #65727e;
        --line: #d8e0e7;
        --accent: #0f7b6c;
        --accent-2: #285f9f;
        --danger: #b23b3b;
        --warning: #8a5d18;
        --shadow: 0 12px 28px rgba(24, 35, 46, 0.08);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-width: 920px; background: var(--bg); color: var(--text); }
      button, input, select { font: inherit; }
      button {
        min-height: 34px;
        border: 0;
        border-radius: 6px;
        padding: 0 12px;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
      }
      button.secondary { background: #e8edf1; color: #26313c; border: 1px solid var(--line); }
      button.danger { background: var(--danger); }
      button:disabled { cursor: not-allowed; opacity: 0.55; }
      input, select {
        width: 100%;
        min-width: 0;
        height: 38px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        color: var(--text);
        padding: 0 10px;
      }
      input:focus, select:focus { outline: 2px solid rgba(15, 123, 108, 0.22); border-color: var(--accent); }
      .shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
      .sidebar { background: #eef3f5; border-right: 1px solid var(--line); padding: 22px 16px; }
      .brand h1 { margin: 0; font-size: 20px; line-height: 1.2; }
      .brand p { margin: 7px 0 20px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
      .nav { display: grid; gap: 8px; }
      .nav button { width: 100%; text-align: left; background: transparent; color: #33404d; border: 1px solid transparent; justify-content: flex-start; }
      .nav button.active { background: #fff; border-color: var(--line); box-shadow: var(--shadow); }
      .content { min-width: 0; padding: 24px 28px 32px; overflow: auto; }
      .topbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 18px; }
      .topbar h2 { margin: 0; font-size: 22px; }
      .session { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
      .view { display: none; }
      .view.active { display: block; }
      .grid { display: grid; gap: 14px; }
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .metric, .card, .table-wrap {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }
      .metric { min-height: 88px; padding: 14px; }
      .metric span { color: var(--muted); font-size: 12px; }
      .metric strong { display: block; margin-top: 10px; font-size: 22px; overflow-wrap: anywhere; }
      .card { padding: 16px; margin-bottom: 14px; }
      .card h3 { margin: 0 0 12px; font-size: 17px; }
      .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .field label { display: block; margin-bottom: 6px; color: var(--muted); font-size: 12px; font-weight: 650; }
      .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .message { margin-bottom: 14px; padding: 12px 14px; border-radius: 8px; border: 1px solid; overflow-wrap: anywhere; }
      .message.error { background: #fff3f2; border-color: #efc5c0; color: var(--danger); }
      .message.ok { background: #effaf6; border-color: #b9ded2; color: #174f43; }
      .message.warn { background: #fff8e9; border-color: #edd6a8; color: var(--warning); }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
      th { background: var(--panel-2); color: #384756; font-weight: 700; position: sticky; top: 0; }
      td { overflow-wrap: anywhere; }
      tr:last-child td { border-bottom: 0; }
      .pill { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: 999px; background: #e7edf2; color: #2f3d49; font-size: 12px; font-weight: 700; }
      .pill.ok { background: #dcefe9; color: #0b5f53; }
      .pill.bad { background: #f4dfdf; color: var(--danger); }
      .permission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; min-width: 260px; }
      .toggle { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
      .toggle input { width: 16px; height: 16px; }
      .scope-grid { display: grid; gap: 8px; min-width: 220px; }
      .small-input { min-width: 160px; }
      .login-panel { max-width: 720px; margin: 48px auto; }
      .hidden { display: none !important; }
      .audit-meta { max-width: 360px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
      @media (max-width: 980px) {
        body { min-width: 0; }
        .shell { grid-template-columns: 1fr; }
        .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
        .nav { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .metrics, .form-grid, .form-grid.two { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>StudyShot Admin</h1>
          <p id="serverHint">后端管理</p>
        </div>
        <nav class="nav" aria-label="管理导航">
          <button class="active" data-view="dashboard">概览</button>
          <button data-view="devices">设备</button>
          <button data-view="users">用户</button>
          <button data-view="groups">分组</button>
          <button data-view="audit">审计</button>
        </nav>
      </aside>
      <section class="content">
        <div class="topbar">
          <h2 id="viewTitle">概览</h2>
          <div class="actions">
            <span class="session" id="sessionText">未登录</span>
            <button class="secondary" id="refreshBtn">刷新</button>
            <button class="secondary" id="logoutBtn">退出</button>
          </div>
        </div>
        <div id="message" class="message hidden"></div>

        <section id="loginPanel" class="login-panel">
          <div class="card">
            <h3>登录管理后台</h3>
            <div class="form-grid two">
              <div class="field">
                <label>登录名</label>
                <input id="loginInput" autocomplete="username" placeholder="owner" />
              </div>
              <div class="field">
                <label>密码</label>
                <input id="passwordInput" type="password" autocomplete="current-password" />
              </div>
              <div class="actions">
                <button id="loginBtn">登录</button>
              </div>
            </div>
          </div>
        </section>

        <section id="appPanel" class="hidden">
          <section id="view-dashboard" class="view active">
            <div class="grid metrics">
              <div class="metric"><span>用户</span><strong id="metricUsers">-</strong></div>
              <div class="metric"><span>设备</span><strong id="metricDevices">-</strong></div>
              <div class="metric"><span>有效设备</span><strong id="metricActiveDevices">-</strong></div>
              <div class="metric"><span>分组</span><strong id="metricGroups">-</strong></div>
            </div>
            <div class="card">
              <h3>快速创建绑定码</h3>
              <div class="form-grid">
                <div class="field">
                  <label>目标用户</label>
                  <select id="quickBindUser"></select>
                </div>
                <div class="field">
                  <label>设备名提示</label>
                  <input id="quickBindHint" placeholder="OnePlus Pad / Ubuntu Laptop" />
                </div>
                <div class="actions">
                  <button id="quickBindBtn">生成绑定码</button>
                </div>
              </div>
            </div>
            <div id="recentAudit"></div>
          </section>

          <section id="view-devices" class="view">
            <div class="card">
              <h3>创建设备绑定码</h3>
              <div class="form-grid">
                <div class="field">
                  <label>目标用户</label>
                  <select id="bindUserSelect"></select>
                </div>
                <div class="field">
                  <label>设备名提示</label>
                  <input id="bindDeviceHint" placeholder="新设备" />
                </div>
                <div class="actions">
                  <button id="createBindBtn">生成绑定码</button>
                </div>
              </div>
            </div>
            <div class="table-wrap"><table><thead><tr><th>设备</th><th>用户</th><th>状态</th><th>权限</th><th>范围</th><th>操作</th></tr></thead><tbody id="deviceRows"></tbody></table></div>
          </section>

          <section id="view-users" class="view">
            <div class="card">
              <h3>创建子用户</h3>
              <div class="form-grid">
                <div class="field"><label>登录名</label><input id="newUserLogin" /></div>
                <div class="field"><label>显示名</label><input id="newUserName" /></div>
                <div class="field"><label>密码</label><input id="newUserPassword" type="password" /></div>
                <div class="actions"><button id="createUserBtn">创建用户</button></div>
              </div>
            </div>
            <div class="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>设备数</th><th>状态</th><th>操作</th></tr></thead><tbody id="userRows"></tbody></table></div>
          </section>

          <section id="view-groups" class="view">
            <div class="card">
              <h3>创建分组</h3>
              <div class="form-grid two">
                <div class="field"><label>分组名</label><input id="newGroupName" /></div>
                <div class="actions"><button id="createGroupBtn">创建分组</button></div>
              </div>
            </div>
            <div class="table-wrap"><table><thead><tr><th>分组</th><th>成员</th><th>添加成员</th><th>操作</th></tr></thead><tbody id="groupRows"></tbody></table></div>
          </section>

          <section id="view-audit" class="view">
            <div class="card">
              <h3>审计日志</h3>
              <div class="actions">
                <button class="secondary" id="refreshAuditBtn">刷新审计</button>
              </div>
            </div>
            <div class="table-wrap"><table><thead><tr><th>时间</th><th>动作</th><th>目标</th><th>操作者</th><th>元数据</th></tr></thead><tbody id="auditRows"></tbody></table></div>
          </section>
        </section>
      </section>
    </main>

    <script>
      const state = {
        token: localStorage.getItem("studyshot_admin_token") || "",
        user: JSON.parse(localStorage.getItem("studyshot_admin_user") || "null"),
        users: [],
        devices: [],
        groups: [],
        logs: []
      };

      const $ = (id) => document.getElementById(id);
      const titleMap = { dashboard: "概览", devices: "设备", users: "用户", groups: "分组", audit: "审计" };
      const permissionLabels = {
        canAutoUpload: "自动上传",
        canManualUpload: "手动上传",
        canAutoReceive: "自动接收",
        canManualDownload: "手动下载",
        canManageSpace: "管理空间",
        canCreateInvite: "创建邀请"
      };
      const uploadScopes = ["screenshot_only", "selected_album", "manual_share_only", "all_images"];
      const receiveScopes = ["disabled", "all_authorized_sources", "same_user_only", "selected_devices"];

      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[ch]));
      }

      function showMessage(text, kind) {
        const el = $("message");
        el.textContent = text;
        el.className = "message " + (kind || "ok");
        el.classList.toggle("hidden", !text);
      }

      function fmt(value) {
        if (!value) return "-";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
      }

      async function api(path, options) {
        const init = options || {};
        const headers = Object.assign({}, init.headers || {});
        if (state.token) headers.Authorization = "Bearer " + state.token;
        if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
        const response = await fetch("/api/v1" + path, Object.assign({}, init, { headers }));
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
          throw new Error((body.error && body.error.message) || response.statusText || "请求失败");
        }
        return body.data || {};
      }

      function setSession() {
        const loggedIn = Boolean(state.token);
        $("loginPanel").classList.toggle("hidden", loggedIn);
        $("appPanel").classList.toggle("hidden", !loggedIn);
        $("refreshBtn").disabled = !loggedIn;
        $("logoutBtn").disabled = !loggedIn;
        $("sessionText").textContent = state.user
          ? (state.user.emailOrLogin + " · " + state.user.role)
          : "未登录";
      }

      async function login() {
        showMessage("", "ok");
        const data = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            login: $("loginInput").value.trim(),
            password: $("passwordInput").value
          })
        });
        state.token = data.accessToken;
        state.user = data.user;
        localStorage.setItem("studyshot_admin_token", state.token);
        localStorage.setItem("studyshot_admin_user", JSON.stringify(state.user));
        $("passwordInput").value = "";
        setSession();
        await refreshAll();
      }

      function logout() {
        state.token = "";
        state.user = null;
        state.users = [];
        state.devices = [];
        state.groups = [];
        state.logs = [];
        localStorage.removeItem("studyshot_admin_token");
        localStorage.removeItem("studyshot_admin_user");
        setSession();
        showMessage("已退出", "ok");
      }

      async function refreshAll() {
        if (!state.token) return;
        showMessage("", "ok");
        const results = await Promise.all([
          api("/users"),
          api("/devices"),
          api("/groups"),
          api("/audit-logs?limit=50")
        ]);
        state.users = results[0].users || [];
        state.devices = results[1].devices || [];
        state.groups = results[2].groups || [];
        state.logs = results[3].logs || [];
        renderAll();
      }

      function renderAll() {
        renderMetrics();
        renderUserSelects();
        renderDevices();
        renderUsers();
        renderGroups();
        renderAudit();
      }

      function renderMetrics() {
        $("metricUsers").textContent = state.users.length;
        $("metricDevices").textContent = state.devices.length;
        $("metricActiveDevices").textContent = state.devices.filter((d) => !d.revokedAt).length;
        $("metricGroups").textContent = state.groups.length;
        $("recentAudit").innerHTML = '<div class="card"><h3>最近审计</h3>' + auditTable(state.logs.slice(0, 5)) + '</div>';
      }

      function renderUserSelects() {
        const options = state.users.map((u) => '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.displayName || u.emailOrLogin) + " · " + escapeHtml(u.role) + '</option>').join("");
        $("bindUserSelect").innerHTML = options;
        $("quickBindUser").innerHTML = options;
      }

      function renderDevices() {
        $("deviceRows").innerHTML = state.devices.map((device) => {
          const revoked = Boolean(device.revokedAt);
          const permissionHtml = Object.keys(permissionLabels).map((key) => {
            return '<label class="toggle"><input type="checkbox" data-action="perm" data-device="' + escapeHtml(device.id) + '" data-key="' + key + '"' + (device.permissions && device.permissions[key] ? " checked" : "") + (revoked ? " disabled" : "") + '><span>' + permissionLabels[key] + '</span></label>';
          }).join("");
          const uploadOptions = uploadScopes.map((scope) => '<option value="' + scope + '"' + (device.permissions && device.permissions.autoUploadScope === scope ? " selected" : "") + ">" + scope + "</option>").join("");
          const receiveOptions = receiveScopes.map((scope) => '<option value="' + scope + '"' + (device.permissions && device.permissions.autoReceiveScope === scope ? " selected" : "") + ">" + scope + "</option>").join("");
          return '<tr>' +
            '<td><strong>' + escapeHtml(device.name) + '</strong><br><span class="session">' + escapeHtml(device.platform) + " · " + escapeHtml(device.id) + '</span></td>' +
            '<td>' + escapeHtml(device.userDisplayName || device.userId) + '</td>' +
            '<td>' + (revoked ? '<span class="pill bad">已撤销</span>' : '<span class="pill ok">有效</span>') + '<br><span class="session">上次在线：' + fmt(device.lastSeenAt) + '</span></td>' +
            '<td><div class="permission-grid">' + permissionHtml + '</div></td>' +
            '<td><div class="scope-grid"><select data-action="scope" data-device="' + escapeHtml(device.id) + '" data-key="autoUploadScope"' + (revoked ? " disabled" : "") + '>' + uploadOptions + '</select><select data-action="scope" data-device="' + escapeHtml(device.id) + '" data-key="autoReceiveScope"' + (revoked ? " disabled" : "") + '>' + receiveOptions + '</select></div></td>' +
            '<td><div class="actions"><input class="small-input" value="' + escapeHtml(device.name) + '" data-name-input="' + escapeHtml(device.id) + '"' + (revoked ? " disabled" : "") + '><button class="secondary" data-action="rename" data-device="' + escapeHtml(device.id) + '"' + (revoked ? " disabled" : "") + '>改名</button><button class="danger" data-action="revoke" data-device="' + escapeHtml(device.id) + '"' + (revoked ? " disabled" : "") + '>撤销</button></div></td>' +
            '</tr>';
        }).join("");
      }

      function renderUsers() {
        $("userRows").innerHTML = state.users.map((user) => {
          const disabled = Boolean(user.disabledAt);
          return '<tr>' +
            '<td><strong>' + escapeHtml(user.displayName || "-") + '</strong><br><span class="session">' + escapeHtml(user.emailOrLogin) + " · " + escapeHtml(user.id) + '</span></td>' +
            '<td><span class="pill">' + escapeHtml(user.role) + '</span></td>' +
            '<td>' + escapeHtml(user.deviceCount) + '</td>' +
            '<td>' + (disabled ? '<span class="pill bad">已禁用</span>' : '<span class="pill ok">正常</span>') + '</td>' +
            '<td><div class="actions"><input class="small-input" value="' + escapeHtml(user.displayName || "") + '" data-user-name="' + escapeHtml(user.id) + '"><button class="secondary" data-action="user-name" data-user="' + escapeHtml(user.id) + '">保存名称</button><button class="secondary" data-action="user-toggle" data-user="' + escapeHtml(user.id) + '" data-disabled="' + (!disabled) + '"' + (user.role === "owner" ? " disabled" : "") + '>' + (disabled ? "启用" : "禁用") + '</button></div></td>' +
            '</tr>';
        }).join("");
      }

      function renderGroups() {
        $("groupRows").innerHTML = state.groups.map((group) => {
          const members = (group.memberUserIds || []).map((id) => {
            const user = state.users.find((u) => u.id === id);
            return '<span class="pill">' + escapeHtml(user ? (user.displayName || user.emailOrLogin) : id) + ' <button class="secondary" data-action="group-remove" data-group="' + escapeHtml(group.id) + '" data-user="' + escapeHtml(id) + '">移除</button></span>';
          }).join(" ");
          const userOptions = state.users.map((u) => '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.displayName || u.emailOrLogin) + '</option>').join("");
          return '<tr>' +
            '<td><strong>' + escapeHtml(group.name) + '</strong><br><span class="session">' + escapeHtml(group.id) + '</span></td>' +
            '<td>' + (members || "-") + '</td>' +
            '<td><select data-group-select="' + escapeHtml(group.id) + '">' + userOptions + '</select></td>' +
            '<td><button class="secondary" data-action="group-add" data-group="' + escapeHtml(group.id) + '">添加成员</button></td>' +
            '</tr>';
        }).join("");
      }

      function auditTable(logs) {
        if (!logs.length) return '<div class="message warn">暂无审计日志</div>';
        return '<div class="table-wrap"><table><thead><tr><th>时间</th><th>动作</th><th>目标</th><th>操作者</th><th>元数据</th></tr></thead><tbody>' + logs.map((log) => auditRow(log)).join("") + '</tbody></table></div>';
      }

      function auditRow(log) {
        return '<tr>' +
          '<td>' + fmt(log.createdAt) + '</td>' +
          '<td>' + escapeHtml(log.action) + '</td>' +
          '<td>' + escapeHtml(log.targetType || "-") + '<br><span class="session">' + escapeHtml(log.targetId || "-") + '</span></td>' +
          '<td>' + escapeHtml(log.actorUserId || "-") + '<br><span class="session">' + escapeHtml(log.actorDeviceId || "-") + '</span></td>' +
          '<td><pre class="audit-meta">' + escapeHtml(JSON.stringify(log.metadata || {}, null, 2)) + '</pre></td>' +
          '</tr>';
      }

      function renderAudit() {
        $("auditRows").innerHTML = state.logs.map((log) => auditRow(log)).join("");
      }

      async function createBindCode(userSelectId, hintInputId) {
        const data = await api("/bind-codes", {
          method: "POST",
          body: JSON.stringify({
            purpose: "bind_device",
            userId: $(userSelectId).value || undefined,
            deviceNameHint: $(hintInputId).value || undefined,
            expiresInSeconds: 600
          })
        });
        showMessage("绑定码：" + data.bindCode + "，有效期至 " + fmt(data.expiresAt), "ok");
      }

      async function createUser() {
        await api("/users", {
          method: "POST",
          body: JSON.stringify({
            login: $("newUserLogin").value.trim(),
            displayName: $("newUserName").value.trim() || undefined,
            password: $("newUserPassword").value
          })
        });
        $("newUserPassword").value = "";
        showMessage("用户已创建", "ok");
        await refreshAll();
      }

      async function createGroup() {
        await api("/groups", { method: "POST", body: JSON.stringify({ name: $("newGroupName").value.trim() }) });
        $("newGroupName").value = "";
        showMessage("分组已创建", "ok");
        await refreshAll();
      }

      document.querySelector(".nav").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-view]");
        if (!button) return;
        document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        button.classList.add("active");
        $("view-" + button.dataset.view).classList.add("active");
        $("viewTitle").textContent = titleMap[button.dataset.view] || button.dataset.view;
      });

      document.body.addEventListener("change", async (event) => {
        const target = event.target;
        try {
          if (target.dataset.action === "perm") {
            await api("/devices/" + target.dataset.device + "/permissions", {
              method: "PATCH",
              body: JSON.stringify({ [target.dataset.key]: target.checked })
            });
            await refreshAll();
          }
          if (target.dataset.action === "scope") {
            await api("/devices/" + target.dataset.device + "/permissions", {
              method: "PATCH",
              body: JSON.stringify({ [target.dataset.key]: target.value })
            });
            await refreshAll();
          }
        } catch (err) {
          showMessage(err.message || String(err), "error");
          await refreshAll();
        }
      });

      document.body.addEventListener("click", async (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        try {
          if (target.id === "loginBtn") await login();
          else if (target.id === "logoutBtn") logout();
          else if (target.id === "refreshBtn" || target.id === "refreshAuditBtn") await refreshAll();
          else if (target.id === "quickBindBtn") await createBindCode("quickBindUser", "quickBindHint");
          else if (target.id === "createBindBtn") await createBindCode("bindUserSelect", "bindDeviceHint");
          else if (target.id === "createUserBtn") await createUser();
          else if (target.id === "createGroupBtn") await createGroup();
          else if (target.dataset.action === "rename") {
            const input = document.querySelector('[data-name-input="' + CSS.escape(target.dataset.device) + '"]');
            await api("/devices/" + target.dataset.device, { method: "PATCH", body: JSON.stringify({ name: input.value }) });
            showMessage("设备名称已保存", "ok");
            await refreshAll();
          } else if (target.dataset.action === "revoke") {
            if (!confirm("确认撤销该设备？")) return;
            await api("/devices/" + target.dataset.device + "/revoke", { method: "POST" });
            showMessage("设备已撤销", "ok");
            await refreshAll();
          } else if (target.dataset.action === "user-name") {
            const input = document.querySelector('[data-user-name="' + CSS.escape(target.dataset.user) + '"]');
            await api("/users/" + target.dataset.user, { method: "PATCH", body: JSON.stringify({ displayName: input.value }) });
            showMessage("用户名称已保存", "ok");
            await refreshAll();
          } else if (target.dataset.action === "user-toggle") {
            await api("/users/" + target.dataset.user, { method: "PATCH", body: JSON.stringify({ disabled: target.dataset.disabled === "true" }) });
            showMessage("用户状态已更新", "ok");
            await refreshAll();
          } else if (target.dataset.action === "group-add") {
            const select = document.querySelector('[data-group-select="' + CSS.escape(target.dataset.group) + '"]');
            await api("/groups/" + target.dataset.group + "/members", { method: "POST", body: JSON.stringify({ userId: select.value }) });
            showMessage("成员已添加", "ok");
            await refreshAll();
          } else if (target.dataset.action === "group-remove") {
            await api("/groups/" + target.dataset.group + "/members/" + target.dataset.user, { method: "DELETE" });
            showMessage("成员已移除", "ok");
            await refreshAll();
          }
        } catch (err) {
          showMessage(err.message || String(err), "error");
        }
      });

      $("passwordInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") login().catch((err) => showMessage(err.message || String(err), "error"));
      });

      setSession();
      if (state.token) refreshAll().catch((err) => {
        showMessage(err.message || String(err), "error");
        logout();
      });
    </script>
  </body>
</html>`;

export async function webAdminRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (_request: unknown, reply: { header: (name: string, value: string) => unknown; send: (payload: string) => unknown }) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"
    );
    return reply.send(ADMIN_HTML);
  };

  app.get("/admin", handler);
  app.get("/admin/", handler);
}
