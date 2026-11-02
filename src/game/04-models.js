/* ============================================================
   真实 glTF 赛车模型（ferrari.glb 内嵌 base64）
   ============================================================ */

let carModelReady = false;
let carModelCache = {};
/* 内嵌 Draco 解码器（glue 文本 + wasm base64）——file:// 下无法 fetch wasm，故内嵌后本地实例化 */
function base64ToUint8(s){ const b = atob(s); const u = new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i] = b.charCodeAt(i); return u; }
/* Draco worker 库本地注入：file:// 无法 fetch wasm，patch DRACOLoader._loadLibrary */
let gDracoLoader = null;
function makeDracoLoader(){
  if(gDracoLoader) return gDracoLoader;
  gDracoLoader = new THREE.DRACOLoader();
  const orig = gDracoLoader._loadLibrary.bind(gDracoLoader);
  gDracoLoader._loadLibrary = function(url, responseType){
    if(url.indexOf('draco_wasm_wrapper.js') >= 0) return Promise.resolve(DRACO_WRAPPER_JS);
    if(url.indexOf('draco_decoder.wasm') >= 0){
      const u = base64ToUint8(DRACO_WASM_B64);
      return Promise.resolve(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
    }
    return orig(url, responseType);
  };
  return gDracoLoader;
}
/* ---------- 车型注册表 ---------- */
const CAR_MODELS = {
  ferrari: { name:'法拉利 458',  b64:FERRARI_B64, tint:['Body_Color','_0098_DodgerBlue','Ferrari_Yellow'], wheels:/^wheel_[a-z]{2}$/, yawFix:Math.PI, size:4.9 },
  toycar:  { name:'经典敞篷跑车', b64:TOYCAR_B64,  tint:['ToyCar'],  wheels:null,  dropMats:/^Fabric$/i,  yawFix:0,             size:3.6 },
  milk:    { name:'奶罐运输车',   b64:MILK_B64,    tint:['truck'],   wheels:/^Node/,                      yawFix:0,              size:5.2 },
  /* 整张贴图涂装的 GT 赛车：单一网格（无独立车轮节点），自带涂装故不参与换色 */
  gtr:     { name:'GT 赛车',      b64:GTR_B64,     tint:null,        wheels:null,                         yawFix:Math.PI/2,      size:4.7 },
};
function parseCarModel(key, cb){
  const def = CAR_MODELS[key];
  const loader = new THREE.GLTFLoader();
  loader.setDRACOLoader(makeDracoLoader());
  const u = base64ToUint8(def.b64);
  loader.parse(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), '', (gltf)=>{
    const src = gltf.scene;
    src.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = false; } });
    // 剔除示例相机等非渲染节点
    const drops = [];
    src.traverse(o=>{ if(o.isCamera) drops.push(o); });
    drops.forEach(o=>{ o.parent && o.parent.remove(o); });
    // 剔除模型自带的展台/布料等非车身网格（按材质名匹配）
    if(def.dropMats){
      const cloths = [];
      src.traverse(o=>{
        if(!o.isMesh) return;
        const mn = (o.material && o.material.name) || '';
        if(def.dropMats.test(mn)) cloths.push(o);
      });
      cloths.forEach(o=>{ o.parent && o.parent.remove(o); });
    }
    // 等比例缩放到指定长轴
    const box = new THREE.Box3().setFromObject(src);
    const size = new THREE.Vector3(); box.getSize(size);
    const longAxis = Math.max(size.x, size.z);
    const s = def.size / (longAxis || 1);
    src.scale.setScalar(s);
    // 贴地并水平居中：模型原点常不在车身正中，不居中会导致展台上偏后半个车身悬空
    src.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(src);
    src.position.x -= (box2.min.x + box2.max.x) / 2;
    src.position.z -= (box2.min.z + box2.max.z) / 2;
    src.position.y -= box2.min.y;
    carModelCache[key] = { group: src, def };
    cb && cb();
  }, (err)=>{ console.error('gltf parse fail ['+key+']', err); carModelCache[key] = null; cb && cb(); });
}
function loadCarModel(cb){
  if(carModelReady){ cb && cb(); return; }
  try{
    let pending = 0;
    const carKeys = Object.keys(CAR_MODELS);
    const sceneKeys = Object.keys(SCENE_MODELS);
    carKeys.forEach(k => { if(!(k in carModelCache)) pending++; });
    sceneKeys.forEach(k => { if(!(k in sceneModelCache)) pending++; });
    const onDone = ()=>{ if(--pending <= 0){ carModelReady = true; cb && cb(); } };
    carKeys.forEach(k => {
      if(k in carModelCache) onDone();
      else parseCarModel(k, onDone);
    });
    sceneKeys.forEach(k => {
      if(k in sceneModelCache) onDone();
      else parseSceneModel(k, onDone);
    });
  }catch(e){ console.error('model decode fail', e); carModelReady = true; cb && cb(); }
}

/* 漆面换色 + 车灯发光（每车独立材质，避免共享污染） */
function cloneCarModel(key){
  const cache = carModelCache[key];
  if(!cache || !cache.group){ return null; }
  const root = cache.group.clone();
  root.traverse(o=>{
    if(o.isMesh){
      if(Array.isArray(o.material)) o.material = o.material.map(m=>m && m.clone());
      else if(o.material) o.material = o.material.clone();
    }
  });
  return root;
}
function tintCar(root, color, neon, tintNames){
  root.traverse(o=>{
    if(!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for(const m of mats){
      if(!m) continue;
      if(tintNames && tintNames.includes(m.name)){
        m.color.set(color);
        if(m.emissive) m.emissive.set(color);
        m.emissiveIntensity = m.map ? 0.07 : 0.06;   // 车漆自发光只保留一点霓虹感，过强会让车身整块发光糊成一团光斑
      }else if(m.name==='Taillight_Glass' || m.name==='Turn_Signal_LED'){
        if(m.emissive) m.emissive.set(0xff2040);
        m.emissiveIntensity = 1.6;
      }else if(m.name==='Projector_Glass'){
        if(m.emissive) m.emissive.set(0xcfeaff);
        m.emissiveIntensity = 2.4;
      }else if(m.name==='centre'){
        if(m.emissive) m.emissive.set(neon);
        m.emissiveIntensity = 1.0;
      }
    }
  });
}
/* 低模占位：模型解析完成前兜底（通常 <200ms，正常流程不可见） */
function placeholderCar(color){
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color, metalness:.8, roughness:.3, emissive:color, emissiveIntensity:.25 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 1.0), mat);
  b.position.y = 0.35;
  g.add(b);
  const gl = new THREE.MeshBasicMaterial({ color:0x00e5ff, transparent:true, opacity:.3, blending:THREE.AdditiveBlending, depthWrite:false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), gl);
  plane.rotation.x = -Math.PI/2; plane.position.y = 0.05;
  g.add(plane);
  return g;
}
/* 底盘氛围灯贴图：径向渐隐，避免在路面上出现一块方形光斑 */
let _glowTex = null;
function glowTexture(){
  if(_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(64,64,6, 64,64,64);
  grd.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.40, 'rgba(255,255,255,0.42)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  x.fillStyle = grd; x.fillRect(0,0,128,128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}
function buildCarMesh(modelKey, color, neon, isAI){
  const g = new THREE.Group();
  const def = CAR_MODELS[modelKey] || CAR_MODELS.ferrari;
  if(!carModelReady || !carModelCache[modelKey]){ g.add(placeholderCar(color)); g.userData = { wheels:[], wheelSpin:[0,0,0,0] }; return g; }
  const car = cloneCarModel(modelKey);
  if(!car){ g.add(placeholderCar(color)); g.userData = { wheels:[], wheelSpin:[0,0,0,0] }; return g; }
  tintCar(car, color, neon, def.tint);
  g.add(car);
  // 收集车轮节点
  const wheels = [];
  if(def.wheels) car.traverse(o=>{ if(o.name && def.wheels.test(o.name)) wheels.push(o); });
  // 底盘氛围灯：径向渐隐贴图，别再画成一块硬边矩形
  const glowMat = new THREE.MeshBasicMaterial({ color:neon, map:glowTexture(), transparent:true, opacity:.12, blending:THREE.AdditiveBlending, depthWrite:false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), glowMat);
  glow.rotation.x = -Math.PI/2; glow.position.y = 0.06;
  g.add(glow);
  g.userData = { wheels, wheelSpin:[0,0,0,0], modelKey, glow };
  return g;
}

/* ============================================================
   场景低模（楼×2 / 棕榈 / 岩石）：GLB 合并为单一 BufferGeometry，供 InstancedMesh
   约定：底面中心原点、高度归一 1.0；楼按法线主轴盒式投影 UV，棕榈/岩石用顶点色
   ============================================================ */
const SCENE_MODELS = {
  bldA: { b64:BLD_A_B64, boxUV:true },
  bldB: { b64:BLD_B_B64, boxUV:true },
  palm: { b64:PALM_B64, vcolor:true },
  rock: { b64:ROCK_B64, vcolor:true },
};
const sceneModelCache = {};
function mergeSceneGeometry(root, def){
  root.updateMatrixWorld(true);
  const pos=[], nor=[], col=[], uv=[];
  const v = new THREE.Vector3(), vn = new THREE.Vector3();
  root.traverse(o=>{
    if(!o.isMesh) return;
    let g = o.geometry;
    /* GLB 可能不带法线：先补算法线，否则 UV/朝向判断全错，整栋楼会变成一块平色板 */
    if(!g.attributes.normal){ g = g.clone(); g.computeVertexNormals(); }
    const p = g.attributes.position;
    if(!p) return;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    let cScale = 1;
    if(c){
      if(c.array instanceof Uint8Array) cScale = 1/255;
      else if(c.array instanceof Uint16Array) cScale = 1/65535;
    }
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const idx = g.index;
    const cnt = idx ? idx.count : p.count;
    for(let i=0;i<cnt;i++){
      const vi = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(p, vi).applyMatrix4(o.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if(n){ vn.fromBufferAttribute(n, vi).applyMatrix3(nm).normalize(); }
      else vn.set(0,1,0);
      nor.push(vn.x, vn.y, vn.z);
      if(def.vcolor){
        if(c) col.push(c.getX(vi)*cScale, c.getY(vi)*cScale, c.getZ(vi)*cScale);
        else col.push(1,1,1);
      }
      if(def.boxUV){
        /* 优先使用模型自带的面 UV（每面 0..1，窗户密度才正确）；屋顶压到贴图黑带 */
        const ua = g.attributes.uv;
        const ax = Math.abs(vn.x), ay = Math.abs(vn.y), az = Math.abs(vn.z);
        if(ay >= ax && ay >= az) uv.push(0.06, 0.5);   /* 屋顶/底面：贴图左侧留黑带 */
        else if(ua) uv.push(ua.getX(vi), ua.getY(vi));
        else if(ax >= az) uv.push(v.z*6, v.y*2.5);
        else uv.push(v.x*6, v.y*2.5);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos),3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor),3));
  if(def.vcolor) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col),3));
  if(def.boxUV) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv),2));
  return geo;
}
function parseSceneModel(key, cb){
  const def = SCENE_MODELS[key];
  const loader = new THREE.GLTFLoader();
  const u = base64ToUint8(def.b64);
  loader.parse(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), '', (gltf)=>{
    sceneModelCache[key] = mergeSceneGeometry(gltf.scene, def);
    cb && cb();
  }, (err)=>{ console.error('scene glb parse fail ['+key+']', err); sceneModelCache[key] = null; cb && cb(); });
}
