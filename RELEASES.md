# StudyShot Relay 安装包

版本：0.3.0
生成时间：2026-06-21

## 可用安装包

| 平台 | 文件名 | 大小 | 说明 |
|---|---|---|---|
| Windows | `StudyShot-Relay-Windows-0.3.0-portable.zip` | ~142 MB | 便携目录，解压后直接运行 |
| Android | `StudyShot-Relay-Android-0.3.0.apk` | ~12 MB | Release 签名版，可直接安装 |
| Linux (桌面) | `StudyShot-Relay-Desktop-Linux-0.3.0_amd64.deb` | ~95 MB | Electron 桌面端，带 GUI |
| Linux (AppImage) | `StudyShot-Relay-Desktop-Linux-0.3.0.AppImage` | ~121 MB | 免安装桌面端 |
| Linux (CLI/Web) | `StudyShot-Relay-Linux-Client-0.3.0_amd64.deb` | ~4.6 MB | 命令行 + Web 管理界面 |

所有文件位于项目根目录 `releases/`。

## SHA-256

| 文件 | SHA-256 |
|---|---|
| `StudyShot-Relay-Windows-0.3.0-portable.zip` | `520dc991efd7c20ea28d9223e93bee437ae2b98dc6278ff416ca6793f2217242` |
| `StudyShot-Relay-Android-0.3.0.apk` | `7917de2bfa939cced9a598a0984449811cebf347fbab15c36e20390e36806260` |
| `StudyShot-Relay-Desktop-Linux-0.3.0_amd64.deb` | `aab60eeb15272a68ba42f74f97ed31a259c5febdec1aacb453d5f0d66077d1c9` |
| `StudyShot-Relay-Desktop-Linux-0.3.0.AppImage` | `98b9a30ef3d3bebf13777d0b98a51d0ceb41e720c08d6dea612db8ba8620bb7b` |
| `StudyShot-Relay-Linux-Client-0.3.0_amd64.deb` | `544391054afb28d731c6254896574736f671fd1f8702629fde24603c6dab5c1e` |

## 使用方式

### Windows

解压 `StudyShot-Relay-Windows-0.3.0-portable.zip`，双击目录中的 `StudyShot Relay.exe`。

### Android

```bash
adb install -r StudyShot-Relay-Android-0.3.0.apk
```

### Linux 桌面端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Desktop-Linux-0.3.0_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

安装后从应用菜单启动 **StudyShot Relay**。

### Linux 客户端 (.deb)

```bash
sudo dpkg -i StudyShot-Relay-Linux-Client-0.3.0_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

启动 Web 管理界面：

```bash
studyshot-relay launch
```

或从应用菜单启动。

## 0.3.0 变更

- Android 合并高频 MediaStore 回调并减少补扫次数，避免同一 URI 重复入队。
- Android 移除前台持续装饰动画，固定 Room Flow，设置和手动文件读取移出主线程。
- Android 监听图集支持排除子目录。
- Electron 目录监听支持可视化添加和取消排除子目录。
- 后端、Android、桌面端和 Linux 客户端版本统一为 `0.3.0`。

## 注意事项

- Windows 版本为便携目录压缩包，不是 NSIS 安装程序，因为当前 Linux 打包环境缺少 Wine。
- Android 使用测试签名密钥，仅用于测试，正式发布前请替换为自有密钥。
- Linux 桌面端 `.deb` 和 Linux 客户端 `.deb` 是两个不同的应用，可按需安装。
