/* ============================================================
   赛道生成与比赛场景
   ============================================================ */
function buildTrack(tdef){
  const pts3 = tdef.pts.map(p=>new THREE.Vector3(p[0],0,p[1]));
  const curve = new THREE.CatmullRomCurve3(pts3, true, 'catmullrom', 0.5);
  const N = CFG.sampleN;
  const centers = curve.getSpacedPoints(N);
  const tangents=[], rights=[];
  for(let i=0;i<N;i++){
    const a = centers[(i+1)%N], b = centers[(i-1+N)%N];
    const t = a.clone().sub(b).normalize();
    tangents.push(t);
    rights.push(new THREE.Vector3(t.z, 0, -t.x));
  }
  const arc=[0];
  let total=0;
  for(let i=1;i<N;i++){ total += centers[i].distanceTo(centers[i-1]); arc.push(total); }
  const segLen = total/N;
  const totalLen = total + centers[0].distanceTo(centers[N-1]);
  // 起点：选择弯曲最小的路段，保证发车在直道上
  let startIdx = 0, bestScore = 1e9;
  const sl = 9;
  for(let i=0;i<N;i++){
    let s = 0;
    for(let k=-sl;k<sl;k++){
      const t1 = tangents[(i+k+N)%N], t2 = tangents[(i+k+1+N)%N];
      s += Math.acos(clamp(t1.dot(t2), -1, 1));
    }
    if(s < bestScore){ bestScore = s; startIdx = i; }
  }
  return { centers, tangents, rights, arc, segLen, totalLen, N, width:tdef.width, startIdx };
}

function relArc(track, i){
  const d = track.arc[i] - track.arc[track.startIdx];
  return (d % track.totalLen + track.totalLen) % track.totalLen;
}

function buildRoadMesh(track, tdef){
  const N = track.N, half = tdef.width/2;
  const pos = new Float32Array((N+1)*6);
  const uv = new Float32Array((N+1)*4);
  const idx = [];
  // UV 按真实尺寸平铺（4.2m 一个瓦片）：之前 u 固定 0~1 把整张贴图拉满 40m 宽，
  // 纹理被拉成大片"水波纹"，路面看起来像破损的水面
  const tile = 4.2;
  const uRep = Math.max(1, Math.round(tdef.width / tile));
  for(let i=0;i<=N;i++){
    const j = i % N;
    const c = track.centers[j], r = track.rights[j];
    pos.set([c.x-r.x*half, 0, c.z-r.z*half], i*6);
    pos.set([c.x+r.x*half, 0, c.z+r.z*half], i*6+3);
    const v = (i * track.segLen) / tile;
    uv.set([0, v], i*4);
    uv.set([uRep, v], i*4+2);
    if(i<N){
      const a=i*2, b=a+1, c2=a+2, d=a+3;
      idx.push(a,c2,b, b,c2,d);   // 逆时针朝上，保证从上方可见（否则被背面剔除，路面整条消失）
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color:0x4a5060, map:asphaltTexture(), roughness:.92, metalness:.04, envMapIntensity:.22, emissive:0x05070c, emissiveIntensity:.3 });
  const road = new THREE.Mesh(geo, mat);
  road.receiveShadow = true;
  return road;
}

/* 车道虚线 */
function buildLaneMarks(track, tdef){
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color:0xd7ecff, transparent:true, opacity:.5 });
  const N = track.N;
  const dashLen = 4.2, gap = 9;
  const step = track.segLen;
  for(let i=0;i<N;i++){
    const k = track.arc[i] / (dashLen+gap);
    const phase = k - Math.floor(k);
    if(phase < dashLen/(dashLen+gap)){
      const c = track.centers[i];
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, step*1.05), mat);
      m.position.set(c.x, 0.03, c.z);
      m.rotation.y = Math.atan2(track.tangents[i].x, track.tangents[i].z);
      group.add(m);
    }
  }
  return group;
}

/* 赛道两侧霓虹发光边线：清晰标出可行驶边界 */
function buildEdgeLines(track, tdef){
  const N = track.N, half = tdef.width/2;
  const positions=[], colors=[], indices=[];
  let vi = 0;
  const seg = track.segLen;
  const pushBar = (cx, cz, rx, rz, sgn, colorVec)=>{
    const off = half - 0.42;
    const x0 = cx + rx*off*sgn, z0 = cz + rz*off*sgn;
    const tx = rz, tz = -rx; // 横向（沿道路方向）
    const hw = seg*1.05/2;
    const corners = [[-hw,0],[hw,0],[hw,0.06],[-hw,0.06]].map(c=> new THREE.Vector3(
      x0 + rx*c[1], c[1], z0 + rz*c[1]).add(new THREE.Vector3(tx*c[0],0,tz*c[0])));
    const v = [
      corners[0], corners[1], corners[2], corners[3],
      corners[0].clone().setY(0.09), corners[1].clone().setY(0.09), corners[2].clone().setY(0.09), corners[3].clone().setY(0.09)
    ];
    const base = vi;
    v.forEach(p=>{ positions.push(p.x,p.y,p.z); colors.push(colorVec[0],colorVec[1],colorVec[2]); });
    indices.push(
      base,base+1,base+2, base,base+2,base+3,
      base+4,base+6,base+5, base+4,base+7,base+6,
      base,base+4,base+1, base+1,base+4,base+5,
      base+1,base+5,base+2, base+2,base+5,base+6,
      base+2,base+6,base+3, base+3,base+6,base+7,
      base+3,base+7,base+0, base+0,base+7,base+4
    );
    vi += 8;
  };
  const cyan=[0.0,0.9,1.0], amber=[1.0,0.72,0.24];
  for(let i=0;i<N;i++){
    const c = track.centers[i], r = track.rights[i];
    const col = (Math.floor(track.arc[i]/(seg*6)) % 2 === 0) ? cyan : amber;
    pushBar(c.x, c.z, r.x, r.z, -1, col);
    pushBar(c.x, c.z, r.x, r.z, +1, col);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions),3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors),3));
  geo.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true, opacity:.8 });
  const bars = new THREE.Mesh(geo, mat);
  bars.castShadow = true;
  return bars;
}

/* 弯道路肩（红白） */
function buildCurbs(track, tdef){
  const N = track.N, W = tdef.width, half = W/2;
  const zone = new Array(N).fill(false);
  const look = 10;
  for(let i=0;i<N;i++){
    const t1 = track.tangents[i], t2 = track.tangents[(i+look)%N];
    const ang = Math.acos(clamp(t1.dot(t2), -1, 1));
    if(ang > 0.085) zone[i] = true;
  }
  const positions=[], colors=[], indices=[];
  let vi = 0;
  const seg = track.segLen;
  const pushBox = (cx, cz, dx, dz, len, thick, colorVec)=>{
    const tx = -dz, tz = dx;   // 沿赛道方向
    const hw = len/2, ht = thick/2;
    const corners = [[-hw,-ht],[hw,-ht],[hw,ht],[-hw,ht]].map(c=> new THREE.Vector3(cx + tx*c[0] + dx*c[1], 0.05, cz + tz*c[0] + dz*c[1]));
    const v = [
      corners[0], corners[1], corners[2], corners[3],
      corners[0].clone().setY(0.15), corners[1].clone().setY(0.15), corners[2].clone().setY(0.15), corners[3].clone().setY(0.15)
    ];
    const base = vi;
    v.forEach(p=>{ positions.push(p.x,p.y,p.z); colors.push(colorVec[0],colorVec[1],colorVec[2]); });
    indices.push(
      base,base+1,base+2, base,base+2,base+3,
      base+4,base+6,base+5, base+4,base+7,base+6,
      base,base+4,base+1, base+1,base+4,base+5,
      base+1,base+5,base+2, base+2,base+5,base+6,
      base+2,base+6,base+3, base+3,base+6,base+7,
      base+3,base+7,base+0, base+0,base+7,base+4
    );
    vi += 8;
  };
  const red=[0.78,0.10,0.16], white=[0.9,0.92,0.95];
  for(let i=0;i<N;i++){
    if(!zone[i]) continue;
    const c = track.centers[i], r = track.rights[i];
    const col = (Math.floor(track.arc[i]/(seg*2)) % 2 === 0) ? red : white;
    const w = seg*1.1, h = 0.55;
    pushBox(c.x - r.x*(half - h/2), c.z - r.z*(half - h/2), r.x, r.z, w, h, col);
    pushBox(c.x + r.x*(half - h/2), c.z + r.z*(half - h/2), r.x, r.z, w, h, col);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions),3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors),3));
  geo.setIndex(indices);
  const mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.6, metalness:.15, emissive:0x101014, emissiveIntensity:.4 });
  const curbMesh = new THREE.Mesh(geo, mat);
  curbMesh.castShadow = true;
  return curbMesh;
}

/* 赛道两侧护栏 */
function buildBarriers(track, tdef, h){
  const N = track.N, half = tdef.width/2;
  const side = (sgn)=>{
    const pos = new Float32Array((N+1)*6);
    const idx = [];
    for(let i=0;i<=N;i++){
      const j = i % N;
      const c = track.centers[j], r = track.rights[j];
      const ox = c.x + r.x*half*sgn, oz = c.z + r.z*half*sgn;
      pos.set([ox, 0, oz], i*6);
      pos.set([ox, h, oz], i*6+3);
      if(i<N){
        const a=i*2, b=a+1, c2=a+2, d=a+3;
        idx.push(a,b,c2, b,d,c2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // 护栏内侧压低反光：金属度太高会把天空反射成一条发白的墙，看起来像"岸边破损"
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:0x2b344a, roughness:.86, metalness:.22, envMapIntensity:.08, emissive:0x0d1320, emissiveIntensity:.4, side:THREE.DoubleSide }));
  };
  // 护栏顶部霓虹灯带（左粉右青），夜间清晰标出赛道边缘
  const lightStrip = (sgn, colorVec)=>{
    const pos = new Float32Array((N+1)*6);
    const idx = [];
    const oxy = half - 0.18;
    for(let i=0;i<=N;i++){
      const j = i % N;
      const c = track.centers[j], r = track.rights[j];
      const ox = c.x + r.x*oxy*sgn, oz = c.z + r.z*oxy*sgn;
      pos.set([ox, h+0.02, oz], i*6);
      pos.set([ox, h+0.16, oz], i*6+3);
      if(i<N){
        const a=i*2, b=a+1, c2=a+2, d=a+3;
        idx.push(a,b,c2, b,d,c2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setIndex(idx);
    // 灯带不要过亮：全亮的基本色在辉光后处理里会糊成两侧一大片光带
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:new THREE.Color(colorVec[0],colorVec[1],colorVec[2]), transparent:true, opacity:.62 }));
  };
  const g = new THREE.Group();
  g.add(side(-1), side(1));
  g.add(lightStrip(-1, [1.0,0.18,0.53]), lightStrip(1, [0.0,0.9,1.0]));
  return g;
}

/* 起点棋盘格 + 大门 */
function makeCheckerTex(){
  const c = document.createElement('canvas'); c.width=64; c.height=32;
  const x = c.getContext('2d');
  for(let i=0;i<8;i++) for(let j=0;j<4;j++){
    x.fillStyle = (i+j)%2? '#10141f' : '#cfd6dd';
    x.fillRect(i*8, j*8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function buildStartLine(track, tdef){
  const g = new THREE.Group();
  const si = track.startIdx;
  const c = track.centers[si], r = track.rights[si];
  const a = Math.atan2(r.x, r.z);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(tdef.width*0.98, 7),
    new THREE.MeshBasicMaterial({ map:makeCheckerTex(), transparent:true, opacity:.75 })
  );
  line.rotation.set(-Math.PI/2, a, 0, 'YXZ');
  line.position.set(c.x, 0.055, c.z);
  g.add(line);
  const archMat = new THREE.MeshStandardMaterial({ color:0x0c1020, metalness:.8, roughness:.4, emissive:0x00e5ff, emissiveIntensity:1.6 });
  const archH = 6.2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(tdef.width*1.15, 0.55, 0.55), archMat);
  top.position.set(c.x, archH, c.z);
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, archH, 0.55), archMat);
  const p2 = p1.clone();
  const off = tdef.width/2 + 0.6;
  p1.position.set(c.x - r.x*off, archH/2, c.z - r.z*off);
  p2.position.set(c.x + r.x*off, archH/2, c.z + r.z*off);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(tdef.width*0.7, 0.9, 0.12), new THREE.MeshBasicMaterial({ color:0x00e5ff, transparent:true, opacity:.9 }));
  sign.position.set(c.x, archH+0.5, c.z);
  g.add(top, p1, p2, sign);
  return g;
}

/* 检查点拱门（小） */
function buildGates(track, tdef){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color:0x0c1020, metalness:.8, roughness:.4, emissive:0xff2e88, emissiveIntensity:1.5 });
  const K = 6;
  for(let k=1;k<=K;k++){
    const i = (track.startIdx + Math.floor(track.N * k / (K+1))) % track.N;
    const c = track.centers[i], r = track.rights[i];
    const h = 5.4;
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), mat);
    const p2 = p1.clone();
    const off = tdef.width/2 + 0.5;
    p1.position.set(c.x - r.x*off, h/2, c.z - r.z*off);
    p2.position.set(c.x + r.x*off, h/2, c.z + r.z*off);
    const top = new THREE.Mesh(new THREE.BoxGeometry(tdef.width*1.1, 0.4, 0.4), mat);
    top.position.set(c.x, h, c.z);
    g.add(p1, p2, top);
  }
  return g;
}

/* 霓虹路灯柱 */
function buildLightPoles(track, tdef){
  const g = new THREE.Group();
  const poleMat = new THREE.MeshBasicMaterial({ color:0x1a2030 });
  const headMat = new THREE.MeshBasicMaterial({ color:0xdffaff });
  const N = track.N;
  const stepEvery = Math.floor(N / 26);
  for(let i=0;i<N;i+=stepEvery){
    const c = track.centers[i], r = track.rights[i];
    for(const sgn of [-1,1]){
      const ox = c.x + r.x*(tdef.width/2 + 1.4)*sgn, oz = c.z + r.z*(tdef.width/2 + 1.4)*sgn;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.2, 0.18), poleMat);
      pole.position.set(ox, 3.1, oz);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.35), headMat);
      head.position.set(ox + r.x*sgn*0.7, 6.15, oz + r.z*sgn*0.7);
      g.add(pole, head);
    }
  }
  return g;
}

/* 城市楼宇 + 霓虹广告 */
function buildSceneryCity(track, tdef){
  const g = new THREE.Group();
  const N = track.N;
  // 城市地面：避免赛道/楼群悬浮在虚空中（接收阴影，压出立体光影）
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1700, 1700),
    new THREE.MeshStandardMaterial({ color:0x0a0e1e, roughness:.95, emissive:0x070a16, emissiveIntensity:.55 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  g.add(ground);
  // 地面霓虹网格线：提供透视纵深，强化立体感
  const grid = new THREE.GridHelper(1700, 100, 0x2a4a78, 0x1c3050);
  grid.position.y = -0.03;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  g.add(grid);
  const bMat = new THREE.MeshStandardMaterial({ color:0x0b1322, roughness:.78, metalness:.18, emissive:0xd8ecff, emissiveMap:winTexture('city'), emissiveIntensity:1.0 });
  const count = 210;
  const m = new THREE.Matrix4();
  const geoA = sceneModelCache.bldA, geoB = sceneModelCache.bldB;
  if(geoA || geoB){
    // 真实楼模型：底面原点、高度归一，InstancedMesh 缩放摆放
    const instA = new THREE.InstancedMesh(geoA || geoB, bMat, count);
    const instB = geoB ? new THREE.InstancedMesh(geoB, bMat, count) : null;
    let idxA = 0, idxB = 0;
    const q = new THREE.Quaternion(), eul = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
    const tint = new THREE.Color();
    const step = Math.max(1, Math.floor(N/190));
    for(let i=0;i<N && (idxA+idxB)<count;i+=step){
      const c = track.centers[i];
      for(const sgn of [-1,1]){
        if((idxA+idxB)>=count) break;
        const off = tdef.width/2 + 9 + Math.random()*38;
        const h = 12 + Math.random()*46;
        const px = c.x + track.rights[i].x*off*sgn;
        const pz = c.z + track.rights[i].z*off*sgn;
        eul.set(0, Math.random()*TAU, 0); q.setFromEuler(eul);
        pv.set(px, -0.3, pz); sv.set(4.5+Math.random()*7, h, 4.5+Math.random()*7);
        m.compose(pv, q, sv);
        tint.setHSL(0.56 + Math.random()*0.10, 0.22 + Math.random()*0.22, 0.10 + Math.random()*0.18);
        if(instB && Math.random()<0.5){ instB.setMatrixAt(idxB, m); instB.setColorAt(idxB, tint); idxB++; }
        else { instA.setMatrixAt(idxA, m); instA.setColorAt(idxA, tint); idxA++; }
      }
    }
    instA.count = idxA;
    instA.instanceMatrix.needsUpdate = true;
    if(instA.instanceColor) instA.instanceColor.needsUpdate = true;
    instA.castShadow = true;
    g.add(instA);
    if(instB){
      instB.count = idxB;
      instB.instanceMatrix.needsUpdate = true;
      if(instB.instanceColor) instB.instanceColor.needsUpdate = true;
      instB.castShadow = true;
      g.add(instB);
    }
  }else{
    // 回退：程序化方块楼
    const bGeo = new THREE.BoxGeometry(1,1,1);
    const inst = new THREE.InstancedMesh(bGeo, bMat, count);
    let idx = 0;
    const step = Math.max(1, Math.floor(N/190));
    for(let i=0;i<N && idx<count;i+=step){
      const c = track.centers[i];
      for(const sgn of [-1,1]){
        if(idx>=count) break;
        const off = tdef.width/2 + 10 + Math.random()*46;
        const h = 6 + Math.random()*26;
        const px = c.x + track.rights[i].x*off*sgn;
        const pz = c.z + track.rights[i].z*off*sgn;
        m.makeScale(3+Math.random()*4, h, 3+Math.random()*4);
        m.setPosition(px, h/2 - 0.3, pz);
        inst.setMatrixAt(idx, m);
        idx++;
      }
    }
    inst.count = idx;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    g.add(inst);
  }
  const neonColors = [0x00e5ff, 0xff2e88, 0xffb300, 0x00ff9d, 0xb37bff];
  for(let i=0;i<16;i++){
    const j = Math.floor(Math.random()*N);
    const c = track.centers[j], r = track.rights[j];
    const sgn = Math.random()<0.5?-1:1;
    const off = tdef.width/2 + 3 + Math.random()*8;
    const hgt = 3.5 + Math.random()*3;
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(3.2+Math.random()*2, hgt, 0.16),
      new THREE.MeshBasicMaterial({ color: neonColors[Math.floor(Math.random()*neonColors.length)], transparent:true, opacity:.85 })
    );
    sign.position.set(c.x + r.x*off*sgn, hgt/2+1.4, c.z + r.z*off*sgn);
    sign.rotation.y = Math.atan2(r.x, r.z) + (sgn<0? 0 : Math.PI);
    g.add(sign);
  }
  return g;
}

/* 海岸：海面 + 山峦 + 棕榈 */
function buildSceneryCoast(track, tdef){
  const g = new THREE.Group();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    // 全粗糙、无金属：避免掠射角把天空反射成沿岸一条发白的"假沙滩"光带
    new THREE.MeshStandardMaterial({ map:makeWaterTexture(), color:0x10293b, roughness:1, metalness:0, envMapIntensity:.02, emissive:0x01060c, emissiveIntensity:.2 })
  );
  sea.rotation.x = -Math.PI/2;
  sea.position.y = -0.6;
  g.add(sea);
  _fx.sea = sea.material.map;   // 交由主循环滚动，制造海面流动感
  const N = track.N;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion(), eul = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  // 路基护坡：赛道两侧向海面倾斜的岩坡，让道路"坐落"在地面上而不是悬浮
  {
    const rib = (sgn, w0, w1, y0, y1, mat)=>{
      const pos = new Float32Array((N+1)*6), idx = [];
      for(let i=0;i<=N;i++){
        const j = i % N;
        const c = track.centers[j], r = track.rights[j];
        pos.set([c.x + r.x*w0*sgn, y0, c.z + r.z*w0*sgn], i*6);
        pos.set([c.x + r.x*w1*sgn, y1, c.z + r.z*w1*sgn], i*6+3);
        if(i<N){
          const a=i*2, b=a+1, c2=a+2, d=a+3;
          idx.push(a,b,c2, b,d,c2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, mat);
    };
    // 护坡/滩地必须压低环境反射：默认 envMapIntensity=1 时，近水平面在掠射角会把整片天空
    // 反射成一条发白的"假沙滩"，这正是岸边看起来破损、光影奇怪的原因
    const rockMat = new THREE.MeshStandardMaterial({ color:0x0b1018, roughness:.95, metalness:.05, envMapIntensity:.04, side:THREE.DoubleSide });
    const shoreMat = new THREE.MeshStandardMaterial({ color:0x090d14, roughness:1, metalness:.04, envMapIntensity:.03, side:THREE.DoubleSide });
    const halfW = tdef.width/2, outer = halfW + 10;
    // 护坡 → 礁石滩 → 海面：中间留出滩地，避免公路看起来像"泡在水里"
    g.add(rib(-1, halfW, outer, -0.02, -0.48, rockMat), rib(1, halfW, outer, -0.02, -0.48, rockMat));
    g.add(rib(-1, outer, halfW + 22, -0.48, -0.58, shoreMat), rib(1, outer, halfW + 22, -0.48, -0.58, shoreMat));
  }
  const rockGeo = sceneModelCache.rock, palmGeo = sceneModelCache.palm;
  if(rockGeo){
    // 远山：接近纯剪影（关雾），低矮连绵成山脊，避免出现一排"浮空圆石"
    const hillMat = new THREE.MeshStandardMaterial({ vertexColors:true, color:0x2b3a52, roughness:1, envMapIntensity:.05, emissive:0x03060c, emissiveIntensity:.06, flatShading:true });
    const hcount = 76;
    const hills = new THREE.InstancedMesh(rockGeo, hillMat, hcount);
    for(let i=0;i<hcount;i++){
      const j = Math.floor(Math.random()*N);
      const c = track.centers[j], r = track.rights[j];
      const sgn = Math.random()<0.5?-1:1;
      // 山体放远放低：离得太近会变成漂在海面上的大块方山
      const off = tdef.width/2 + 230 + Math.random()*120;
      const h = 10 + Math.random()*10;
      eul.set(0, Math.random()*TAU, 0); q.setFromEuler(eul);
      pv.set(c.x + r.x*off*sgn, -2, c.z + r.z*off*sgn);
      // 横向压扁过狠会变成"平顶方山"：宽高比控制在 2:1 左右，多块叠成山脊
      sv.set(26+Math.random()*20, h, 26+Math.random()*20);
      m.compose(pv, q, sv);
      hills.setMatrixAt(i, m);
    }
    hills.instanceMatrix.needsUpdate = true;
    g.add(hills);
    // 第二层远山：更远更淡，制造空气透视的层叠山脊
    const farMat = new THREE.MeshStandardMaterial({ vertexColors:true, color:0x3c4c66, roughness:1, envMapIntensity:.05, emissive:0x04070e, emissiveIntensity:.08, flatShading:true });
    const fcount = 48;
    const farHills = new THREE.InstancedMesh(rockGeo, farMat, fcount);
    for(let i=0;i<fcount;i++){
      const j = Math.floor(Math.random()*N);
      const c = track.centers[j], r = track.rights[j];
      const sgn = Math.random()<0.5?-1:1;
      const off = tdef.width/2 + 380 + Math.random()*180;
      const h = 13 + Math.random()*12;
      eul.set(0, Math.random()*TAU, 0); q.setFromEuler(eul);
      pv.set(c.x + r.x*off*sgn, -4, c.z + r.z*off*sgn);
      sv.set(40+Math.random()*28, h, 40+Math.random()*28);
      m.compose(pv, q, sv);
      farHills.setMatrixAt(i, m);
    }
    farHills.instanceMatrix.needsUpdate = true;
    g.add(farHills);
    // 近岸散石：保留雾，层次更自然
    const stoneMat = new THREE.MeshStandardMaterial({ vertexColors:true, color:0x243244, roughness:.95, envMapIntensity:.12, flatShading:true });
    const scount = 36;
    const stones = new THREE.InstancedMesh(rockGeo, stoneMat, scount);
    for(let i=0;i<scount;i++){
      const j = Math.floor(Math.random()*N);
      const c = track.centers[j], r = track.rights[j];
      const sgn = Math.random()<0.5?-1:1;
      const off = tdef.width/2 + 7 + Math.random()*9;
      const s = 0.7 + Math.random()*2.0;
      eul.set(0, Math.random()*TAU, 0); q.setFromEuler(eul);
      pv.set(c.x + r.x*off*sgn, -0.52, c.z + r.z*off*sgn);
      sv.set(s, s*0.85, s);
      m.compose(pv, q, sv);
      stones.setMatrixAt(i, m);
    }
    stones.instanceMatrix.needsUpdate = true;
    stones.castShadow = true;
    g.add(stones);
  }else{
    const hillMat = new THREE.MeshStandardMaterial({ color:0x0a0d1c, roughness:.95, emissive:0x070a14, emissiveIntensity:.6 });
    const hillGeo = new THREE.ConeGeometry(1,1,6);
    const hcount = 70;
    const hills = new THREE.InstancedMesh(hillGeo, hillMat, hcount);
    for(let i=0;i<hcount;i++){
      const j = Math.floor(Math.random()*N);
      const c = track.centers[j], r = track.rights[j];
      const sgn = Math.random()<0.5?-1:1;
      const off = tdef.width/2 + 60 + Math.random()*180;
      const h = 14 + Math.random()*40;
      m.makeScale(30+Math.random()*50, h, 30+Math.random()*50);
      m.setPosition(c.x + r.x*off*sgn, h/2-2, c.z + r.z*off*sgn);
      hills.setMatrixAt(i, m);
    }
    hills.instanceMatrix.needsUpdate = true;
    g.add(hills);
  }
  if(palmGeo){
    // 真实棕榈模型：弯曲树干 + 下垂叶片（顶点色）
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.85, side:THREE.DoubleSide, emissive:0x04140c, emissiveIntensity:.5 });
    const pcount = 120;
    const palms = new THREE.InstancedMesh(palmGeo, palmMat, pcount);
    for(let i=0;i<pcount;i++){
      const j = Math.floor(Math.random()*N);
      const c = track.centers[j], r = track.rights[j];
      const sgn = Math.random()<0.5?-1:1;
      const off = tdef.width/2 + 10 + Math.random()*20;
      const s = 2.6 + Math.random()*1.6;
      eul.set(0, Math.random()*TAU, 0); q.setFromEuler(eul);
      pv.set(c.x + r.x*off*sgn, -0.52, c.z + r.z*off*sgn);
      sv.set(s, s, s);
      m.compose(pv, q, sv);
      palms.setMatrixAt(i, m);
    }
    palms.instanceMatrix.needsUpdate = true;
    palms.castShadow = true;
    g.add(palms);
  }else{
    const trunkMat = new THREE.MeshStandardMaterial({ color:0x2a1f16, roughness:.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color:0x0c3a24, roughness:.85, emissive:0x04140c, emissiveIntensity:.5 });
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 3.4, 6);
    const leafGeo = new THREE.SphereGeometry(1.7, 7, 5);
    leafGeo.scale(1.4, 0.55, 1.4);
    const pcount = 120;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, pcount);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, pcount);
    for(let i=0;i<pcount;i++){
      const j = Math.floor(Math.random()*N);
      const c = track.centers[j], r = track.rights[j];
      const sgn = Math.random()<0.5?-1:1;
      const off = tdef.width/2 + 6 + Math.random()*22;
      const px = c.x + r.x*off*sgn, pz = c.z + r.z*off*sgn;
      m.makeRotationY(Math.random()*TAU);
      m.setPosition(px, 1.7, pz);
      trunks.setMatrixAt(i, m);
      const m2 = m.clone();
      m2.setPosition(px, 3.6, pz);
      leaves.setMatrixAt(i, m2);
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    g.add(trunks, leaves);
  }
  return g;
}

/* ---------- 组装比赛世界 ---------- */
function buildWorld(){
  const tdef = TRACKS[G.selectedTrack];
  const track = buildTrack(tdef);
  const group = new THREE.Group();
  group.add(buildRoadMesh(track, tdef));
  if(tdef.curbs) group.add(buildCurbs(track, tdef));
  group.add(buildEdgeLines(track, tdef));
  group.add(buildLaneMarks(track, tdef));
  group.add(buildBarriers(track, tdef, tdef.buildings? 1.0 : 0.75));
  group.add(buildStartLine(track, tdef));
  group.add(buildGates(track, tdef));
  group.add(buildLightPoles(track, tdef));
  if(tdef.buildings) group.add(buildSceneryCity(track, tdef));
  else group.add(buildSceneryCoast(track, tdef));
  G.scene.add(group);

  const grid = [];
  const rows = [[0,1,2],[3,4,5]];
  rows.forEach((rowArr, ri)=>{
    rowArr.forEach((slot, si)=>{
      const d = -(16 + ri*13);
      const lane = (si-1) * (tdef.width/3.4);
      const idx = ((track.startIdx - Math.round(d/track.segLen)) % track.N + track.N) % track.N;
      grid[slot] = { d, lane, idx };
    });
  });

  const cars = [];
  const player = createCar(0, CARS[G.selectedCar], track, tdef, grid[0], true, -1);
  cars.push(player);
  const aiNames = ['极速幽灵','午夜骑士','霓虹之刃','暗夜猎手','街头传奇'];
  for(let i=0;i<CFG.aiCount;i++){
    const base = CARS[(i+1)%CARS.length];
    const aiSpec = {
      name: base.name,
      model: base.model,
      aiName: aiNames[i],
      color: AI_COLORS[i],
      neon: AI_COLORS[i],
      stats: Object.assign({}, base.stats, { top: base.stats.top * (0.97 + i*0.02) })
    };
    cars.push(createCar(i+1, aiSpec, track, tdef, grid[i+1], false, i));
  }
  const shadowGeo = new THREE.CircleGeometry(1.35, 20);
  const shadowMat = new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:.4, depthWrite:false });
  const shadows = cars.map(()=>{
    const s = new THREE.Mesh(shadowGeo, shadowMat);
    s.rotation.x = -Math.PI/2;
    s.position.y = 0.04;
    G.scene.add(s);
    return s;
  });
  const particles = createParticlePool();
  const skids = createSkidMarks();

  G.world = { track, tdef, laps: tdef.laps, group, cars, player, shadows, particles, skids, cameraMode:0, offroadTime:0 };
  buildMapPaths();
}

function clearWorld(){
  if(!G.world) return;
  G.scene.remove(G.world.group);
  G.world.cars.forEach(c=>{ G.scene.remove(c.mesh); disposeObject(c.mesh); });
  G.world.shadows.forEach(s=>G.scene.remove(s));
  G.world.particles.sprites.forEach(s=>G.scene.remove(s));
  G.scene.remove(G.world.skids.mesh);
  disposeObject(G.world.skids.mesh);
  G.world = null;
}
