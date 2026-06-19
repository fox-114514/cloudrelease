# StudyShot Relay 安装包

版本：0.1.0
生成时间：2026-06-19

## 可用安装包

| 平台 | 文件名 | 大小 | 说明 |
|---|---|---|---|
| Windows | `StudyShot-Relay-Windows-0.1.0.exe` | ~87 MB | 便携版（Portable），双击直接运行，无需安装 |
| Android | `StudyShot-Relay-Android-0.1.0.apk` | ~12 MB | Release 签名版，可直接安装 |
| Linux (桌面) | `StudyShot-Relay-Desktop-Linux-0.1.0_amd64.deb` | ~95 MB | Electron 桌面端，带 GUI |
| Linux (CLI/Web) | `StudyShot-Relay-Linux-Client-0.1.0_amd64.deb` | ~4.6 MB | 命令行 + Web 管理界面 |

所有文件位于项目根目录 `releases/`。

## 使用方式

### Windows

双击 `StudyShot-Relay-Windows-0.1.0.exe` 即可运行。

### Android

```bash
adb install -r StudyShot-Relay-Android-0.1.0.apk
```

### Linux 桌面端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Desktop-Linux-0.1.0_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

安装后从应用菜单启动 **StudyShot Relay**。

### Linux 客户端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Linux-Client-0.1.0_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

启动 Web 管理界面：

```bash
studyshot-relay launch
```

或从应用菜单启动。

## 打包配置变更

- `desktop/package.json`：补充 `homepage`、`author`、`icon`、`linux` 元数据
- `desktop/scripts/build-icons.mjs`：从 SVG 生成 1024x1024 PNG 图标
- `android/app/build.gradle.kts`：添加 release 签名配置
- `android/app/keystore/studyshot.keystore`：测试用签名密钥库
- `linux-client/scripts/build-deb.sh`：构建 Debian 安装包脚本

## 注意事项

- Windows 版本为便携版（Portable），不是 NSIS 安装程序，因为当前打包环境缺少 Wine。
- Android 使用测试签名密钥，仅用于测试，正式发布前请替换为自有密钥。
- Linux 桌面端 `.deb` 和 Linux 客户端 `.deb` 是两个不同的应用，可按需安装。
