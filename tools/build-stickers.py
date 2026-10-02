#!/usr/bin/env python3
"""
把「蓝色大肥鱼」表情包（赤风RED，https://space.bilibili.com/356746604）压成气泡里能用的小图。

用法：  python tools/build-stickers.py "<原始 gif 目录>" [--size 96] [--fps 25] [--colors 63] [--max-kb 210] [--max-total-mb 12]
依赖：  pip install pillow（仅开发期工具，不进发布包——package.json#files 不含 tools/）

做什么（原图：500×500、透明底、20ms/帧、单圈 0.2–4s）：
  1. 只处理 tools/stickers.curation.json 里挑中的图；
  2. 先取全部帧的透明包围盒裁掉空白，再缩成方形 SIZE×SIZE（人物才占满画面，44px 里看得清脸）；
  3. 抽帧到 FPS（默认 25fps = 40ms/帧，肉眼无差）；
  4. 全局调色板（默认 63 色 + 1 个透明色），不抖动（赛璐璐风格不需要），只写帧间差异；
  5. 输出 assets/stickers/<id>.gif 与 manifest.json（时长在这里测定，运行时不再解析 GIF）；
  6. 校验预算：单张 ≤ MAX_KB（默认 210）、总计 ≤ MAX_TOTAL_MB（默认 12），超标直接失败，不静默放过。
"""
import argparse
import glob
import json
import os
import sys

from PIL import Image, ImageSequence

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "assets", "stickers")
CURATION = os.path.join(HERE, "stickers.curation.json")
PREFIX = "蓝色大肥鱼_"
TRANSP = 63  # 透明色固定占 63 号槽位，调色板色数必须 ≤ 63
ALPHA_ON = 128  # 半透明像素按这条线二值化（GIF 只有 1 位透明）


def find_source(src_dir, name):
    hits = glob.glob(os.path.join(glob.escape(src_dir), glob.escape(PREFIX + name + "_") + "*.gif"))
    if len(hits) != 1:
        raise SystemExit(f"[x] 「{name}」匹配到 {len(hits)} 个文件：{hits}")
    return hits[0]


def load_frames(path):
    """返回 [(RGBA 整帧, 时长ms)]；Pillow 在 seek 时已处理好 disposal。"""
    im = Image.open(path)
    frames = []
    for fr in ImageSequence.Iterator(im):
        frames.append((fr.convert("RGBA"), int(fr.info.get("duration", 20)) or 20))
    return frames


def resample_time(frames, step_ms):
    """按固定间隔取样：第 k 个输出帧取「时刻 k*step 正在显示」的那一帧。"""
    total = sum(d for _, d in frames)
    n = max(2, round(total / step_ms))
    starts, t = [], 0
    for _, d in frames:
        starts.append(t)
        t += d
    out, j = [], 0
    for k in range(n):
        tk = k * total / n
        while j + 1 < len(frames) and starts[j + 1] <= tk:
            j += 1
        out.append(frames[j][0])
    return out, n * step_ms


def union_bbox(frames):
    box = None
    for fr in frames:
        a = fr.getchannel("A").point(lambda v: 255 if v >= 16 else 0)
        b = a.getbbox()
        if b is None:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box or (0, 0, frames[0].width, frames[0].height)


def square_crop(box, w, h, margin=3):
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0) + margin * 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left, top = round(cx - side / 2), round(cy - side / 2)
    return (left, top, left + side, top + side)


def crop_pad(fr, crop):
    """裁剪框可能越出画布（人物贴边时），越界部分补透明。"""
    left, top, right, bottom = crop
    canvas = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    canvas.paste(fr, (-left, -top))
    return canvas


def encode(frames, size, ms_per_frame, out_path, ncolors=63):
    small = [f.resize((size, size), Image.LANCZOS) for f in frames]  # RGBA 内部走预乘，不会有黑边
    # 全局调色板：把所有「不透明」像素拼成一张图来量化（透明处用邻近色填，别污染调色板）
    cols = 8
    rows = (len(small) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * size, rows * size), (0, 0, 0))
    for i, fr in enumerate(small):
        rgb = Image.new("RGB", fr.size, (255, 255, 255))
        rgb.paste(fr.convert("RGB"), mask=fr.getchannel("A").point(lambda v: 255 if v >= ALPHA_ON else 0))
        sheet.paste(rgb, ((i % cols) * size, (i // cols) * size))
    pal_img = sheet.quantize(colors=ncolors, method=Image.MEDIANCUT, dither=Image.NONE)
    pframes = []
    for fr in small:
        alpha = fr.getchannel("A")
        q = fr.convert("RGB").quantize(palette=pal_img, dither=Image.NONE)
        mask = alpha.point(lambda v: 255 if v < ALPHA_ON else 0)  # 要变透明的像素
        q.paste(TRANSP, mask=mask)
        pframes.append(q)
    first = pframes[0]
    first.save(
        out_path,
        save_all=True,
        append_images=pframes[1:],
        duration=ms_per_frame,
        loop=0,
        transparency=TRANSP,
        disposal=2,
        optimize=False,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--size", type=int, default=96)
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--colors", type=int, default=63, help="调色板色数（另留 1 个透明色）")
    ap.add_argument("--max-kb", type=int, default=210)
    ap.add_argument("--max-total-mb", type=float, default=12.0)
    ap.add_argument("--max-ms", type=int, default=2600, help="单圈超过这个时长的不收")
    args = ap.parse_args()
    step = round(1000 / args.fps)

    cur = json.load(open(CURATION, encoding="utf-8"))["stickers"]
    ids = [c["id"] for c in cur]
    if len(set(ids)) != len(ids):
        raise SystemExit("[x] curation 里有重复 id")
    os.makedirs(OUT_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(OUT_DIR, "*.gif")):
        os.remove(old)

    manifest, total, too_big, too_long = {}, 0, [], []
    for c in cur:
        path = find_source(args.src, c["src"])
        frames, _ = (lambda fs: (fs, 0))(load_frames(path))
        sampled, loop_ms = resample_time(frames, step)
        if loop_ms > args.max_ms:
            too_long.append((c["id"], loop_ms))
            continue
        crop = square_crop(union_bbox(sampled), *sampled[0].size)
        cropped = [crop_pad(f, crop) for f in sampled]
        out = os.path.join(OUT_DIR, c["id"] + ".gif")
        encode(cropped, args.size, step, out, args.colors)
        kb = os.path.getsize(out) / 1024
        total += os.path.getsize(out)
        if kb > args.max_kb:
            too_big.append((c["id"], round(kb)))
        manifest[c["id"]] = {
            "file": c["id"] + ".gif",
            "ms": loop_ms,
            "w": args.size,
            "h": args.size,
            **({"opaque": True} if c.get("opaque") else {}),
            "meme": c["meme"],
        }
        print(f"{c['id']:<16} {len(sampled):>3}f {loop_ms:>5}ms {kb:6.1f}KB")

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "size": args.size, "stickers": manifest}, f, ensure_ascii=False, indent=1)

    mb = total / 1048576
    print(f"\n共 {len(manifest)} 张，总计 {mb:.2f} MB（上限 {args.max_total_mb} MB）")
    if too_long:
        print("[!] 超时长被剔除：", too_long)
    bad = False
    if too_big:
        print(f"[x] 单张超过 {args.max_kb}KB：", too_big)
        bad = True
    if mb > args.max_total_mb:
        print("[x] 总量超预算")
        bad = True
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
