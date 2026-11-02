# 霓虹狂飙 Neon Rush

午夜霓虹街头的街机竞速游戏。纯前端实现（Three.js + WebGL），源码构建后打包成**一个 HTML 文件**，双击即玩，不需要服务器，也不需要联网。

- 5 条赛道：海岸疾驰、霓虹都市、工业回廊、落日海岸、霓虹之巅
- 6 辆车：GT-01 疾风、V8 夜影、E-RUSH 闪电、DRIFT-9 漂移者、Milk 奶罐车、GTX 猎风
- 与 5 名 AI 跑 2 圈，名次 / 圈速 / 最佳圈实时显示，战绩本地存档
- 手刹漂移（车头甩尾 + 侧滑 + 胎噪 + 胎痕）、氮气喷射、撞墙回弹、三种镜头、小地图

## 快速开始

### 直接玩
构建产物 `霓虹狂飙.html`（约 14.9 MB）可以单独拷走，双击用 Chrome / Edge 打开即可。

### 从源码构建

```powershell
python tools\build.py
```

- 依赖：Python 3.8+，无需安装任何第三方包
- 产物：根目录下的 `霓虹狂飙.html`
- 构建做的事：拼装 `src/` 下的 HTML/CSS/JS，把模型与贴图转成 base64 内嵌，并把 `vendor/three` 里的 Three.js 运行时与 loader 内联进页面
- 构建产物不入库（见 `.gitignore`），每次构建后重新生成

## 操作

| 操作 | 键盘 | 手柄 |
| --- | --- | --- |
| 加速 | `W` / `↑` | RT |
| 刹车 / 倒车 | `S` / `↓` | LT |
| 转向 | `A` / `D` / `←` / `→`（`T` 切换反向） | 左摇杆 |
| 手刹漂移 | `Shift` | A |
| 氮气 | `Space` | LB |
| 切换视角 | `C` | B |
| 地图 / 暂停 | `M` / `Esc` | Start |
| 沉浸模式 | `H` | — |

## 目录结构

```
src/
  index.html          页面骨架（含资源占位符）
  styles/main.css     全部样式
  game/01-config.js   车辆、赛道、常量配置
  game/02-audio.js    WebAudio 引擎/漂移/碰撞音效
  game/03-render.js   渲染器、后期、天空与灯光
  game/04-models.js   车辆模型加载与涂装
  game/05-showcase.js 选车展台
  game/06-track.js    赛道几何、路面与环境
  game/07-vehicle.js  车辆物理、AI、粒子、地图
  game/08-input.js    键盘 / 手柄输入
  game/09-race.js     比赛流程、相机、HUD
  game/10-ui.js       菜单、结算、排行榜
  game/11-init.js     启动与主循环
tools/
  build.py            构建脚本（拼装 + 内联资源）
  optimize_model.py   车辆模型压缩（gltf-transform）
  gen_scenery.py      场景模型（楼体 / 棕榈 / 岩石）生成
vendor/
  three/              Three.js r147 运行时、GLTFLoader、DRACOLoader、后处理
  draco/              Draco 解码器（wasm + wrapper）
assets/               构建时注入的 .glb 模型与贴图
```

## 模型资产管线

仓库里只保存压缩后的 `.glb`（`assets/*.glb`）。体积大的原始模型放在 `assets/cars_inbox/`，该目录已被 `.gitignore` 排除，需要时可从 GitHub Releases 的附件下载。

想换模型或提升画质：

```powershell
# 默认：2048 贴图、减面 0.6、Draco 压缩
python tools\optimize_model.py "assets/cars_inbox/赛车模型.glb"

# 追画质（4096 贴图、不减面）
python tools\optimize_model.py "assets\cars_inbox\赛车模型.glb" --texture-size 4096 --simplify-ratio 1.0

# 追体积
python tools\optimize_model.py "assets\cars_inbox\赛车模型.glb" --texture-size 1024 --simplify-ratio 0.35
```

压缩完执行 `python tools\build.py` 重新构建即可。注意贴图压缩和 Draco 必须在同一次 `optimize` 里完成，顺序反了会让体积暴涨。

## 发布

在 GitHub 上新建 Release，把构建产物 `霓虹狂飙.html` 作为附件上传；如需保留原始模型，也把 `assets/cars_inbox/赛车模型.glb` 一起传成附件（附件不进 git 历史）。

## 使用的外部资源

- [Three.js](https://threejs.org/) r147（MIT）及其 `examples/js` 下的 loader / 后处理
- 车辆模型：`ToyCar`、`CesiumMilkTruck` 来自 three.js 官方示例模型，其余为项目自制或用户提供
- 标题字体 Orbitron 通过 CDN 加载，断网时自动回退系统字体，不影响游玩
