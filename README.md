# 探索者启动器

[![Latest release](https://img.shields.io/github/v/release/Dontdrunk/Comfyui-EL-Launcher?label=Release)](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest)

面向 **ComfyUI 官方 Windows 便携版** 的桌面启动与管理工具。可在一个界面中启动 ComfyUI、管理版本和插件，并查看模型目录。

**[下载最新版](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest)** · [报告问题](https://github.com/Dontdrunk/Comfyui-EL-Launcher/issues)

## 功能

- **启动 ComfyUI**：选择 GPU 或 CPU 模式、设置端口和启动参数，查看运行日志与环境信息。
- **管理版本**：浏览 ComfyUI 版本并切换或回滚；切换前备份配置，按需同步依赖。
- **管理插件**：搜索并安装 Registry 插件或 Git 仓库，启用、禁用插件并检查依赖。
- **管理模型**：查看模型分类与占用空间，定位文件或将其移入回收站。
- **常用工具**：启动参数预设、日志检索、暗色与亮色主题。

## 下载与使用

在[最新发布页](https://github.com/Dontdrunk/Comfyui-EL-Launcher/releases/latest)下载：

- `ExplorerLauncher-版本号-setup.exe`：安装版，可选择安装目录。
- `ExplorerLauncher-版本号-portable.exe`：便携版，无需安装。

首次启动后，在「设置」中选择 ComfyUI 官方便携版根目录。该目录应至少包含：

```text
<ComfyUI 根目录>/
├─ python_embeded/python.exe
└─ ComfyUI/main.py
```

## 从源码运行

需要 Node.js 与 pnpm：

```bash
pnpm install
pnpm dev       # 开发运行
pnpm package   # 构建 Windows x64 安装版与便携版
```

## 反馈问题

请在 [GitHub Issues](https://github.com/Dontdrunk/Comfyui-EL-Launcher/issues) 提交问题，并说明启动器版本、ComfyUI 版本和复现步骤。
