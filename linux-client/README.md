# StudyShot Relay Linux Client

Linux 客户端，支持命令行和 Web 管理界面，用于测试 StudyShot Relay 的自动上传、接收、绑定流程。

## 环境要求

- Node.js >= 18
- npm

## 安装

```bash
cd linux-client
npm install
npm run build
```

编译完成后，可执行文件在 `dist/index.js`。

可以全局链接，方便直接运行：

```bash
npm link
# 或
node dist/index.js <command>
```

## 一键启动 Web 界面（推荐）

像 KimiCode 一样，运行一条命令即可启动本地 Web 管理界面并自动打开浏览器：

```bash
studyshot-relay launch
```

启动后会自动打开浏览器访问 `http://127.0.0.1:<随机端口>`。在 Web 界面里可以：

- 绑定设备
- 设置监听目录（自动上传）
- 设置接收目录（自动下载）
- 启动/停止接收和监听服务
- 登录主账号并打开服务器原生 `/admin` 管理后台
- 查看实时日志

指定端口：

```bash
studyshot-relay launch -p 8080
```

## 添加到系统应用菜单

运行以下脚本，把 StudyShot Relay 安装到应用菜单，使用独立图标：

```bash
./assets/install-desktop.sh
```

安装后可以从系统应用启动器打开，图标为 StudyShot Relay 专属图标（不是系统设置图标）。

## 配置文件

配置文件保存在 `~/.config/studyshot-relay/config.json`，权限 600。

## 命令行命令

### 绑定设备

```bash
studyshot-relay bind -s http://64.90.30.102:3000 -c <绑定码> -n "MyLinuxPC"
```

### 查看状态

```bash
studyshot-relay status
```

### 接收图片

保持 WebSocket 连接，自动下载收到的图片：

```bash
studyshot-relay receive
```

指定下载目录：

```bash
studyshot-relay receive -d /path/to/downloads
```

### 手动上传单张图片

```bash
studyshot-relay upload /path/to/image.png
```

### 监听目录自动上传

```bash
studyshot-relay watch /path/to/screenshots
```

### 同时运行接收和监听

```bash
studyshot-relay run -d /path/to/downloads
```

## 测试后台收发建议

Linux 端没有 Android 那么激进的后台限制，适合作为对照组：

1. 在 Linux 端运行 `studyshot-relay receive`。
2. 在 Android 端截图上传。
3. 观察 Linux 端是否在 1 秒内收到并下载。
4. 反过来，把图片放进 Linux 的 watch 目录，观察 Android 是否收到。

## 解绑

```bash
studyshot-relay unbind
```
