#!/usr/bin/env python3
"""霓虹狂飙 Neon Rush 构建脚本。

默认把 src/ 下的模板、样式、游戏模块与 assets/ 内的 glTF 模型、Draco 解码器
内嵌为单个 HTML（输出到项目根目录 霓虹狂飙.html，可双击离线运行）。

用法:
    python tools/build.py             # 单文件离线版
    python tools/build.py --online    # 在线版：模型作为独立文件放 _site/assets，页面体积小得多
"""
import base64
import io
import json
import os
import shutil
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

# Three.js 运行时与示例模块：内联进 HTML，保证断网也能直接双击游玩（顺序不能变）
LIBS = [
    os.path.join(ROOT, 'vendor', 'three', 'three.min.js'),
    os.path.join(ROOT, 'vendor', 'three', 'Pass.js'),
    os.path.join(ROOT, 'vendor', 'three', 'LuminosityHighPassShader.js'),
    os.path.join(ROOT, 'vendor', 'three', 'CopyShader.js'),
    os.path.join(ROOT, 'vendor', 'three', 'EffectComposer.js'),
    os.path.join(ROOT, 'vendor', 'three', 'RenderPass.js'),
    os.path.join(ROOT, 'vendor', 'three', 'ShaderPass.js'),
    os.path.join(ROOT, 'vendor', 'three', 'UnrealBloomPass.js'),
    os.path.join(ROOT, 'vendor', 'three', 'GLTFLoader.js'),
    os.path.join(ROOT, 'vendor', 'three', 'DRACOLoader.js'),
]


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def main():
    online = '--online' in sys.argv[1:]
    for path in [p for _, p in ASSETS] + [DRACO_WASM, DRACO_WRAPPER] + LIBS:
        if not os.path.isfile(path):
            sys.exit('缺少资源文件: ' + path)

    lines = []
    lines.append('/* ===== 资源加载方式（构建时生成，请勿手改） ===== */')
    lines.append('const ASSET_URL_MODE = %s;' % ('true' if online else 'false'))
    lines.append('/* ===== 内嵌资源（构建时生成，请勿手改） ===== */')
    for name, path in ASSETS:
        if online:
            rel = 'assets/' + os.path.basename(path)
            lines.append('const %s = "%s";' % (name, rel))
            print('  %-14s %8.2f MB (外链)' % (name, os.path.getsize(path) / 1048576.0))
        else:
            data = b64(path)
            lines.append('const %s = "%s";' % (name, data))
            print('  %-14s %8.2f MB (base64)' % (name, len(data) / 1048576.0))
    wrapper = read(DRACO_WRAPPER)
    lines.append('const DRACO_WRAPPER_JS = %s;' % json.dumps(wrapper, ensure_ascii=False))
    lines.append('const DRACO_WASM_B64 = "%s";' % b64(DRACO_WASM))
    assets_block = '\n'.join(lines)

    # 库文件各自包一个 <script>，转义 </script 防止提前闭合标签
    libs_block = '\n'.join(
        '<script>\n%s\n</script>' % read(path).replace('</script', '<\\/script')
        for path in LIBS
    )
    print('  内联库: %d 个，%.2f MB' % (len(LIBS), sum(os.path.getsize(p) for p in LIBS) / 1048576.0))

    modules = sorted(f for f in os.listdir(GAME) if f.endswith('.js'))
    game_block = '\n\n'.join(
        '/* ===== src/game/%s ===== */\n' % name + read(os.path.join(GAME, name)).strip('\n')
        for name in modules
    )
    print('  游戏模块:', ', '.join(modules))

    css_block = read(os.path.join(SRC, 'styles', 'main.css'))
    html = read(os.path.join(SRC, 'index.html'))
    for token, block in (('/*__CSS__*/', css_block), ('/*__ASSETS__*/', assets_block),
                         ('/*__GAME__*/', game_block), ('<!--__LIBS__-->', libs_block)):
        assert token in html, '模板缺少占位符 ' + token
        html = html.replace(token, block, 1)

    out = os.path.join(ROOT, '_site', 'index.html') if online else OUT
    out_dir = os.path.dirname(out)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    with io.open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    if online:
        asset_dir = os.path.join(out_dir, 'assets')
        if not os.path.isdir(asset_dir):
            os.makedirs(asset_dir)
        for _, path in ASSETS:
            shutil.copy2(path, asset_dir)

    # 供 node --check 使用的纯 JS 副本（写到临时目录，不污染工程）
    check = os.path.join(tempfile.gettempdir(), 'neon_rush_check.js')
    with io.open(check, 'w', encoding='utf-8') as f:
        f.write("'use strict';\n" + assets_block + '\n\n' + game_block + '\n')

    print('输出: %s (%.2f MB)' % (out, os.path.getsize(out) / 1048576.0))
    print('语法检查副本: %s' % check)


if __name__ == '__main__':
    main()
