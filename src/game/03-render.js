/* ============================================================
   3D 渲染核心（Three.js + 辉光后处理）
   ============================================================ */
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const G = {
  mode:'menu', time:0, paused:false, simInput:null,
  renderer:null, scene:null, camera:null, composer:null, bloomPass:null,
  world:null, showcase:null,
  selectedCar:0, selectedTrack:0,
  quality:{ acc:0, frames:0, low:false, counter:0, good:0 },
  inputSeen:false, playerInputEver:false,
  steerFlip:false,
};

function initRenderer(){
  const canvas = $('#game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, CFG.pixelCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080f);
  scene.fog = new THREE.FogExp2(0x141c33, 0.0042);   // 淡雾：远景保留色彩层次，不再糊成灰白
  buildSky(scene);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 900);
  // 灯光
  scene.add(new THREE.AmbientLight(0x1c2740, 0.38));
  scene.add(new THREE.HemisphereLight(0x2b3d60, 0x07080e, 0.42));
  const moon = new THREE.DirectionalLight(0x9dc4ff, 0.9);
  moon.position.set(40, 80, 30);
  // 月光投阴影：让车/护栏/建筑在地面压出立体光影，跟随玩家移动
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  // 阴影相机只需覆盖玩家周围近景：同样的 2048 贴图，范围越小投影越锐利
  moon.shadow.camera.left = -104; moon.shadow.camera.right = 104;
  moon.shadow.camera.top = 104; moon.shadow.camera.bottom = -104;
  moon.shadow.camera.near = 5; moon.shadow.camera.far = 260;
  moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -0.0004;
  scene.add(moon);
  scene.add(moon.target);
  G.moon = moon;
  // 霓虹补光：从车尾方向打一层品红边光，让车身轮廓从背景中剥离
  const rim = new THREE.DirectionalLight(0xff3d88, 0.28);
  rim.position.set(-70, 26, -55);
  scene.add(rim);
  // 霓虹环境反射：程序化城市光斑经 PMREM 生成 envMap，给车漆 clearcoat 提供彩色反光（写实质感的关键）
  try{
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envBg = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color:0x0a0e1a, side:THREE.BackSide }));
    envScene.add(envBg);
    const glowPlane = (x,y,z,c,s,iy)=>{
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s,s), new THREE.MeshBasicMaterial({ color:c, side:THREE.DoubleSide, toneMapped:false }));
      m.position.set(x,y,z); m.lookAt(0,0,0); envScene.add(m);
    };
    glowPlane( 0, 30,  0, 0x11223a, 60, 2.2);
    glowPlane( 0,-30,  0, 0x1a0f2e, 60, 1.6);
    glowPlane( 25, 8,  0, 0x00e5ff, 18, 5);
    glowPlane(-25, 8,  0, 0xff2e88, 18, 5);
    glowPlane( 0, 8, 25, 0x7a5cff, 18, 4);
    glowPlane( 0, 12,-25, 0x2ee6ff, 18, 4);
    glowPlane( 18, 3, 18, 0xffb02e, 10, 3);
    glowPlane(-18, 3,-18, 0x6aff2e, 10, 2.4);
    const envRT = pm.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    pm.dispose();
    G.envRT = envRT;
  }catch(e){}
  // 后处理
  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.62, 0.88);
  composer.addPass(bloom);
  G.renderer = renderer; G.scene = scene; G.camera = camera;
  G.composer = composer; G.bloomPass = bloom;
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden && G.mode==='race') pauseRace(true);
  });
}

function onResize(){
  const w = window.innerWidth, h = window.innerHeight;
  G.camera.aspect = w/h;
  G.camera.updateProjectionMatrix();
  G.renderer.setSize(w,h);
  G.composer.setSize(w,h);
}

/* ---------- 天空穹顶：渐变夜空 + 星空 + 月亮 ---------- */
function buildSky(scene){
  // 天空整体跟随相机：穹顶/地平线辉光/星空/月亮必须始终以相机为中心，
  // 否则赛道开出去几百米后，这圈辉光和渐变会偏离地平线，出现"远处浮空的粉青光带"
  const skyGroup = new THREE.Group();
  // 渐变贴图：地平线暖紫 → 中层深蓝 → 天顶近黑
  const c = document.createElement('canvas');
  c.width = 8; c.height = 512;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 512, 0, 0);
  grd.addColorStop(0.00, '#1b1230');   // 地平线下
  grd.addColorStop(0.10, '#37224a');   // 地平线霓虹余晖
  grd.addColorStop(0.22, '#1a2b52');   // 过渡带：地平线余晖向夜空过渡
  grd.addColorStop(0.45, '#0d1226');
  grd.addColorStop(1.00, '#04050c');
  x.fillStyle = grd; x.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 24),
    new THREE.MeshBasicMaterial({ map:tex, side:THREE.BackSide, depthWrite:false, fog:false, toneMapped:false })
  );
  dome.frustumCulled = false;
  skyGroup.add(dome);

  // 地平线辉光带：贴着海平面的一圈暖光，模拟大气散射，让远景有 Slow Roads 式的层次
  const hz = document.createElement('canvas'); hz.width = 4; hz.height = 128;
  const hx = hz.getContext('2d');
  const hg = hx.createLinearGradient(0, 128, 0, 0);
  hg.addColorStop(0.00, 'rgba(255,150,190,0.24)');
  hg.addColorStop(0.12, 'rgba(255,138,186,0.30)');
  hg.addColorStop(0.34, 'rgba(126,120,220,0.10)');
  hg.addColorStop(0.62, 'rgba(120,140,255,0)');
  hg.addColorStop(1.00, 'rgba(120,140,255,0)');
  hx.fillStyle = hg; hx.fillRect(0,0,4,128);
  const hzTex = new THREE.CanvasTexture(hz); hzTex.colorSpace = THREE.SRGBColorSpace;
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(640, 640, 120, 48, 1, true),
    new THREE.MeshBasicMaterial({ map:hzTex, transparent:true, side:THREE.BackSide, depthWrite:false, fog:false, toneMapped:false, blending:THREE.AdditiveBlending })
  );
  haze.position.y = 40;
  haze.frustumCulled = false;
  skyGroup.add(haze);

  // 星空：只分布在地平线以上，带少量暖色星
  const n = 1400, pos = new Float32Array(n*3), col = new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const a = Math.random()*TAU, y = 0.06 + Math.random()*0.94;
    const r = Math.sqrt(1-y*y);
    pos[i*3] = Math.cos(a)*r*660; pos[i*3+1] = y*660; pos[i*3+2] = Math.sin(a)*r*660;
    const w = 0.55 + Math.random()*0.45, t = Math.random();
    col[i*3] = w*(t>0.7 ? 1.0 : 0.82); col[i*3+1] = w*0.9; col[i*3+2] = w*(t>0.7 ? 0.94 : 1.0);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos,3));
  sg.setAttribute('color', new THREE.BufferAttribute(col,3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({
    size:2.2, sizeAttenuation:true, vertexColors:true, transparent:true, opacity:.75,
    depthWrite:false, fog:false, toneMapped:false, blending:THREE.AdditiveBlending
  }));
  stars.frustumCulled = false;
  skyGroup.add(stars);

  // 月亮：柔光晕 + 亮核
  const mc = document.createElement('canvas'); mc.width = mc.height = 128;
  const mx = mc.getContext('2d');
  const mg = mx.createRadialGradient(64,64,4, 64,64,62);
  mg.addColorStop(0, 'rgba(255,252,240,1)');
  mg.addColorStop(0.18, 'rgba(226,236,255,.95)');
  mg.addColorStop(0.42, 'rgba(150,180,240,.28)');
  mg.addColorStop(1, 'rgba(80,110,200,0)');
  mx.fillStyle = mg; mx.beginPath(); mx.arc(64,64,62,0,Math.PI*2); mx.fill();
  const mt = new THREE.CanvasTexture(mc); mt.colorSpace = THREE.SRGBColorSpace;
  const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map:mt, transparent:true, depthWrite:false, fog:false, toneMapped:false, blending:THREE.AdditiveBlending }));
  const dir = new THREE.Vector3(0.34, 0.30, -0.90).normalize();
  moonSpr.position.copy(dir.multiplyScalar(620));
  moonSpr.scale.set(96, 96, 1);
  skyGroup.add(moonSpr);
  scene.add(skyGroup);
  G.skyGroup = skyGroup;
}

/* ---------- 海面贴图：深海底色 + 波浪亮带（循环滚动制造流动感） ---------- */
let _waterTex = null;
function makeWaterTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#0a2438'; x.fillRect(0,0,256,256);
  // 深浅斑驳
  for(let i=0;i<900;i++){
    const px = Math.random()*256, py = Math.random()*256, r = 2+Math.random()*26;
    const g2 = x.createRadialGradient(px,py,0, px,py,r);
    const bright = Math.random() < 0.35;
    g2.addColorStop(0, bright ? 'rgba(70,150,200,.16)' : 'rgba(4,18,30,.22)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g2; x.beginPath(); x.arc(px,py,r,0,Math.PI*2); x.fill();
  }
  // 波浪亮带：横向正弦细线（降低对比度，近看不会抢戏）
  for(let k=0;k<26;k++){
    const y0 = Math.random()*256, amp = 3+Math.random()*10, len = 40+Math.random()*160;
    const x0 = Math.random()*256, ph = Math.random()*TAU;
    x.strokeStyle = 'rgba(150,225,255,' + (0.03+Math.random()*0.06).toFixed(3) + ')';
    x.lineWidth = 0.8+Math.random()*1.6;
    x.beginPath();
    for(let s=0;s<=len;s+=4){
      const yy = y0 + Math.sin((s/len)*Math.PI*2 + ph)*amp;
      if(s===0) x.moveTo(x0+s, yy); else x.lineTo(x0+s, yy);
    }
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // 海面放大到 4000 后按比例加密重复，保持每格约 22m，纹理不被拉成大块
  tex.repeat.set(180, 180);
  tex.anisotropy = 8;
  _waterTex = tex;
  return tex;
}

/* ---------- 沥青贴图：噪点 + 纵向磨损痕 ---------- */
let _asphaltTex = null;
function makeAsphaltTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#1d2331'; x.fillRect(0,0,512,512);
  for(let i=0;i<16000;i++){
    const v = Math.random();
    x.fillStyle = v<0.55 ? 'rgba(7,9,15,.5)' : (v<0.88 ? 'rgba(78,90,114,.22)' : 'rgba(150,168,198,.16)');
    x.fillRect(Math.random()*512, Math.random()*512, 1+Math.random()*2, 1+Math.random()*2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 路面 UV 已按 4.2m 瓦片给出重复次数，这里不能再叠加 repeat
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  _asphaltTex = tex;
  return tex;
}
function asphaltTexture(){ return _asphaltTex || makeAsphaltTexture(); }

/* ---------- 场景动画（海面滚动等），由主循环每帧调用 ---------- */
const _fx = { t:0, sea:null };
function animateScenery(dt){
  _fx.t += dt;
  if(_fx.sea){
    _fx.sea.offset.x = _fx.t * 0.010;
    _fx.sea.offset.y = Math.sin(_fx.t * 0.14) * 0.025;
  }
}

/* ---------- 霓虹窗户贴图（用于楼宇） ---------- */
function makeWindowTexture(){
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#04060b'; x.fillRect(0,0,128,256);
  // 稀疏窗格：低密度才像写字楼夜景，密排会糊成一片白
  const x0 = 12, cols = 5, rows = 11;
  const cw = (128-x0)/cols, chh = 256/rows;
  for(let i=0;i<cols;i++){
    for(let j=0;j<rows;j++){
      const wx = x0 + i*cw + 3, wy = j*chh + 4, ww = cw-6, wh = chh-9;
      const r = Math.random();
      if(r < 0.52) continue;                        // 熄灯
      let col;
      if(r < 0.86) col = ['#0e2634','#123243','#174257'][Math.floor(Math.random()*3)];
      else if(r < 0.96) col = ['#ffcf8f','#ffe0b0'][Math.floor(Math.random()*2)];
      else col = ['#6fd9ff','#9fe6ff'][Math.floor(Math.random()*2)];
      x.fillStyle = col; x.fillRect(wx,wy,ww,wh);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;   // 楼模型盒式投影 UV 会超出 0..1
  tex.anisotropy = 2;
  return tex;
}
const _winTexCache = {};
function winTexture(key){
  if(!_winTexCache[key]) _winTexCache[key] = makeWindowTexture();
  return _winTexCache[key];
}

/* ---------- 车辆模型：低多边形跑车 ---------- */
function taperGeom(L, hF, hB, wTop, wBot){
  // 棱台：前截面(x=L/2)高hF、后截面(x=-L/2)高hB；顶宽wTop、底宽wBot
  const a = wTop/2, b = wBot/2;
  const v = [
    -L/2,-hB/2,-b,  -L/2,-hB/2,b,
    -L/2, hB/2,-a,  -L/2, hB/2,a,
     L/2,-hF/2,-b,   L/2,-hF/2,b,
     L/2, hF/2,-a,   L/2, hF/2,a
  ];
  const idx = [0,1,2, 1,3,2, 4,6,5, 5,6,7, 0,2,4, 2,6,4, 1,5,3, 3,5,7, 2,3,6, 3,7,6, 0,4,1, 1,4,5];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
/* 多剖面放样：把一组 [x, 半宽, 顶高, 底高] 剖面放样成流线体（超跑车身/座舱） */
function loftBody(prof, mat){
  const verts=[], idx=[];
  const nP = prof.length;
  for(let i=0;i<nP;i++){
    const p = prof[i];
    verts.push(p.x, p.yT, -p.w,  p.x, p.yB, -p.w,  p.x, p.yB, p.w,  p.x, p.yT, p.w);
  }
  for(let i=0;i<nP-1;i++){
    const a=i*4, b=a+4;
    idx.push(a,a+1,b+1,b,  a+1,a+2,b+2,b+1,  a+2,a+3,b+3,b+2,  a+3,a,b,b+3);
  }
  idx.push(0,2,1, 0,3,2);                 // 车头封口
  const L=nP*4;
  idx.push(L-4,L-2,L-3,  L-4,L-1,L-2);    // 车尾封口
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts),3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/* Catmull-Rom 平滑插值：把轮廓点数值数组加密 sPer 倍，让放样侧面圆润 */
function crVals(ys, sPer){
  const out=[];
  for(let i=0;i<ys.length-1;i++){
    const p0=ys[Math.max(0,i-1)], p1=ys[i], p2=ys[i+1], p3=ys[Math.min(ys.length-1,i+2)];
    for(let s=0;s<sPer;s++){
      const t=s/sPer, t2=t*t, t3=t2*t;
      out.push(0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3));
    }
  }
  out.push(ys[ys.length-1]);
  return out;
}
/* 车身贴纸纹理：赛车号码圆 + 品牌条 */
function decalTexture(no){
  const c=document.createElement('canvas'); c.width=256; c.height=256;
  const g=c.getContext('2d');
  g.clearRect(0,0,256,256);
  g.strokeStyle='rgba(255,255,255,.95)'; g.lineWidth=14;
  g.beginPath(); g.arc(128,128,96,0,Math.PI*2); g.stroke();
  g.fillStyle='rgba(255,255,255,.95)'; g.font='bold 120px Arial'; g.textAlign='center'; g.textBaseline='middle';
  g.fillText(String(no),128,134);
  g.strokeStyle='rgba(255,255,255,.5)'; g.lineWidth=8;
  g.beginPath(); g.moveTo(0,28); g.lineTo(256,28); g.stroke();
  g.beginPath(); g.moveTo(0,228); g.lineTo(256,228); g.stroke();
  const tex=new THREE.CanvasTexture(c); tex.anisotropy=4;
  return tex;
}
