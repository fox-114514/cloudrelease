# StudyShot Relay 安装包

版本：0.4.0
生成时间：2026-06-21

## 可用安装包

| 平台 | 文件名 | 大小 | 说明 |
|---|---|---|---|
| Windows | `StudyShot-Relay-Windows-0.4.0-portable.exe` | ~87 MB | 单文件便携版，直接运行 |
| Android | `StudyShot-Relay-Android-0.4.0.apk` | ~12 MB | Release 签名版，可直接安装 |
| Linux (桌面) | `StudyShot-Relay-Desktop-Linux-0.4.0_amd64.deb` | ~95 MB | Electron 桌面端，带 GUI |
| Linux (AppImage) | `StudyShot-Relay-Desktop-Linux-0.4.0.AppImage` | ~121 MB | 免安装桌面端 |
| Linux (CLI/Web) | `StudyShot-Relay-Linux-Client-0.4.0_amd64.deb` | ~4.6 MB | 命令行 + Web 管理界面 |

所有文件位于项目根目录 `releases/`。

## SHA-256

| 文件 | SHA-256 |
|---|---|
| `StudyShot-Relay-Windows-0.4.0-portable.exe` | `8dc0540dc594fff52d87143a49bf5df3953bca64a2ecb16066b2a3fd4cf60bfc` |
| `StudyShot-Relay-Android-0.4.0.apk` | `f09aefb581966df94c2cba083f1ef38af736bd332ed535973edeea273853f41e` |
| `StudyShot-Relay-Desktop-Linux-0.4.0_amd64.deb` | `9cc843f439b8ecfc84c717e3934edbec07acd804b9373c2f0a90b8e3afd54ff7` |
| `StudyShot-Relay-Desktop-Linux-0.4.0.AppImage` | `b0a68c6e4a43b96feeaa87a7b20cb631217cf5e30b0c53435a441240d865db49` |
| `StudyShot-Relay-Linux-Client-0.4.0_amd64.deb` | `f2547ea38f0470a0bf1efbf906e650e29a268fa6cc09bf986842e67e45497fb6` |

## 使用方式

### Windows

双击 `StudyShot-Relay-Windows-0.4.0-portable.exe` 直接运行。

### Android

```bash
adb install -r StudyShot-Relay-Android-0.4.0.apk
```

### Linux 桌面端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Desktop-Linux-0.4.0_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

安装后从应用菜单启动 **StudyShot Relay**。

### Linux 客户端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Linux-Client-0.4.0_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

启动 Web 管理界面：

```bash
studyshot-relay launch
```

或从应用菜单启动。

## 0.4.0 变更

- Android 的登录、绑定、生成绑定码和下载请求统一切换到 IO 线程，避免主线程网络异常与界面卡死。
- 登录或绑定失败后会恢复按钮和输入状态，可以直接修正并重试。
- 新生成的绑定码会持续显示并自动复制，不再仅依赖短暂提示。
- Android 和 Web 管理端可删除已撤销设备；后端使用软删除保留图片与审计记录。
- 后端设备接口忽略已删除设备，并新增迁移与回归测试。
- 后端、Android、桌面端和 Linux 客户端版本统一为 `0.4.0`。

## 注意事项

- Windows 版本为单文件 NSIS 便携包，不需要安装。
- Android 使用测试签名密钥，仅用于测试，正式发布前请替换为自有密钥。
- Linux 桌面端 `.deb` 和 Linux 客户端 `.deb` 是两个不同的应用，可按需安装。
