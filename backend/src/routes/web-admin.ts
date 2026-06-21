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
      .nav .role-tag {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        background: #e7edf2;
        color: #2f3d49;
        font-size: 11px;
        font-weight: 700;
      }
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
      .card details { margin-top: 8px; }
      .card details summary { cursor: pointer; color: var(--accent-2); font-weight: 700; }
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
      .pill.admin { background: #fde9c2; color: #6b4514; }
      .permission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; min-width: 260px; }
      .toggle { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
      .toggle input { width: 16px; height: 16px; }
      .scope-grid { display: grid; gap: 8px; min-width: 220px; }
      .small-input { min-width: 160px; }
      .login-panel { max-width: 720px; margin: 48px auto; }
      .hidden { display: none !important; }
      .audit-meta { max-width: 360px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
      .source-list { display: grid; gap: 6px; margin-top: 6px; max-height: 180px; overflow: auto; }
      .source-list label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
      .bind-target { font-weight: 700; color: var(--accent); }
      .profile-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
      .profile-card button { background: #e8edf1; color: #26313c; border: 1px solid var(--line); text-align: left; padding: 10px 12px; min-height: 0; }
      .profile-card button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
      .profile-card button strong { display: block; margin-bottom: 4px; }
      .profile-card button span { font-size: 12px; opacity: 0.85; }
      .cross-warn { background: #fff5e6; border: 1px solid #edd6a8; color: var(--warning); padding: 10px 12px; border-radius: 8px; font-size: 13px; }
      .group-banner { background: #f1f5f8; border: 1px dashed var(--line); padding: 10px 12px; border-radius: 8px; color: var(--muted); font-size: 12px; }
      .identity-banner { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; padding: 10px 14px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--line); }
      .identity-banner span { font-size: 13px; }
      .image-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 12px;
      }
      .image-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .image-card.is-expired { opacity: 0.65; }
      .image-card-preview {
        width: 100%;
        aspect-ratio: 1;
        background: var(--panel-2);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        cursor: pointer;
        color: var(--muted);
        font-size: 11px;
      }
      .image-card-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .image-card-meta {
        padding: 10px;
        font-size: 12px;
      }
      .image-card-name {
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .image-card-sub {
        color: var(--muted);
        font-size: 11px;
        margin-top: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .image-card-actions {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .image-card-actions button {
        flex: 1;
        font-size: 11px;
        min-height: 26px;
        padding: 0 6px;
      }
      .image-card { position: relative; }
      .image-card.is-select-mode { cursor: pointer; }
      .image-card.is-selected {
        outline: 2px solid var(--accent);
        outline-offset: -2px;
      }
      .image-card-checkbox {
        position: absolute;
        top: 6px;
        left: 6px;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid var(--line);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
        font-weight: 700;
        font-size: 14px;
        color: transparent;
        user-select: none;
      }
      .image-card.is-selected .image-card-checkbox {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
      }
      .image-card-selected-hint {
        color: var(--muted);
        font-size: 11px;
      }
      .image-card.is-selected .image-card-selected-hint {
        color: var(--accent);
        font-weight: 700;
      }
      .image-selection-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        padding: 10px 14px;
        margin-bottom: 12px;
        background: var(--panel-2);
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .image-selection-bar > span {
        font-weight: 700;
      }
      .image-empty {
        grid-column: 1 / -1;
        padding: 24px;
        text-align: center;
        color: var(--muted);
      }
      .image-loadmore {
        text-align: center;
        padding: 16px;
      }
      .modal {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 24px;
      }
      .modal-content {
        background: var(--panel);
        color: var(--text);
        border-radius: 8px;
        padding: 20px;
        max-width: min(960px, 90vw);
        max-height: 90vh;
        overflow: auto;
        position: relative;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
      }
      .modal-close {
        position: absolute;
        top: 6px;
        right: 10px;
        background: transparent;
        border: 0;
        font-size: 26px;
        cursor: pointer;
        color: var(--muted);
        min-height: 0;
        padding: 4px 8px;
      }
      .modal-close:hover { color: var(--text); }
      .modal img {
        max-width: 100%;
        max-height: 60vh;
        display: block;
        margin: 0 auto;
      }
      .image-modal-meta {
        margin-top: 14px;
        font-size: 13px;
      }
      .image-modal-meta dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 14px;
      }
      .image-modal-meta dt {
        color: var(--muted);
        font-weight: 650;
      }
      .image-modal-meta dd {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        word-break: break-all;
      }
      .image-modal-actions {
        margin-top: 16px;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
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
          <button data-view="devices" data-requires="any">设备</button>
          <button data-view="users" data-requires="owner">成员</button>
          <button data-view="groups" data-requires="owner">分组</button>
          <button data-view="images" data-requires="any">图片</button>
          <button data-view="audit" data-requires="owner">审计</button>
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
        <div id="identityBanner" class="identity-banner hidden"></div>
        <div id="message" class="message hidden"></div>

        <div id="imageModal" class="modal hidden" role="dialog" aria-modal="true" aria-label="图片预览">
          <div class="modal-content">
            <button class="modal-close" id="imageModalClose" type="button" aria-label="关闭">×</button>
            <img id="imageModalImg" alt="预览" />
            <div id="imageModalMeta" class="image-modal-meta"></div>
            <div class="actions">
              <button class="danger" id="imageModalDelete" type="button">删除图片</button>
            </div>
          </div>
        </div>

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
              <div class="metric"><span>成员</span><strong id="metricUsers">-</strong></div>
              <div class="metric"><span>设备</span><strong id="metricDevices">-</strong></div>
              <div class="metric"><span>有效设备</span><strong id="metricActiveDevices">-</strong></div>
              <div class="metric"><span>分组</span><strong id="metricGroups">-</strong></div>
            </div>
            <div class="card" id="quickBindCard">
              <h3>快速创建绑定码</h3>
              <p class="session">绑定码归属必须显式选择目标成员,避免误绑。</p>
              <div class="form-grid">
                <div class="field">
                  <label>目标成员</label>
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
            <div class="card" id="quickSelfBindCard">
              <h3>给自己绑定一台设备</h3>
              <p class="session">使用您当前的账号生成一个绑定码,新设备将归属您的成员身份。</p>
              <div class="actions">
                <button id="quickSelfBindBtn">生成我的绑定码</button>
              </div>
            </div>
            <div id="recentAudit"></div>
          </section>

          <section id="view-devices" class="view">
            <div class="card" id="createBindCard">
              <h3>为指定成员创建设备绑定码</h3>
              <p class="session">新设备将绑定到所选成员名下,绑定码生成后会显示目标成员。</p>
              <div class="form-grid">
                <div class="field">
                  <label>目标成员</label>
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
            <div class="card" id="createSelfBindCard">
              <h3>给自己绑定一台设备</h3>
              <p class="session">将生成一个仅绑定您本人的一次性绑定码。</p>
              <div class="actions">
                <button id="createSelfBindBtn">生成我的绑定码</button>
              </div>
            </div>
            <div class="table-wrap"><table><thead><tr><th>设备</th><th>成员</th><th>状态</th><th>用途预设</th><th>权限</th><th>范围</th><th>操作</th></tr></thead><tbody id="deviceRows"></tbody></table></div>
          </section>

          <section id="view-users" class="view">
            <div class="card">
              <h3>创建成员</h3>
              <div class="form-grid">
                <div class="field"><label>登录名</label><input id="newUserLogin" /></div>
                <div class="field"><label>显示名</label><input id="newUserName" /></div>
                <div class="field"><label>密码</label><input id="newUserPassword" type="password" /></div>
                <div class="actions"><button id="createUserBtn">创建成员</button></div>
              </div>
            </div>
            <div class="table-wrap"><table><thead><tr><th>成员</th><th>角色</th><th>设备数</th><th>状态</th><th>操作</th></tr></thead><tbody id="userRows"></tbody></table></div>
          </section>

          <section id="view-groups" class="view">
            <div class="group-banner">分组当前仅作组织标签,不影响图片共享或投递规则。本期不提供按分组的共享策略。</div>
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

          <section id="view-images" class="view">
            <div class="card">
              <h3>图片库</h3>
              <div class="form-grid two">
                <div class="field">
                  <label>筛选</label>
                  <select id="imageFilter">
                    <option value="all">全部</option>
                    <option value="active">有效</option>
                    <option value="expired">已过期</option>
                    <option value="today">今天</option>
                    <option value="week">最近 7 天</option>
                    <option value="month">最近 30 天</option>
                  </select>
                </div>
                <div class="field" id="imageUserFilterField">
                  <label>按成员筛选</label>
                  <select id="imageUserFilter">
                    <option value="">全部成员</option>
                  </select>
                </div>
                <div class="field">
                  <label>&nbsp;</label>
                  <div class="actions">
                    <button class="secondary" id="refreshImagesBtn">刷新</button>
                    <button id="toggleSelectModeBtn">多选</button>
                  </div>
                </div>
              </div>
            </div>
            <div id="imageSelectionBar" class="image-selection-bar hidden">
              <span id="imageSelectedCount">已选 0</span>
              <div class="actions">
                <button class="secondary" id="imageSelectAllBtn" type="button">全选本页</button>
                <button class="danger" id="imageDeleteSelectedBtn" type="button" disabled>删除所选 (0)</button>
                <button class="secondary" id="imageCancelSelectBtn" type="button">取消</button>
              </div>
            </div>
            <div id="imageGrid" class="image-grid"></div>
            <div id="imageLoadMore" class="image-loadmore hidden">
              <button class="secondary" id="imageLoadMoreBtn">加载更多</button>
            </div>
          </section>
        </section>
      </section>
    </main>

    <script>
      const ROLE_LABELS = { owner: "空间管理员", child: "成员" };
      const ROLE_BADGE_CLASS = { owner: "pill admin", child: "pill" };
      const PROFILE_LABELS = {
        manual_only: "只手动分享",
        upload_only: "只上传截图",
        receive_own: "只接收我的图片",
        sync_own: "我的设备双向同步",
        custom: "自定义(高级)",
      };
      const PROFILE_DESCRIPTIONS = {
        manual_only: "可手动分享图片到空间,不自动上传或接收。",
        upload_only: "把本设备的截图自动发到空间,不自动接收。",
        receive_own: "接收我名下其他设备上传的图片,不自动上传。",
        sync_own: "自动上传本设备的截图,并接收我名下其他设备上传的图片。",
      };
      const UPLOAD_SCOPE_LABELS = {
        screenshot_only: "仅截图",
        selected_album: "选定相册",
        manual_share_only: "仅手动分享",
        all_images: "全部图片",
      };
      const RECEIVE_SCOPE_LABELS = {
        disabled: "不接收",
        same_user_only: "仅接收我的设备",
        selected_devices: "接收指定设备",
        all_authorized_sources: "接收空间全部设备",
      };
      const RECEIVE_SCOPE_WARNINGS = {
        all_authorized_sources: "此选项会让本设备收到其他成员上传的图片,请确认你接受跨成员共享。",
        selected_devices: "请在下方至少勾选一个来源设备,否则本设备将收不到任何图片。",
      };
      const PERMISSION_LABELS = {
        canAutoUpload: "自动上传",
        canManualUpload: "手动上传",
        canAutoReceive: "自动接收",
        canManualDownload: "手动下载",
        canManageSpace: "管理空间(高级)",
        canCreateInvite: "从此设备添加我的其他设备",
      };

      const state = {
        token: localStorage.getItem("studyshot_admin_token") || "",
        user: JSON.parse(localStorage.getItem("studyshot_admin_user") || "null"),
        users: [],
        devices: [],
        groups: [],
        logs: [],
        images: [],
        imageCursor: null,
        imageFilter: "all",
        imageUserFilter: "",
        imageLoaded: false,
        previewBlobUrls: {},
        selectMode: false,
        selectedImageIds: new Set(),
      };

      const $ = (id) => document.getElementById(id);
      const titleMap = { dashboard: "概览", devices: "设备", users: "成员", groups: "分组", images: "图片库", audit: "审计" };

      function isOwner() {
        return Boolean(state.user) && state.user.role === "owner";
      }

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

      function renderIdentityBanner() {
        const banner = $("identityBanner");
        if (!state.user) {
          banner.classList.add("hidden");
          banner.innerHTML = "";
          return;
        }
        const roleLabel = ROLE_LABELS[state.user.role] || state.user.role;
        banner.classList.remove("hidden");
        banner.innerHTML =
          '<span>当前身份:<strong>' + escapeHtml(state.user.displayName || state.user.emailOrLogin) + '</strong></span>' +
          '<span class="pill ' + (ROLE_BADGE_CLASS[state.user.role] || "pill") + '">' + escapeHtml(roleLabel) + '</span>' +
          '<span class="session">空间:' + escapeHtml(state.user.ownerUserId.slice(0, 8)) + '…</span>';
      }

      function applyRoleVisibility() {
        const owner = isOwner();
        document.querySelectorAll(".nav button[data-view]").forEach((btn) => {
          const requires = btn.dataset.requires;
          if (requires === "owner" && !owner) {
            btn.classList.add("hidden");
          } else {
            btn.classList.remove("hidden");
          }
        });

        // Card-level visibility based on role.
        const ownerOnlyCards = ["quickBindCard", "createBindCard"];
        ownerOnlyCards.forEach((id) => {
          const el = $(id);
          if (el) el.classList.toggle("hidden", !owner);
        });

        // The "by member" image filter only matters for owners.
        const userFilterField = $("imageUserFilterField");
        if (userFilterField) userFilterField.classList.toggle("hidden", !owner);
      }

      function setSession() {
        const loggedIn = Boolean(state.token);
        $("loginPanel").classList.toggle("hidden", loggedIn);
        $("appPanel").classList.toggle("hidden", !loggedIn);
        $("refreshBtn").disabled = !loggedIn;
        $("logoutBtn").disabled = !loggedIn;
        $("sessionText").textContent = state.user
          ? (state.user.emailOrLogin + " · " + (ROLE_LABELS[state.user.role] || state.user.role))
          : "未登录";
        renderIdentityBanner();
        applyRoleVisibility();
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
        state.images = [];
        state.imageCursor = null;
        state.imageLoaded = false;
        state.selectMode = false;
        state.selectedImageIds.clear();
        Object.keys(state.previewBlobUrls).forEach((id) => {
          URL.revokeObjectURL(state.previewBlobUrls[id]);
          delete state.previewBlobUrls[id];
        });
        localStorage.removeItem("studyshot_admin_token");
        localStorage.removeItem("studyshot_admin_user");
        setSession();
        showMessage("已退出", "ok");
      }

      async function refreshAll() {
        if (!state.token) return;
        showMessage("", "ok");
        const owner = isOwner();
        const requests = [
          api("/devices"),
          owner ? api("/users") : Promise.resolve({ users: [] }),
          owner ? api("/groups") : Promise.resolve({ groups: [] }),
          owner ? api("/audit-logs?limit=50") : Promise.resolve({ logs: [] }),
        ];
        const results = await Promise.all(requests);
        state.devices = results[0].devices || [];
        state.users = results[1].users || [];
        state.groups = results[2].groups || [];
        state.logs = results[3].logs || [];
        renderAll();
      }

      function renderAll() {
        renderMetrics();
        renderUserSelects();
        renderDevices();
        if (isOwner()) {
          renderUsers();
          renderGroups();
          renderAudit();
        } else {
          $("userRows").innerHTML = "";
          $("groupRows").innerHTML = "";
          $("auditRows").innerHTML = "";
        }
      }

      function renderMetrics() {
        $("metricUsers").textContent = isOwner() ? state.users.length : "—";
        $("metricDevices").textContent = state.devices.length;
        $("metricActiveDevices").textContent = state.devices.filter((d) => !d.revokedAt).length;
        $("metricGroups").textContent = isOwner() ? state.groups.length : "—";
        $("recentAudit").innerHTML = isOwner()
          ? '<div class="card"><h3>最近审计</h3>' + auditTable(state.logs.slice(0, 5)) + '</div>'
          : "";
      }

      function renderUserSelects() {
        const me = state.user ? state.user.id : null;
        const list = isOwner() ? state.users : state.users.filter((u) => u.id === me);
        const options = list.map((u) => {
          const role = ROLE_LABELS[u.role] || u.role;
          return '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.displayName || u.emailOrLogin) + " · " + escapeHtml(role) + '</option>';
        }).join("");
        if ($("bindUserSelect")) $("bindUserSelect").innerHTML = options;
        if ($("quickBindUser")) $("quickBindUser").innerHTML = options;

        const imageUserFilter = $("imageUserFilter");
        if (imageUserFilter) {
          imageUserFilter.innerHTML =
            '<option value="">全部成员</option>' +
            state.users.map((u) =>
              '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.displayName || u.emailOrLogin) + '</option>'
            ).join("");
          imageUserFilter.value = state.imageUserFilter;
        }
      }

      function renderDevices() {
        $("deviceRows").innerHTML = state.devices.map((device) => {
          const revoked = Boolean(device.revokedAt);
          const profile = device.profile || "custom";
          const profileLabel = PROFILE_LABELS[profile] || profile;

          const permissionHtml = isOwner()
            ? Object.keys(PERMISSION_LABELS).map((key) => {
                return '<label class="toggle"><input type="checkbox" data-action="perm" data-device="' + escapeHtml(device.id) + '" data-key="' + key + '"' + (device.permissions && device.permissions[key] ? " checked" : "") + (revoked ? " disabled" : "") + '><span>' + PERMISSION_LABELS[key] + '</span></label>';
              }).join("")
            : '<span class="session">成员只能使用安全用途预设；高级权限由空间管理员设置。</span>';
          const uploadOptions = Object.keys(UPLOAD_SCOPE_LABELS).map((scope) =>
            '<option value="' + scope + '"' + (device.permissions && device.permissions.autoUploadScope === scope ? " selected" : "") + ">" + UPLOAD_SCOPE_LABELS[scope] + "</option>"
          ).join("");
          const receiveOptions = Object.keys(RECEIVE_SCOPE_LABELS).filter((scope) => isOwner() || scope !== "all_authorized_sources").map((scope) =>
            '<option value="' + scope + '"' + (device.permissions && device.permissions.autoReceiveScope === scope ? " selected" : "") + ">" + RECEIVE_SCOPE_LABELS[scope] + "</option>"
          ).join("");

          return '<tr>' +
            '<td><strong>' + escapeHtml(device.name) + '</strong><br><span class="session">' + escapeHtml(device.platform) + " · " + escapeHtml(device.id) + '</span></td>' +
            '<td>' + escapeHtml(device.userDisplayName || device.userId) + '<br><span class="session">' + escapeHtml(ROLE_LABELS[device.userRole] || device.userRole) + '</span></td>' +
            '<td>' + (revoked ? '<span class="pill bad">已撤销</span>' : '<span class="pill ok">有效</span>') + '<br><span class="session">上次在线：' + fmt(device.lastSeenAt) + '</span></td>' +
            '<td><div class="profile-card" data-device="' + escapeHtml(device.id) + '">' +
              ['manual_only', 'upload_only', 'receive_own', 'sync_own'].map((p) =>
                '<button data-action="profile" data-device="' + escapeHtml(device.id) + '" data-profile="' + p + '"' +
                (profile === p ? ' class="active"' : '') + (revoked ? ' disabled' : '') +
                '><strong>' + PROFILE_LABELS[p] + '</strong><span>' + (PROFILE_DESCRIPTIONS[p] || "高级自定义") + '</span></button>'
              ).join("") +
              (profile === "custom" ? '<div class="session">当前为自定义高级配置。选择上方任一预设即可安全重置运行权限。</div>' : '') +
            '</div></td>' +
            '<td><div class="permission-grid">' + permissionHtml + '</div></td>' +
            '<td><div class="scope-grid">' +
              (isOwner() ? '<select data-action="scope" data-device="' + escapeHtml(device.id) + '" data-key="autoUploadScope"' + (revoked ? " disabled" : "") + '>' + uploadOptions + '</select>' : '') +
              '<select data-action="receive-config" data-device="' + escapeHtml(device.id) + '"' + (revoked ? " disabled" : "") + '>' + receiveOptions + '</select>' +
              '<div data-source-list="' + escapeHtml(device.id) + '" class="source-list hidden"></div>' +
            '</div></td>' +
            '<td><div class="actions"><input class="small-input" value="' + escapeHtml(device.name) + '" data-name-input="' + escapeHtml(device.id) + '"' + (revoked ? " disabled" : "") + '><button class="secondary" data-action="rename" data-device="' + escapeHtml(device.id) + '"' + (revoked ? " disabled" : "") + '>改名</button>' + (revoked ? '<button class="danger" data-action="delete-device" data-device="' + escapeHtml(device.id) + '">删除</button>' : '<button class="danger" data-action="revoke" data-device="' + escapeHtml(device.id) + '">撤销</button>') + '</div></td>' +
            '</tr>';
        }).join("");

        // After rendering, render source pickers for selected_devices rows.
        state.devices.forEach((d) => {
          const list = document.querySelector('[data-source-list="' + CSS.escape(d.id) + '"]');
          if (!list) return;
          if (d.permissions && d.permissions.autoReceiveScope === "selected_devices") {
            renderSourceList(d, list);
          } else {
            list.classList.add("hidden");
          }
        });
      }

      function renderSourceList(device, container) {
        const sameUser = state.devices.filter((d) => d.id !== device.id && !d.revokedAt && d.userId === device.userId);
        const candidates = isOwner() ? state.devices.filter((d) => d.id !== device.id && !d.revokedAt) : sameUser;
        if (candidates.length === 0) {
          container.innerHTML = '<span class="session">当前成员名下没有可作为来源的设备。</span>';
          container.classList.remove("hidden");
          return;
        }
        const selected = new Set(device.receiveSourceDeviceIds || []);
        container.innerHTML = candidates.map((d) => {
          return '<label><input type="checkbox" data-action="source" data-target="' + escapeHtml(device.id) + '" data-source="' + escapeHtml(d.id) + '"' + (selected.has(d.id) ? ' checked' : '') + '><span>' + escapeHtml(d.name) + (d.userId !== device.userId ? " (" + escapeHtml(d.userDisplayName || d.userId) + ")" : "") + '</span></label>';
        }).join("");
        container.classList.remove("hidden");
      }

      function renderUsers() {
        $("userRows").innerHTML = state.users.map((user) => {
          const disabled = Boolean(user.disabledAt);
          const role = ROLE_LABELS[user.role] || user.role;
          return '<tr>' +
            '<td><strong>' + escapeHtml(user.displayName || "-") + '</strong><br><span class="session">' + escapeHtml(user.emailOrLogin) + " · " + escapeHtml(user.id) + '</span></td>' +
            '<td><span class="' + (ROLE_BADGE_CLASS[user.role] || "pill") + '">' + escapeHtml(role) + '</span></td>' +
            '<td>' + escapeHtml(user.deviceCount) + '</td>' +
            '<td>' + (disabled ? '<span class="pill bad">已禁用</span>' : '<span class="pill ok">正常</span>') + '</td>' +
            '<td><div class="actions"><input class="small-input" value="' + escapeHtml(user.displayName || "") + '" data-user-name="' + escapeHtml(user.id) + '"><button class="secondary" data-action="user-name" data-user="' + escapeHtml(user.id) + '">保存名称</button>' + (user.role === "owner" ? "" : '<button class="secondary" data-action="user-toggle" data-user="' + escapeHtml(user.id) + '" data-disabled="' + (!disabled) + '">' + (disabled ? "启用" : "禁用") + '</button>') + '</div></td>' +
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

      function formatBytes(n) {
        if (!n || n < 0) return "-";
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
        return (n / 1024 / 1024).toFixed(1) + " MB";
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
        const userId = $(userSelectId).value;
        const data = await api("/bind-codes", {
          method: "POST",
          body: JSON.stringify({
            purpose: "bind_device",
            userId,
            deviceNameHint: $(hintInputId).value || undefined,
            expiresInSeconds: 600
          })
        });
        const target = data.targetUser || {};
        showMessage(
          "绑定码 " + data.bindCode + " 将绑定到 " + (target.displayName || target.id || "目标成员") +
          " · 有效期至 " + fmt(data.expiresAt),
          "ok"
        );
      }

      async function createSelfBindCode() {
        if (!state.user) return;
        const data = await api("/bind-codes", {
          method: "POST",
          body: JSON.stringify({ purpose: "bind_device", expiresInSeconds: 600 })
        });
        const target = data.targetUser || {};
        showMessage(
          "绑定码 " + data.bindCode + " 将绑定到您本人(" + (target.displayName || target.id) +
          ") · 有效期至 " + fmt(data.expiresAt),
          "ok"
        );
      }

      async function setDeviceProfile(deviceId, profile) {
        await api("/devices/" + deviceId + "/profile", {
          method: "PATCH",
          body: JSON.stringify({ profile }),
        });
      }

      async function setReceiveConfig(deviceId, mode, sourceDeviceIds) {
        return api("/devices/" + deviceId + "/receive-config", {
          method: "PUT",
          body: JSON.stringify({ mode, sourceDeviceIds }),
        });
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
        showMessage("成员已创建", "ok");
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
        if (button.classList.contains("hidden")) return;
        document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        button.classList.add("active");
        $("view-" + button.dataset.view).classList.add("active");
        $("viewTitle").textContent = titleMap[button.dataset.view] || button.dataset.view;
        if (button.dataset.view === "images" && !state.imageLoaded) {
          state.imageLoaded = true;
          loadImages(true);
        }
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
          if (target.dataset.action === "receive-config") {
            const deviceId = target.dataset.device;
            const mode = target.value;
            if (RECEIVE_SCOPE_WARNINGS[mode]) {
              if (!confirm(RECEIVE_SCOPE_WARNINGS[mode] + "\n确认继续吗?")) {
                await refreshAll();
                return;
              }
            }
            let sourceDeviceIds = [];
            if (mode === "selected_devices") {
              const device = state.devices.find((item) => item.id === deviceId);
              const container = document.querySelector('[data-source-list="' + CSS.escape(deviceId) + '"]');
              if (device && container) renderSourceList(device, container);
              const list = document.querySelectorAll('input[data-action="source"][data-target="' + CSS.escape(deviceId) + '"]:checked');
              sourceDeviceIds = Array.from(list).map((el) => el.dataset.source);
              if (sourceDeviceIds.length === 0) {
                showMessage("请在下方勾选至少一个来源设备；勾选后会立即保存。", "warn");
                return;
              }
            }
            await setReceiveConfig(deviceId, mode, sourceDeviceIds);
            await refreshAll();
          }
          if (target.dataset.action === "source") {
            const targetId = target.dataset.target;
            const sourceIds = Array.from(document.querySelectorAll('input[data-action="source"][data-target="' + CSS.escape(targetId) + '"]:checked'))
              .map((el) => el.dataset.source);
            if (sourceIds.length === 0) {
              showMessage("至少保留一个来源设备；如需停止接收，请选择“不接收”。", "warn");
              await refreshAll();
              return;
            }
            try {
              await setReceiveConfig(targetId, "selected_devices", sourceIds);
              showMessage("来源已更新", "ok");
              await refreshAll();
            } catch (err) {
              showMessage(err.message || String(err), "error");
              await refreshAll();
            }
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
          else if (target.id === "quickSelfBindBtn" || target.id === "createSelfBindBtn") await createSelfBindCode();
          else if (target.id === "createUserBtn") await createUser();
          else if (target.id === "createGroupBtn") await createGroup();
          else if (target.dataset.action === "profile") {
            await setDeviceProfile(target.dataset.device, target.dataset.profile);
            showMessage("设备用途已更新", "ok");
            await refreshAll();
          }
          else if (target.dataset.action === "rename") {
            const input = document.querySelector('[data-name-input="' + CSS.escape(target.dataset.device) + '"]');
            await api("/devices/" + target.dataset.device, { method: "PATCH", body: JSON.stringify({ name: input.value }) });
            showMessage("设备名称已保存", "ok");
            await refreshAll();
          } else if (target.dataset.action === "revoke") {
            if (!confirm("确认撤销该设备?")) return;
            await api("/devices/" + target.dataset.device + "/revoke", { method: "POST" });
            showMessage("设备已撤销", "ok");
            await refreshAll();
          } else if (target.dataset.action === "delete-device") {
            if (!confirm("确认删除这个已撤销设备?历史图片和审计记录会保留。")) return;
            await api("/devices/" + target.dataset.device, { method: "DELETE" });
            showMessage("已删除撤销设备", "ok");
            await refreshAll();
          } else if (target.dataset.action === "user-name") {
            const input = document.querySelector('[data-user-name="' + CSS.escape(target.dataset.user) + '"]');
            await api("/users/" + target.dataset.user, { method: "PATCH", body: JSON.stringify({ displayName: input.value }) });
            showMessage("成员名称已保存", "ok");
            await refreshAll();
          } else if (target.dataset.action === "user-toggle") {
            await api("/users/" + target.dataset.user, { method: "PATCH", body: JSON.stringify({ disabled: target.dataset.disabled === "true" }) });
            showMessage("成员状态已更新", "ok");
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

      // -------- Image library --------
      function buildCardHtml(img) {
        const uploader = (img.uploadedBy && (img.uploadedBy.deviceName || img.uploadedBy.userDisplayName)) || "未知";
        const expiredTag = img.isExpired ? '<span class="pill bad">已过期</span>' : '<span class="pill ok">有效</span>';
        const isSelected = state.selectedImageIds.has(img.id);
        const selectClass = state.selectMode ? ' is-select-mode' : '';
        const selectedClass = isSelected ? ' is-selected' : '';
        const checkboxHtml = state.selectMode
          ? '<div class="image-card-checkbox" data-action="image-select">' + (isSelected ? '✓' : '') + '</div>'
          : '';
        const previewAction = state.selectMode ? 'image-select' : 'image-preview';
        const actionsHtml = state.selectMode
          ? '<div class="image-card-actions"><span class="image-card-selected-hint">' + (isSelected ? '已选中' : '点击选中') + '</span></div>'
          : '<div class="image-card-actions">' +
              '<button class="secondary" data-action="image-preview" type="button">预览</button>' +
              '<button class="danger" data-action="image-delete" type="button">删除</button>' +
            '</div>';
        return (
          '<div class="image-card' + (img.isExpired ? ' is-expired' : '') + selectClass + selectedClass + '" data-image-id="' + escapeHtml(img.id) + '">' +
            checkboxHtml +
            '<div class="image-card-preview" data-action="' + previewAction + '">' +
              '<span>加载中…</span>' +
            '</div>' +
            '<div class="image-card-meta">' +
              '<div class="image-card-name">' + escapeHtml(uploader) + ' ' + expiredTag + '</div>' +
              '<div class="image-card-sub">' + fmt(img.createdAt) + ' · ' + formatBytes(img.fileSize) + '</div>' +
              '<div class="image-card-sub">' + escapeHtml(img.mimeType) + (img.width && img.height ? ' · ' + img.width + '×' + img.height : '') + '</div>' +
              actionsHtml +
            '</div>' +
          '</div>'
        );
      }

      function renderImages() {
        const grid = $("imageGrid");
        if (!state.images.length) {
          grid.innerHTML = '<div class="image-empty">暂无图片</div>';
          $("imageLoadMore").classList.add("hidden");
          updateSelectionBar();
          return;
        }
        grid.innerHTML = state.images.map(buildCardHtml).join("");
        $("imageLoadMore").classList.toggle("hidden", !state.imageCursor);
        state.images.forEach((img) => { loadImagePreview(img.id); });
        updateSelectionBar();
      }

      function findCardPreview(imageId) {
        return document.querySelector(
          '.image-card[data-image-id="' + CSS.escape(imageId) + '"] .image-card-preview'
        );
      }

      function findCard(imageId) {
        return document.querySelector('.image-card[data-image-id="' + CSS.escape(imageId) + '"]');
      }

      async function loadImagePreview(imageId) {
        const card = findCardPreview(imageId);
        const cachedUrl = state.previewBlobUrls[imageId];
        if (cachedUrl) {
          if (card && !card.querySelector("img")) {
            card.innerHTML = '<img src="' + cachedUrl + '" alt="预览" />';
          }
          return cachedUrl;
        }
        if (!card) return null;
        try {
          const response = await fetch(
            "/api/v1/images/" + encodeURIComponent(imageId) + "/download",
            { headers: { Authorization: "Bearer " + state.token } }
          );
          if (!response.ok) {
            if (card.isConnected) card.innerHTML = '<span>预览失败</span>';
            return null;
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          state.previewBlobUrls[imageId] = url;
          if (card.isConnected) {
            card.innerHTML = '<img src="' + url + '" alt="预览" />';
          }
          return url;
        } catch (err) {
          if (card.isConnected) card.innerHTML = '<span>预览失败</span>';
          return null;
        }
      }

      function removeCardFromDom(imageId) {
        const card = findCard(imageId);
        if (card) card.remove();
      }

      function revokePreview(imageId) {
        if (state.previewBlobUrls[imageId]) {
          URL.revokeObjectURL(state.previewBlobUrls[imageId]);
          delete state.previewBlobUrls[imageId];
        }
      }

      function showEmptyIfNeeded() {
        if (state.images.length === 0) {
          $("imageGrid").innerHTML = '<div class="image-empty">暂无图片</div>';
          $("imageLoadMore").classList.add("hidden");
        }
      }

      function isAllOnPageSelected() {
        if (!state.images.length) return false;
        return state.images.every((img) => state.selectedImageIds.has(img.id));
      }

      function updateSelectionBar() {
        const bar = $("imageSelectionBar");
        if (!state.selectMode) {
          bar.classList.add("hidden");
          return;
        }
        bar.classList.remove("hidden");
        $("imageSelectedCount").textContent = "已选 " + state.selectedImageIds.size;
        const allSelected = isAllOnPageSelected();
        $("imageSelectAllBtn").textContent = allSelected ? "取消全选" : "全选本页";
        const count = state.selectedImageIds.size;
        $("imageDeleteSelectedBtn").disabled = count === 0;
        $("imageDeleteSelectedBtn").textContent = "删除所选 (" + count + ")";
      }

      function toggleSelectMode() {
        state.selectMode = !state.selectMode;
        if (!state.selectMode) {
          state.selectedImageIds.clear();
        }
        const btn = $("toggleSelectModeBtn");
        btn.textContent = state.selectMode ? "退出多选" : "多选";
        btn.classList.toggle("secondary", state.selectMode);
        renderImages();
      }

      function toggleCardSelection(imageId) {
        if (state.selectedImageIds.has(imageId)) {
          state.selectedImageIds.delete(imageId);
        } else {
          state.selectedImageIds.add(imageId);
        }
        const card = findCard(imageId);
        if (card) {
          const isSelected = state.selectedImageIds.has(imageId);
          card.classList.toggle("is-selected", isSelected);
          const checkbox = card.querySelector(".image-card-checkbox");
          if (checkbox) checkbox.textContent = isSelected ? "✓" : "";
          const hint = card.querySelector(".image-card-selected-hint");
          if (hint) hint.textContent = isSelected ? "已选中" : "点击选中";
        }
        updateSelectionBar();
      }

      function toggleSelectAllOnPage() {
        if (isAllOnPageSelected()) {
          state.images.forEach((img) => state.selectedImageIds.delete(img.id));
        } else {
          state.images.forEach((img) => state.selectedImageIds.add(img.id));
        }
        renderImages();
      }

      async function loadImages(reset = true) {
        if (!state.token) return;
        showMessage("", "ok");
        try {
          const params = new URLSearchParams();
          params.set("limit", "50");
          params.set("filter", state.imageFilter);
          if (isOwner() && state.imageUserFilter) {
            params.set("userId", state.imageUserFilter);
          }
          if (!reset && state.imageCursor) {
            params.set("before", state.imageCursor);
          }
          const data = await api("/images?" + params.toString());
          const incoming = data.images || [];
          if (reset) {
            const keep = new Set(incoming.map((img) => img.id));
            Object.keys(state.previewBlobUrls).forEach((id) => {
              if (!keep.has(id)) {
                revokePreview(id);
              }
            });
            state.selectedImageIds.forEach((id) => {
              if (!keep.has(id)) state.selectedImageIds.delete(id);
            });
            state.images = incoming;
          } else {
            const existing = new Set(state.images.map((img) => img.id));
            state.images = state.images.concat(incoming.filter((img) => !existing.has(img.id)));
          }
          state.imageCursor = data.nextCursor || null;
          renderImages();
        } catch (err) {
          showMessage(err.message || String(err), "error");
        }
      }

      function syncSelectionVisual() {
        document.querySelectorAll(".image-card").forEach((card) => {
          const id = card.dataset.imageId;
          if (!id) return;
          const shouldBeSelected = state.selectedImageIds.has(id);
          const isSelected = card.classList.contains("is-selected");
          if (shouldBeSelected === isSelected) return;
          card.classList.toggle("is-selected", shouldBeSelected);
          const checkbox = card.querySelector(".image-card-checkbox");
          if (checkbox) checkbox.textContent = shouldBeSelected ? '✓' : "";
          const hint = card.querySelector(".image-card-selected-hint");
          if (hint) hint.textContent = shouldBeSelected ? '已选中' : '点击选中';
        });
      }

      async function openImagePreview(imageId) {
        const img = state.images.find((x) => x.id === imageId);
        if (!img) return;
        showMessage("", "ok");
        let url = state.previewBlobUrls[imageId];
        if (!url) {
          url = await loadImagePreview(imageId);
        }
        if (!url) {
          showMessage("预览加载失败", "error");
          return;
        }
        $("imageModalImg").src = url;
        $("imageModalImg").alt = (img.uploadedBy && img.uploadedBy.deviceName) || "预览";
        const uploader = img.uploadedBy || {};
        $("imageModalMeta").innerHTML =
          '<dl>' +
            '<dt>ID</dt><dd>' + escapeHtml(img.id) + '</dd>' +
            '<dt>类型</dt><dd>' + escapeHtml(img.mimeType) + '</dd>' +
            '<dt>尺寸</dt><dd>' + (img.width && img.height ? img.width + ' × ' + img.height : '-') + '</dd>' +
            '<dt>大小</dt><dd>' + formatBytes(img.fileSize) + '</dd>' +
            '<dt>来源</dt><dd>' + escapeHtml(img.sourceKind) + (img.sourceDisplayName ? ' · ' + escapeHtml(img.sourceDisplayName) : '') + '</dd>' +
            '<dt>上传者</dt><dd>' + escapeHtml(uploader.userDisplayName || '-') + ' (' + escapeHtml(uploader.deviceName || '-') + ')</dd>' +
            '<dt>sha256</dt><dd>' + escapeHtml(img.sha256) + '</dd>' +
            '<dt>创建</dt><dd>' + fmt(img.createdAt) + '</dd>' +
            '<dt>过期</dt><dd>' + fmt(img.expiresAt) + '</dd>' +
          '</dl>';
        $("imageModalDelete").dataset.imageId = imageId;
        $("imageModal").classList.remove("hidden");
      }

      function closeImagePreview() {
        $("imageModal").classList.add("hidden");
        $("imageModalImg").src = "";
        delete $("imageModalDelete").dataset.imageId;
      }

      async function deleteImage(imageId) {
        if (!confirm("确认删除该图片?相关未完成的接收将被标记为过期,操作不可撤销。")) return;
        showMessage("", "ok");
        try {
          await api("/images/" + encodeURIComponent(imageId), { method: "DELETE" });
          showMessage("图片已删除", "ok");
          state.images = state.images.filter((x) => x.id !== imageId);
          state.selectedImageIds.delete(imageId);
          revokePreview(imageId);
          removeCardFromDom(imageId);
          showEmptyIfNeeded();
          updateSelectionBar();
          closeImagePreview();
        } catch (err) {
          showMessage(err.message || String(err), "error");
        }
      }

      async function deleteSelectedImages() {
        const ids = Array.from(state.selectedImageIds);
        if (!ids.length) return;
        if (!confirm("确认删除所选 " + ids.length + " 张图片?操作不可撤销。")) return;
        showMessage("", "ok");
        const results = await Promise.allSettled(
          ids.map((id) => api("/images/" + encodeURIComponent(id), { method: "DELETE" }))
        );
        const succeeded = [];
        const failed = [];
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            succeeded.push(ids[i]);
          } else {
            failed.push({ id: ids[i], reason: r.reason && (r.reason.message || String(r.reason)) });
          }
        });
        const succeededSet = new Set(succeeded);
        state.images = state.images.filter((img) => !succeededSet.has(img.id));
        succeeded.forEach((id) => {
          state.selectedImageIds.delete(id);
          revokePreview(id);
          removeCardFromDom(id);
        });
        failed.forEach((entry) => state.selectedImageIds.delete(entry.id));
        syncSelectionVisual();
        showEmptyIfNeeded();
        updateSelectionBar();
        let msg;
        if (failed.length === 0) {
          msg = "已删除 " + succeeded.length + " 张图片";
        } else {
          msg = "已删除 " + succeeded.length + " 张,失败 " + failed.length + " 张";
          console.error("Batch delete failures:", failed);
        }
        showMessage(msg, failed.length === 0 ? "ok" : "warn");
      }

      $("imageGrid").addEventListener("click", (event) => {
        const card = event.target.closest(".image-card");
        if (!card) return;
        const id = card.dataset.imageId;
        if (!id) return;
        if (state.selectMode) {
          toggleCardSelection(id);
          return;
        }
        const actionEl = event.target.closest("[data-action]");
        const action = actionEl && actionEl.dataset.action;
        if (action === "image-delete") {
          deleteImage(id);
        } else {
          openImagePreview(id);
        }
      });

      $("refreshImagesBtn").addEventListener("click", () => {
        state.imageCursor = null;
        state.selectedImageIds.clear();
        loadImages(true);
      });

      $("toggleSelectModeBtn").addEventListener("click", toggleSelectMode);

      $("imageFilter").addEventListener("change", (event) => {
        state.imageFilter = event.target.value;
        state.imageCursor = null;
        state.selectedImageIds.clear();
        loadImages(true);
      });

      $("imageUserFilter").addEventListener("change", (event) => {
        state.imageUserFilter = event.target.value;
        state.imageCursor = null;
        state.selectedImageIds.clear();
        loadImages(true);
      });

      $("imageLoadMoreBtn").addEventListener("click", () => {
        if (state.imageCursor) loadImages(false);
      });

      $("imageSelectAllBtn").addEventListener("click", toggleSelectAllOnPage);
      $("imageDeleteSelectedBtn").addEventListener("click", deleteSelectedImages);
      $("imageCancelSelectBtn").addEventListener("click", () => {
        if (state.selectMode) toggleSelectMode();
      });

      $("imageModalClose").addEventListener("click", closeImagePreview);
      $("imageModalDelete").addEventListener("click", (event) => {
        const id = event.currentTarget.dataset.imageId;
        if (id) deleteImage(id);
      });
      $("imageModal").addEventListener("click", (event) => {
        if (event.target === $("imageModal")) closeImagePreview();
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
      "default-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:"
    );
    return reply.send(ADMIN_HTML);
  };

  app.get("/admin", handler);
  app.get("/admin/", handler);
}
