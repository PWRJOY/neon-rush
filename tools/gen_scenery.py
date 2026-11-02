#!/usr/bin/env python3
"""生成场景低模 GLB（楼×2 / 棕榈 / 岩石），输出到 assets/。

约定（JS 侧依赖）：
- 所有模型底面中心在原点（min.y = 0，x/z 居中），总高度归一为 1.0；
- 楼模型带每面 0..1 的 UV（窗户贴图用），不带顶点色；
- 棕榈 / 岩石带顶点色（COLOR_0），不带 UV。
"""
import json
import os
import struct

import numpy as np
import trimesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
rng = np.random.default_rng(20261030)


def normalize(mesh):
    """底面中心移到原点，高度归一到 1。"""
    mesh.apply_translation(-mesh.bounds[0] - [(mesh.bounds[1][0] - mesh.bounds[0][0]) / 2, 0,
                                              (mesh.bounds[1][2] - mesh.bounds[0][2]) / 2])
    h = mesh.bounds[1][1] - mesh.bounds[0][1]
    mesh.apply_scale(1.0 / h)
    return mesh


def uv_box(extents, center):
    """24 顶点盒体：6 面各有独立 0..1 UV（v 沿高度方向），供窗户贴图。"""
    ex, ey, ez = (e / 2.0 for e in extents)
    quads = [
        [( ex,-ey, ez), ( ex,-ey,-ez), ( ex, ey,-ez), ( ex, ey, ez)],   # +X
        [(-ex,-ey,-ez), (-ex,-ey, ez), (-ex, ey, ez), (-ex, ey,-ez)],   # -X
        [(-ex, ey,-ez), (-ex, ey, ez), ( ex, ey, ez), ( ex, ey,-ez)],   # +Y
        [(-ex,-ey,-ez), ( ex,-ey,-ez), ( ex,-ey, ez), (-ex,-ey, ez)],   # -Y
        [(-ex,-ey, ez), ( ex,-ey, ez), ( ex, ey, ez), (-ex, ey, ez)],   # +Z
        [( ex,-ey,-ez), (-ex,-ey,-ez), (-ex, ey,-ez), ( ex, ey,-ez)],   # -Z
    ]
    verts, uvs, faces = [], [], []
    for i, corners in enumerate(quads):
        verts.extend(corners)
        uvs.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
        b = i * 4
        faces.append((b, b + 1, b + 2))
        faces.append((b, b + 2, b + 3))
    m = trimesh.Trimesh(vertices=np.array(verts, dtype=np.float64),
                        faces=np.array(faces), process=False)
    m.visual = trimesh.visual.TextureVisuals(uv=np.array(uvs, dtype=np.float64))
    m.apply_translation(center)
    return m


def export(mesh, name):
    path = os.path.join(ASSETS, name)
    mesh.export(path)
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        data = f.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    header = data[20:20 + jlen].decode('utf-8')
    attrs = []
    if 'TEXCOORD_0' in header:
        attrs.append('TEXCOORD_0')
    if 'COLOR_0' in header:
        attrs.append('COLOR_0')
    print('  %-18s %6.1f KB  verts=%-5d faces=%-5d attrs=%s'
          % (name, size / 1024.0, len(mesh.vertices), len(mesh.faces), ','.join(attrs) or '-'))
    return path


# ---------- 楼 A：三段退台塔楼 ----------
def building_a():
    m = trimesh.util.concatenate([uv_box(*a) for a in [
        ((1.00, 0.50, 1.00), (0, 0.25, 0)),
        ((0.74, 0.30, 0.74), (0, 0.65, 0)),
        ((0.50, 0.20, 0.50), (0, 0.90, 0)),
    ]])
    return normalize(m)


# ---------- 楼 B：裙楼 + 主塔 + 天线 ----------
def building_b():
    m = trimesh.util.concatenate([uv_box(*a) for a in [
        ((1.00, 0.18, 0.45), (0, 0.09, 0)),       # 裙楼
        ((0.62, 0.74, 0.40), (0.10, 0.18 + 0.37, 0)),  # 主塔
        ((0.05, 0.10, 0.05), (0.10, 0.92 + 0.05, 0)),  # 天线
    ]])
    return normalize(m)


# ---------- 棕榈：弯曲树干 + 下垂叶片（顶点色） ----------
def palm():
    meshes = []
    colors = []
    # 树干：5 段圆柱，逐段倾斜出弧度
    segs = 5
    seg_h = 0.16
    lean = 0.045
    x = 0.0
    for i in range(segs):
        r0 = 0.050 - i * 0.005
        cyl = trimesh.creation.cylinder(radius=r0, height=seg_h * 1.15, sections=7)
        tilt = np.deg2rad(6 * i)
        tmat = trimesh.transformations.rotation_matrix(tilt, [0, 0, 1])
        cyl.apply_transform(tmat)
        cyl.apply_translation((x, seg_h * (i + 0.5), 0))
        x += lean * (i + 1) / segs
        meshes.append(cyl)
        c = np.array([0.36, 0.25, 0.14, 1.0]) * (0.9 + 0.2 * rng.random())
        colors.append(np.tile(c, (len(cyl.vertices), 1)))
    top_x = x
    top_y = seg_h * segs
    # 树冠小球
    crown = trimesh.creation.icosphere(subdivisions=1, radius=0.05)
    crown.apply_translation((top_x, top_y, 0))
    meshes.append(crown)
    colors.append(np.tile(np.array([0.30, 0.20, 0.11, 1.0]), (len(crown.vertices), 1)))
    # 叶片：10 片，沿外抛下垂曲线的四边形条带
    n_fronds = 10
    rings = 7
    for k in range(n_fronds):
        ang = 2 * np.pi * k / n_fronds + rng.uniform(-0.15, 0.15)
        dx, dz = np.cos(ang), np.sin(ang)
        px, pz = -dz, dx  # 水平面内垂直方向
        length = 0.34 + rng.uniform(-0.04, 0.05)
        verts = []
        for i in range(rings):
            t = i / (rings - 1)
            dist = length * t
            y = top_y + 0.10 * np.sin(t * np.pi * 0.7) - 0.22 * t * t
            w = 0.030 * (1 - t ** 1.4) + 0.002
            fold = 0.02 * (1 - t)  # 叶片 V 形折起
            cx = top_x + dx * dist
            cz = dz * dist
            verts.append((cx - px * w, y + fold, cz - pz * w))
            verts.append((cx + px * w, y + fold, cz + pz * w))
        verts = np.array(verts)
        faces = []
        for i in range(rings - 1):
            a = i * 2
            faces.append((a, a + 1, a + 2))
            faces.append((a + 1, a + 3, a + 2))
        fm = trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=False)
        meshes.append(fm)
        g = 0.38 + 0.16 * rng.random()
        colors.append(np.tile(np.array([0.10, g, 0.17, 1.0]), (len(verts), 1)))
    m = trimesh.util.concatenate(meshes)
    vc = (np.vstack(colors) * 255).astype(np.uint8)
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=vc)
    return normalize(m)


# ---------- 岩石：噪声位移 icosphere（顶点色） ----------
def rock():
    m = trimesh.creation.icosphere(subdivisions=2, radius=0.5)
    v = m.vertices.copy()
    # 按顶点位置哈希位移，保证共享顶点不开裂
    h = np.sin(v @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
    disp = 1.0 + 0.34 * (h - np.floor(h))
    v *= disp[:, None]
    v[:, 1] *= 0.72  # 压扁成砾石
    m.vertices = v
    # 顶点色：高处亮、低处暗的灰岩
    yn = (v[:, 1] - v[:, 1].min()) / (v[:, 1].max() - v[:, 1].min())
    gval = 0.22 + 0.20 * yn
    vc = np.stack([gval, gval * 1.02, gval * 1.08, np.ones_like(gval)], axis=1)
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=(vc * 255).astype(np.uint8))
    return normalize(m)


def main():
    os.makedirs(ASSETS, exist_ok=True)
    export(building_a(), 'building_a.glb')
    export(building_b(), 'building_b.glb')
    export(palm(), 'palm.glb')
    export(rock(), 'rock.glb')


if __name__ == '__main__':
    main()
