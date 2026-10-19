param(
  [string]$FfmpegExe
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$frameDir = Join-Path $PSScriptRoot '.frames'
$mp4 = Join-Path $root 'docs\explorer-launcher-demo.mp4'
$gif = Join-Path $root 'docs\explorer-launcher-demo.gif'
if ([string]::IsNullOrWhiteSpace($FfmpegExe)) {
  $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if (-not $ffmpegCommand) { throw 'FFmpeg is required. Add ffmpeg.exe to PATH or pass -FfmpegExe.' }
  $FfmpegExe = $ffmpegCommand.Source
}
if (-not (Test-Path -LiteralPath $FfmpegExe -PathType Leaf)) { throw "FFmpeg not found: $FfmpegExe" }
New-Item -ItemType Directory -Force -Path $frameDir | Out-Null

$script:W = 1280
$script:H = 720
$script:colors = @{
  bg = '#09090A'; panel = '#171718'; raised = '#202121'; line = '#3C3D42'
  text = '#F3F3F3'; muted = '#A0A0A0'; blue = '#0B8CE9'; green = '#57D68D'
}
$script:fontFamily = [System.Drawing.FontFamily]::new('Microsoft YaHei UI')
$script:iconPath = Join-Path $root 'build\icon.png'

function Brush([string]$color) { [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($color)) }

function Draw-Text($g, [string]$text, [single]$x, [single]$y, [single]$w, [single]$h, [single]$size, [string]$color, [bool]$bold = $false) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = [System.Drawing.Font]::new($script:fontFamily, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = Brush $color
  $format = [System.Drawing.StringFormat]::new()
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  $g.DrawString($text, $font, $brush, [System.Drawing.RectangleF]::new($x, $y, $w, $h), $format)
  $format.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Draw-Box($g, [single]$x, [single]$y, [single]$w, [single]$h, [string]$fill, [string]$stroke = $null) {
  $brush = Brush $fill
  $g.FillRectangle($brush, $x, $y, $w, $h)
  $brush.Dispose()
  if ($stroke) {
    $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($stroke), 1)
    $g.DrawRectangle($pen, $x, $y, $w, $h)
    $pen.Dispose()
  }
}

function Draw-Line($g, [single]$x1, [single]$y1, [single]$x2, [single]$y2, [string]$color, [single]$width = 1) {
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($color), $width)
  $g.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}

function Draw-Metric($g, [single]$x, [single]$y, [string]$label, [string]$value, [string]$note) {
  Draw-Box $g $x $y 138 80 $script:colors.raised $script:colors.line
  Draw-Text $g $label ($x + 12) ($y + 10) 116 18 12 $script:colors.muted
  Draw-Text $g $value ($x + 12) ($y + 31) 116 24 19 $script:colors.text $true
  Draw-Text $g $note ($x + 12) ($y + 58) 116 14 10 $script:colors.muted
}

function Draw-Panel($g, [hashtable]$scene) {
  $x = 558; $y = 112; $w = 640; $h = 500
  Draw-Box $g $x $y $w $h $script:colors.panel $script:colors.line
  Draw-Box $g $x $y $w 42 $script:colors.raised
  if (Test-Path -LiteralPath $script:iconPath) {
    $icon = [System.Drawing.Image]::FromFile($script:iconPath)
    $g.DrawImage($icon, $x + 15, $y + 9, 24, 24)
    $icon.Dispose()
  } else {
    Draw-Box $g ($x + 15) ($y + 9) 24 24 $script:colors.blue
  }
  Draw-Text $g '探索者启动器' ($x + 49) ($y + 11) 220 22 14 $script:colors.text $true
  Draw-Line $g ($x + 1) ($y + 42) ($x + $w - 1) ($y + 42) $script:colors.line

  $navX = $x; $navY = $y + 43
  Draw-Box $g $navX $navY 140 ($h - 43) '#111112'
  $nav = @('总览', '版本管理', '插件管理', '模型目录', '设置')
  $active = [int]$scene.active
  for ($i = 0; $i -lt $nav.Count; $i++) {
    $rowY = $navY + 20 + ($i * 44)
    if ($i -eq $active) { Draw-Box $g ($navX + 10) ($rowY - 7) 120 34 '#202A34' }
    Draw-Text $g $nav[$i] ($navX + 25) $rowY 100 22 13 $(if ($i -eq $active) { $script:colors.text } else { $script:colors.muted }) ($i -eq $active)
  }

  $cx = $x + 160; $cw = 458
  Draw-Text $g $scene.panelTitle $cx ($y + 59) 300 28 20 $script:colors.text $true
  Draw-Text $g 'Windows 便携版环境' $cx ($y + 90) 290 20 11 $script:colors.muted
  $pill = Brush '#183126'
  $g.FillRectangle($pill, $x + 509, $y + 62, 96, 25); $pill.Dispose()
  Draw-Text $g '环境就绪' ($x + 523) ($y + 66) 82 16 11 $script:colors.green $true

  switch ($scene.kind) {
    'dashboard' {
      Draw-Metric $g $cx ($y + 124) '运行状态' '已停止' '可随时启动'
      Draw-Metric $g ($cx + 151) ($y + 124) '运行模式' 'GPU' '按需切换 CPU'
      Draw-Metric $g ($cx + 302) ($y + 124) '监听端口' '8188' '本地服务'
      Draw-Box $g $cx ($y + 220) 440 47 '#0B8CE9'
      Draw-Text $g '启动 ComfyUI' ($cx + 155) ($y + 232) 180 22 15 '#FFFFFF' $true
      Draw-Box $g $cx ($y + 284) 440 146 '#111112' $script:colors.line
      Draw-Text $g '运行日志' ($cx + 14) ($y + 294) 200 22 13 $script:colors.text $true
      Draw-Text $g '环境检查完成' ($cx + 16) ($y + 329) 380 20 12 $script:colors.green
      Draw-Text $g '等待启动指令…' ($cx + 16) ($y + 359) 380 20 12 $script:colors.muted
      Draw-Text $g '可在设置中调整启动参数' ($cx + 16) ($y + 389) 380 20 12 $script:colors.muted
    }
    'versions' {
      $items = @(@('当前版本', '运行环境已就绪', '当前使用'), @('可用版本', '查看并切换版本', '切换'), @('恢复选项', '备份配置后再操作', '回滚'))
      for ($i = 0; $i -lt $items.Count; $i++) {
        $ry = $y + 128 + ($i * 88)
        Draw-Box $g $cx $ry 440 72 $script:colors.raised $script:colors.line
        Draw-Text $g $items[$i][0] ($cx + 16) ($ry + 10) 245 20 14 $script:colors.text $true
        Draw-Text $g $items[$i][1] ($cx + 16) ($ry + 37) 270 18 11 $script:colors.muted
        Draw-Text $g $items[$i][2] ($cx + 344) ($ry + 25) 80 22 12 $script:colors.blue $true
      }
      Draw-Text $g '操作前备份配置 · 按需同步依赖' $cx ($y + 405) 440 22 12 $script:colors.muted
    }
    'plugins' {
      Draw-Box $g $cx ($y + 126) 440 40 '#111112' $script:colors.line
      Draw-Text $g '搜索 Registry 或输入 Git 仓库地址' ($cx + 14) ($y + 135) 400 22 12 $script:colors.muted
      $items = @(@('Registry 节点', '依赖检查通过', '已启用'), @('Git 仓库', '可检查更新', '已启用'), @('更多节点', '查看安装状态', '管理'))
      for ($i = 0; $i -lt $items.Count; $i++) {
        $ry = $y + 182 + ($i * 70)
        Draw-Line $g $cx $ry ($cx + 440) $ry $script:colors.line
        Draw-Text $g $items[$i][0] ($cx + 12) ($ry + 12) 210 22 13 $script:colors.text $true
        Draw-Text $g $items[$i][1] ($cx + 12) ($ry + 39) 250 18 11 $script:colors.muted
        Draw-Text $g $items[$i][2] ($cx + 350) ($ry + 23) 80 20 11 $script:colors.green
      }
    }
    'models' {
      $items = @(@('Checkpoint', '模型文件', '—'), @('LoRA', '微调模型', '—'), @('VAE', '编码器', '—'), @('ControlNet', '控制模型', '—'))
      for ($i = 0; $i -lt $items.Count; $i++) {
        $col = $i % 2; $row = [math]::Floor($i / 2)
        $mx = $cx + ($col * 224); $my = $y + 132 + ($row * 120)
        Draw-Box $g $mx $my 210 104 $script:colors.raised $script:colors.line
        Draw-Text $g $items[$i][0] ($mx + 14) ($my + 13) 180 20 14 $script:colors.text $true
        Draw-Text $g $items[$i][1] ($mx + 14) ($my + 43) 180 18 11 $script:colors.muted
        Draw-Text $g $items[$i][2] ($mx + 14) ($my + 72) 180 18 11 $script:colors.blue
      }
      Draw-Text $g '按分类查看 · 定位文件 · 移入回收站' $cx ($y + 386) 440 22 12 $script:colors.muted
    }
    'start' {
      Draw-Box $g $cx ($y + 132) 440 72 $script:colors.raised $script:colors.line
      Draw-Text $g '1' ($cx + 17) ($y + 151) 28 28 20 $script:colors.blue $true
      Draw-Text $g '下载 Windows x64 版本' ($cx + 60) ($y + 148) 350 24 15 $script:colors.text $true
      Draw-Box $g $cx ($y + 222) 440 72 $script:colors.raised $script:colors.line
      Draw-Text $g '2' ($cx + 17) ($y + 241) 28 28 20 $script:colors.blue $true
      Draw-Text $g '安装版或便携版任选' ($cx + 60) ($y + 238) 350 24 15 $script:colors.text $true
      Draw-Box $g $cx ($y + 312) 440 72 $script:colors.raised $script:colors.line
      Draw-Text $g '3' ($cx + 17) ($y + 331) 28 28 20 $script:colors.blue $true
      Draw-Text $g '设置 ComfyUI 便携版目录' ($cx + 60) ($y + 328) 350 24 15 $script:colors.text $true
      Draw-Text $g '无需更改现有工作流与模型目录' $cx ($y + 408) 440 20 11 $script:colors.muted
    }
  }
}

$scenes = @(
  @{ title = "ComfyUI 管理`n更简单"; detail = '面向官方 Windows 便携版的桌面启动与管理工具。'; panelTitle = '欢迎使用'; kind = 'dashboard'; active = 0; badge = 'Windows · 便携版' },
  @{ title = '启动与监控'; detail = 'GPU / CPU 模式、端口和启动参数集中设置。运行状态、日志与环境信息一眼可见。'; panelTitle = '运行总览'; kind = 'dashboard'; active = 0; badge = '启动 · 日志 · 环境' },
  @{ title = '版本切换更安心'; detail = '浏览已安装版本，快速切换或回滚。操作前备份配置，按需同步依赖。'; panelTitle = '版本管理'; kind = 'versions'; active = 1; badge = '切换 · 回滚 · 备份' },
  @{ title = '插件安装与维护'; detail = '搜索 Registry 插件或添加 Git 仓库。启用、禁用并检查依赖。'; panelTitle = '插件管理'; kind = 'plugins'; active = 2; badge = 'Registry · Git · 依赖检查' },
  @{ title = '模型目录清晰可查'; detail = '按类别浏览模型和占用空间，定位文件，按需移入回收站。'; panelTitle = '模型目录'; kind = 'models'; active = 3; badge = '分类 · 空间 · 文件定位' },
  @{ title = '现在开始使用'; detail = '选择安装版或便携版，首次启动后设置 ComfyUI 根目录即可开始。'; panelTitle = '开始使用'; kind = 'start'; active = 4; badge = 'Windows x64 · 安装版 / 便携版' }
)

for ($i = 0; $i -lt $scenes.Count; $i++) {
  $bitmap = [System.Drawing.Bitmap]::new($script:W, $script:H)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($script:colors.bg))
  Draw-Box $g 0 0 8 $script:H $script:colors.blue
  Draw-Text $g '探索者启动器  /  COMFYUI LAUNCHER' 86 86 420 24 13 $script:colors.blue $true
  Draw-Text $g $scenes[$i].title 86 186 430 140 45 $script:colors.text $true
  Draw-Text $g $scenes[$i].detail 88 354 412 102 19 $script:colors.muted
  Draw-Box $g 88 500 12 12 $script:colors.blue
  Draw-Text $g $scenes[$i].badge 110 494 390 26 14 $script:colors.text
  Draw-Text $g ('0' + ($i + 1) + '  /  06') 88 638 100 20 12 $script:colors.muted
  for ($dot = 0; $dot -lt $scenes.Count; $dot++) {
    Draw-Box $g (190 + ($dot * 24)) 645 12 3 $(if ($dot -eq $i) { $script:colors.blue } else { $script:colors.line })
  }
  Draw-Panel $g $scenes[$i]
  $bitmap.Save((Join-Path $frameDir ('scene-{0:00}.png' -f ($i + 1))), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bitmap.Dispose()
}

$args = @('-y', '-hide_banner')
for ($i = 1; $i -le $scenes.Count; $i++) {
  $args += @('-loop', '1', '-framerate', '30', '-t', '3.8', '-i', (Join-Path $frameDir ('scene-{0:00}.png' -f $i)))
}
$filters = @()
for ($i = 0; $i -lt $scenes.Count; $i++) {
  $filters += "[$i`:v]zoompan=z='min(1+on/4200,1.027)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,trim=duration=3.8,setpts=PTS-STARTPTS,settb=1/30[v$i]"
}
$last = 'v0'
for ($i = 1; $i -lt $scenes.Count; $i++) {
  $output = if ($i -eq ($scenes.Count - 1)) { 'joined' } else { "x$i" }
  $offset = '{0:0.##}' -f ($i * 3.48)
  $filters += "[$last][v$i]xfade=transition=fade:duration=0.32:offset=$offset[$output]"
  $last = $output
}
$filters += "[$last]fade=t=in:st=0:d=0.25,fade=t=out:st=20.95:d=0.3,format=yuv420p[outv]"
$args += @('-filter_complex', ($filters -join ';'), '-map', '[outv]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-movflags', '+faststart', $mp4)
& $FfmpegExe @args
if ($LASTEXITCODE -ne 0) { throw "MP4 render failed with exit code $LASTEXITCODE" }

$gifFilter = 'fps=10,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3'
& $FfmpegExe -y -hide_banner -i $mp4 -vf $gifFilter -loop 0 $gif
if ($LASTEXITCODE -ne 0) { throw "GIF render failed with exit code $LASTEXITCODE" }

Get-ChildItem -LiteralPath $frameDir -Filter 'scene-*.png' | Remove-Item -Force
Write-Host "Created $mp4 and $gif"
