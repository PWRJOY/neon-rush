#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把原始 GLB 重新压缩成游戏内使用的模型（可复现的记录 + 调画质入口）。

用法示例：
    python tools/optimize_model.py "assets/cars_inbox/赛车模型.glb"               # 生成 assets/gtr.glb（默认参数，当前入库版本）
    python tools/optimize_model.py "assets/cars_inbox/赛车模型.glb" --texture-size 4096 --simplify-ratio 1.0   # 追画质
    python tools/optimize_model.py "assets/cars_inbox/赛车模型.glb" --texture-size 1024 --simplify-ratio 0.35  # 追体积

关键：贴图压缩和 Draco 必须由同一次 optimize 完成。
如果先 Draco 再单独压贴图，gltf-transform 会把几何解码回未压缩状态，体积反而暴涨（86.95MB → 24.89MB 的教训）。

生成完成后重新执行 python tools/build.py，模型会以 base64 注入到 霓虹狂飙.html。
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(ROOT, 'assets', 'cars_inbox', '赛车模型.glb')
DEFAULT_DST = os.path.join(ROOT, 'assets', 'gtr.glb')


def human(n):
    return '%.2f MB' % (n / 1024.0 / 1024.0)


def main():
    ap = argparse.ArgumentParser(description='用 gltf-transform 重新压缩车辆模型')
    ap.add_argument('source', nargs='?', default=DEFAULT_SRC, help='原始 GLB 路径')
    ap.add_argument('target', nargs='?', default=DEFAULT_DST, help='输出 GLB 路径')
    ap.add_argument('--texture-size', type=int, default=2048, help='贴图边长（1024/2048/4096），默认 2048')
    ap.add_argument('--texture-format', default='webp', choices=['webp', 'jpeg', 'png', 'auto'], help='贴图格式，默认 webp')
    ap.add_argument('--simplify-ratio', type=float, default=0.6, help='减面比例，1.0 表示不减面，默认 0.6')
    ap.add_argument('--simplify-error', type=float, default=0.0001, help='减面误差阈值，越小越保形，默认 0.0001')
    ap.add_argument('--no-draco', action='store_true', help='关闭 Draco 几何压缩')
    args = ap.parse_args()

    src = os.path.abspath(args.source)
    dst = os.path.abspath(args.target)
    if not os.path.isfile(src):
        sys.exit('找不到源模型：%s' % src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)

    cmd = [
        'npx', '--yes', '@gltf-transform/cli', 'optimize', src, dst,
        '--texture-size', str(args.texture_size),
        '--texture-compress', args.texture_format,
        '--simplify-ratio', str(args.simplify_ratio),
        '--simplify-error', str(args.simplify_error),
    ]
    if not args.no_draco:
        cmd += ['--compress', 'draco']
    line = subprocess.list2cmdline(cmd)

    print('源文件：%s（%s）' % (src, human(os.path.getsize(src))))
    print('参数：贴图 %d / %s，减面比例 %.2f，Draco %s' % (
        args.texture_size, args.texture_format, args.simplify_ratio, '关' if args.no_draco else '开'))
    print('执行：%s' % line)
    # Windows 下 npx 是 .cmd，必须经 shell 解析
    code = subprocess.call(line, shell=True, cwd=ROOT)
    if code != 0:
        sys.exit('gltf-transform 退出码 %d，压缩未完成' % code)
    if not os.path.isfile(dst):
        sys.exit('压缩失败：没有生成 %s' % dst)
    print('输出：%s（%s）' % (dst, human(os.path.getsize(dst))))
    print('下一步：python tools/build.py')


if __name__ == '__main__':
    main()
