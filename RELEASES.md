# StudyShot Relay 安装包

版本：Android 0.4.3；后端和其他客户端 0.4.1
生成时间：2026-06-21

## 可用安装包

| 平台 | 文件名 | 大小 | 说明 |
|---|---|---|---|
| Windows | `StudyShot-Relay-Windows-0.4.1-portable.exe` | ~87 MB | 单文件便携版，直接运行 |
| Android | `StudyShot-Relay-Android-0.4.3.apk` | ~12 MB | Release 签名版，增加后台每秒主动扫描 |
| Linux (桌面) | `StudyShot-Relay-Desktop-Linux-0.4.1_amd64.deb` | ~95 MB | Electron 桌面端，带 GUI |
| Linux (AppImage) | `StudyShot-Relay-Desktop-Linux-0.4.1.AppImage` | ~121 MB | 免安装桌面端 |
| Linux (CLI/Web) | `StudyShot-Relay-Linux-Client-0.4.1_amd64.deb` | ~4.6 MB | 命令行 + Web 管理界面 |

所有文件位于项目根目录 `releases/`。

## SHA-256

| 文件 | SHA-256 |
|---|---|
| `StudyShot-Relay-Windows-0.4.1-portable.exe` | `55e5c55611663b6d8c315f9fe6a8e1a671d77806ae9357d4b3bb08723daa989f` |
| `StudyShot-Relay-Android-0.4.3.apk` | `efd09469be465d5c7f57e74dc92f64ffb03309322ceb7dad3da510ca93156c72` |
| `StudyShot-Relay-Desktop-Linux-0.4.1_amd64.deb` | `7d65a06480389cd6ba1c88cf7e7e5044e47676a7a80c87e4165dcced2ae8beff` |
| `StudyShot-Relay-Desktop-Linux-0.4.1.AppImage` | `9a1bcae215f7fbcce2678d62ade684ba4467ab87e72415c41fbe9f020ed4e185` |
| `StudyShot-Relay-Linux-Client-0.4.1_amd64.deb` | `9480fb77e40f71a16a3d8d7e6ee125df37ec0d23d3047d64af16511a9b9d6336` |

## 使用方式

### Windows

双击 `StudyShot-Relay-Windows-0.4.1-portable.exe` 直接运行。

### Android

```bash
adb install -r StudyShot-Relay-Android-0.4.3.apk
```

### Linux 桌面端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Desktop-Linux-0.4.1_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

安装后从应用菜单启动 **StudyShot Relay**。

### Linux 客户端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Linux-Client-0.4.1_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

启动 Web 管理界面：

```bash
studyshot-relay launch
```

或从应用菜单启动。

## Android 0.4.3 变更

- OPD2508/ColorOS 实机确认后台 MediaStore 回调存在数秒延迟。
- 实时模式新增每秒一次的最近媒体主动扫描，与 ContentObserver 事件监听并行。
- 图片发现后仍由前台服务直接上传，并保留 WorkManager 可靠兜底。
- 后端和 Ubuntu/Linux 客户端无须更新，继续兼容 `0.4.1`。

## Android 0.4.2 变更

- 实时学习模式在前台服务中直接执行上传，不再等待后台 WorkManager/JobScheduler 调度。
- 上传前创建延迟 WorkManager 任务作为进程退出兜底；直传成功后自动取消。
- 断网和临时服务端错误继续按原有策略可靠重试，并保留“仅 Wi-Fi”约束。
- 后端和 Ubuntu/Linux 客户端无须更新，继续兼容 `0.4.1`。

## 0.4.1 变更

- 修复 Android 将大小写敏感绑定码强制转换为大写，导致新设备无法绑定的问题。
- Android 和后端会忽略绑定码首尾空白，同时完整保留原始大小写。
- 新增复制绑定码包含空白的后端回归测试；完整测试为 40 项。
- 后端、Android、桌面端和 Linux 客户端版本统一为 `0.4.1`。

## 注意事项

- Windows 版本为单文件 NSIS 便携包，不需要安装。
- Android 使用测试签名密钥，仅用于测试，正式发布前请替换为自有密钥。
- Linux 桌面端 `.deb` 和 Linux 客户端 `.deb` 是两个不同的应用，可按需安装。
