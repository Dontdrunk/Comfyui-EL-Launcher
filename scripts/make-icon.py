r"""
生成应用图标 build/icon.ico。

图形语言与启动器左上角 LOGO 一致：16×16 像素网格上的北极星（指南针玫瑰），
配色沿用 ComfyUI 官方调色板（charcoal-800 底 + electric-400 主色）。

网格数据与 src/renderer/src/components/Brand.tsx 里的 STAR_PATH 是同一份，
改一处必须同步另一处，否则标题栏图标与任务栏图标会对不上。

使用方法（任何带 Pillow 的解释器都行，ComfyUI 便携版自带的即可）：
    python_embeded\python.exe scripts\make-icon.py
"""
from PIL import Image, ImageDraw
import os

BG = (0x17, 0x17, 0x18, 255)      # charcoal-800
BRAND = (0xF0, 0xFF, 0x41, 255)   # electric-400
TRANSPARENT = (0, 0, 0, 0)

GRID = 16

# (行 y, 起 x, 止 x)，与 Brand.tsx 的 STAR_PATH 一一对应
STAR_RUNS = [
    (1, 7, 8), (2, 7, 8), (3, 6, 9), (4, 6, 9), (5, 5, 10), (6, 4, 11),
    (7, 1, 6), (7, 9, 14), (8, 1, 6), (8, 9, 14),
    (9, 4, 11), (10, 5, 10), (11, 6, 9), (12, 6, 9), (13, 7, 8), (14, 7, 8),
]

ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]


def draw_icon(size: int) -> Image.Image:
    """像素图形不做超采样：矩形边缘直接吸附到整数像素，放大后仍是硬边。"""
    img = Image.new("RGBA", (size, size), TRANSPARENT)
    d = ImageDraw.Draw(img)

    # 圆角底板。不能省：任务栏可能是亮色，electric-400 直接画在白底上几乎看不见
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(round(size * 0.18)), fill=BG)

    # 小尺寸下星星要占更大比例，否则 16px 里只剩几个孤点
    inner = size * (0.86 if size <= 24 else 0.72)
    off = (size - inner) / 2.0
    cell = inner / GRID

    for y, x0, x1 in STAR_RUNS:
        px0 = int(round(off + x0 * cell))
        px1 = int(round(off + (x1 + 1) * cell))
        py0 = int(round(off + y * cell))
        py1 = int(round(off + (y + 1) * cell))
        if px1 > px0 and py1 > py0:
            d.rectangle([px0, py0, px1 - 1, py1 - 1], fill=BRAND)

    return img


def write_preview(frames, path: str) -> None:
    """把所有尺寸并排画一遍：像素图不看一眼实际渲染是没法验收的。"""
    zoom = [(s, f) for s, f in frames if s <= 32]
    w = sum(s + 22 for s, _ in frames) + 40
    h = 64 + sum(s * 4 + 26 for s, _ in zoom)
    sheet = Image.new("RGB", (w, h), (0x6E, 0x6E, 0x74))
    d = ImageDraw.Draw(sheet)

    x = 20
    for s, f in frames:
        d.text((x, 14), str(s), fill=(0xFF, 0xFF, 0xFF))
        sheet.paste(f, (x, 32), f)
        x += s + 22

    y = 64
    for s, f in zoom:
        big = f.resize((s * 4, s * 4), Image.NEAREST)
        d.text((20, y + 4), "%dpx @4x" % s, fill=(0xFF, 0xFF, 0xFF))
        sheet.paste(big, (110, y), big)
        y += s * 4 + 26

    sheet.save(path)


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = os.path.join(root, "build")
    os.makedirs(build_dir, exist_ok=True)

    frames = [(s, draw_icon(s)) for s in ICON_SIZES]

    ico_path = os.path.join(build_dir, "icon.ico")
    frames[-1][1].save(ico_path, format="ICO", sizes=[(s, s) for s, _ in frames])

    png_path = os.path.join(build_dir, "icon.png")
    frames[-1][1].save(png_path, format="PNG")

    # 预览图放 .shots/（已 gitignore），build/ 只留真正要入库的图标
    shots_dir = os.path.join(root, ".shots")
    os.makedirs(shots_dir, exist_ok=True)
    preview_path = os.path.join(shots_dir, "icon-sizes.png")
    write_preview(frames, preview_path)

    print("已生成 " + ico_path)
    print("已生成 " + png_path)
    print("已生成 " + preview_path)
    print("尺寸: " + str(ICON_SIZES))


if __name__ == "__main__":
    main()
