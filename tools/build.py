#!/usr/bin/env python3
"""霓虹狂飙 Neon Rush 单文件构建脚本。

把 src/ 下的模板、样式、游戏模块与 assets/ 内的 glTF 模型、Draco 解码器
内嵌为一个可直接双击运行的 HTML（默认输出到项目根目录 霓虹狂飙.html）。

用法:
    python tools/build.py
"""
import base64
import io
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
GAME = os.path.join(SRC, 'game')
OUT = os.path.join(ROOT, '霓虹狂飙.html')

ASSETS = [
    ('FERRARI_B64', os.path.join(ROOT, 'assets', 'ferrari.glb')),
    ('TOYCAR_B64', os.path.join(ROOT, 'assets', 'ToyCar.glb')),
    ('MILK_B64', os.path.join(ROOT, 'assets', 'CesiumMilkTruck.glb')),
    ('GTR_B64', os.path.join(ROOT, 'assets', 'gtr.glb')),
    ('BLD_A_B64', os.path.join(ROOT, 'assets', 'building_a.glb')),
    ('BLD_B_B64', os.path.join(ROOT, 'assets', 'building_b.glb')),
    ('PALM_B64', os.path.join(ROOT, 'assets', 'palm.glb')),
    ('ROCK_B64', os.path.join(ROOT, 'assets', 'rock.glb')),
]
DRACO_WASM = os.path.join(ROOT, 'vendor', 'draco', 'draco_decoder.wasm')
DRACO_WRAPPER = os.path.join(ROOT, 'vendor', 'draco', 'draco_wasm_wrapper.js')


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def main():
    for path in [p for _, p in ASSETS] + [DRACO_WASM, DRACO_WRAPPER]:
        if not os.path.isfile(path):
            sys.exit('缺少资源文件: ' + path)

    lines = []
    lines.append('/* ===== 内嵌资源（构建时生成，请勿手改） ===== */')
    for name, path in ASSETS:
        data = b64(path)
        lines.append('const %s = "%s";' % (name, data))
        print('  %-14s %8.2f MB (base64)' % (name, len(data) / 1048576.0))
    wrapper = read(DRACO_WRAPPER)
    lines.append('const DRACO_WRAPPER_JS = %s;' % json.dumps(wrapper, ensure_ascii=False))
    lines.append('const DRACO_WASM_B64 = "%s";' % b64(DRACO_WASM))
    assets_block = '\n'.join(lines)

    modules = sorted(f for f in os.listdir(GAME) if f.endswith('.js'))
    game_block = '\n\n'.join(
        '/* ===== src/game/%s ===== */\n' % name + read(os.path.join(GAME, name)).strip('\n')
        for name in modules
    )
    print('  游戏模块:', ', '.join(modules))

    css_block = read(os.path.join(SRC, 'styles', 'main.css'))
    html = read(os.path.join(SRC, 'index.html'))
    for token, block in (('/*__CSS__*/', css_block), ('/*__ASSETS__*/', assets_block), ('/*__GAME__*/', game_block)):
        assert token in html, '模板缺少占位符 ' + token
        html = html.replace(token, block, 1)

    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)

    # 供 node --check 使用的纯 JS 副本（写到临时目录，不污染工程）
    check = os.path.join(tempfile.gettempdir(), 'neon_rush_check.js')
    with io.open(check, 'w', encoding='utf-8') as f:
        f.write("'use strict';\n" + assets_block + '\n\n' + game_block + '\n')

    print('输出: %s (%.2f MB)' % (OUT, os.path.getsize(OUT) / 1048576.0))
    print('语法检查副本: %s' % check)


if __name__ == '__main__':
    main()
