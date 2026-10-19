# README 演示视频

21 秒无旁白产品介绍，使用示意界面展示启动、版本、插件和模型管理。画面不包含本机路径、模型或插件数据。

在 Windows 上安装 FFmpeg 后运行：

```powershell
.\docs\video\render.ps1
```

如果 `ffmpeg.exe` 不在 `PATH` 中，传入可执行文件路径：

```powershell
.\docs\video\render.ps1 -FfmpegExe 'C:\path\to\ffmpeg.exe'
```

脚本会生成 `docs/explorer-launcher-demo.mp4` 和 README 使用的 GIF 预览。
