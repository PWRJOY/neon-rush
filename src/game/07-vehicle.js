/* ============================================================
   车辆物理 / AI / 粒子 / 地图
   ============================================================ */
function createCar(id, spec, track, tdef, grid, isPlayer, aiIndex){
  const mesh = buildCarMesh(spec.model||'ferrari', spec.color, spec.neon, !isPlayer);
  mesh.traverse(o=>{ if(o.isMesh) o.castShadow = true; }); // 赛车投地面阴影，不再"浮空"
  const st = spec.stats;
  const idx = grid.idx;
  const c = track.centers[idx];
  const r = track.rights[idx];
  const t = track.tangents[idx];
  const pos = new THREE.Vector3(c.x + r.x*grid.lane, 0, c.z + r.z*grid.lane);
  const yaw = Math.atan2(t.x, t.z);
  const modelKey = spec.model || 'ferrari';
  mesh.position.copy(pos);
  // 与比赛中的朝向公式保持一致：rotation.y = yaw + 模型自身的 yawFix
  mesh.rotation.y = yaw + ((CAR_MODELS[modelKey]||CAR_MODELS.ferrari).yawFix);
  const light = new THREE.PointLight(spec.neon, 1.15, 9, 1.8);
  light.position.set(pos.x, 0.55, pos.z);
  G.scene.add(mesh, light);
  const car = {
    id, isPlayer, spec, st, mesh, light,
    pos: pos.clone(), yaw, speed:0, latVel:0,
    idx, offDist:0, trackDist: relArc(track, idx) + grid.d, lastRaw:0,
    lap:0, lastLap:null, bestLap:null, lapStart:0, finishTime:null, finished:false,
    nitro: isPlayer? 1 : 0.5, driftScore:0, drifting:false, offroad:false,
    wrongTimer:0, camShake:0, spin:0, steerVis:0,
    ai:{ steer:0, throttle:0, targetSpeed:0,
      // 每辆 AI 不同的行驶车道与速度档，让车队错开不扎堆（车道按赛道宽度比例分布）
      line: isPlayer ? 0 : ([-0.19,-0.094,0.016,0.11,0.22][Math.max(0, aiIndex)] || 0) * tdef.width,
      pace: isPlayer ? 1 : (0.99 + Math.max(0, aiIndex)*0.04) },
  };
  return car;
}

/* 车辆在赛道上的最近采样点与横向偏移 */
function updateTrackPos(car){
  const track = G.world.track, N = track.N;
  let best = car.idx, bd = 1e18;
  const win = 140;
  for(let k=-win;k<=win;k++){
    const i = ((car.idx + k) % N + N) % N;
    const c = track.centers[i];
    const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
    const d = dx*dx + dz*dz;
    if(d < bd){ bd = d; best = i; }
  }
  const c = track.centers[best], r = track.rights[best];
  const ox = car.pos.x - c.x, oz = car.pos.z - c.z;
  car.idx = best;
  car.offDist = ox*r.x + oz*r.z;
  const old = car.trackDist;
  car.trackDist = relArc(track, best);
  // 跨线检测
  if(old > track.totalLen*0.55 && car.trackDist < track.totalLen*0.05 && car.speed > 2){
    car.lap++;
    onLapCross(car);
  } else if(car.trackDist > track.totalLen*0.55 && old < track.totalLen*0.05 && car.speed > 2){
    car.lap = Math.max(0, car.lap-1);
  }
  car.lastRaw = old;
}

function onLapCross(car){
  const track = G.world.track;
  if(car.isPlayer){
    // lapStart / G.time 均为绝对时间轴，单圈时长首次过线即可记录
    const now = G.time;
    if(car.lap >= 1){
      const lt = now - car.lapStart;
      car.lastLap = lt;
      if(car.bestLap==null || lt < car.bestLap) car.bestLap = lt;
    }
    car.lapStart = now;
    updateHud();
  }
  if(car.lap >= G.world.laps){
    car.finished = true;
    car.finishTime = G.time - G.goTime;
    if(car.isPlayer) onPlayerFinish();
  }
}

function updateCar(car, input, dt){
  const st = car.st;
  const top = st.top / 3.6;
  const half = G.world.tdef.width/2;
  // 动力（引擎功率曲线 + 线性/平方阻力，保证极速与加速手感）
  const powerAt = Math.max(0, 1 - Math.pow(Math.abs(car.speed)/top, 2.6));
  // 手刹抱死后轮时，油门几乎传不到地面，推力大幅衰减
  let accel = input.throttle * st.accel * 30 * powerAt * (input.handbrake ? 0.12 : 1);
  if(input.nitro && car.nitro > 0.02 && (input.throttle > 0.35 || car.speed > 10)){
    accel += 26;
    car.nitro = Math.max(0, car.nitro - dt*0.42);
  } else {
    car.nitro = Math.min(1, car.nitro + dt*0.05);
  }
  if(input.brake){
    const brk = (car.speed > 0.6) ? 30 : 18;
    accel -= brk;
  }
  // 手刹拖拽：抱死的后轮持续与地面摩擦，漂移过程中应当明显掉速（高速掉得更快）
  if(input.handbrake && car.speed > 4){
    accel -= 6 + Math.min(8, Math.abs(car.speed)*0.15);
  }
  const dragScale = car.offroad ? 4.2 : 1;
  accel -= car.speed * 0.02 * dragScale;
  accel -= car.speed * Math.abs(car.speed) * 0.0007 * dragScale;
  car.speed += accel * dt;
  if(car.offroad && car.speed > 24) car.speed = Math.max(24, car.speed - 26*dt);
  if(car.speed < -16) car.speed = -16;
  // 转向（速度相关的渐进手感：低速灵活挪车、40km/h 附近最灵敏、高速转向半径渐大防止甩尾）
  const steerFactor = 1/(1 + Math.abs(car.speed)/16);
  const maxSteer = st.hand * 1.05;
  const steerAng = input.steer * maxSteer * steerFactor;
  const gripMul = input.handbrake ? 0.30 : 1;
  const sp = Math.abs(car.speed);
  // 手刹甩尾：车头必须主动向弯内旋转，否则只是车身横向平移、车头不动
  const driftKick = (input.handbrake && car.speed > 12)
    ? input.steer * clamp(sp*0.045, 0.35, 0.80)
    : 0;
  let yawRate = steerAng * Math.min(2.6, (sp + 5) * 0.16) + driftKick;
  yawRate = clamp(yawRate, -1.35, 1.35);              // 限制甩尾角速度，避免原地打转
  car.yaw += yawRate * dt * (car.offroad? 0.7 : 1);
  // 侧向
  const gripDecay = Math.max(0, 1 - st.grip*gripMul*3.4*dt);
  car.latVel *= gripDecay;
  car.steerVis += (input.steer - car.steerVis)*Math.min(1, 6*dt);
  if(input.handbrake && car.speed > 12){
    car.latVel += input.steer * car.speed * 0.42 * dt;
    // 侧滑速度设上限（滑移角约 30°），让车是"斜着滑过弯"而不是横着平移
    const latMax = Math.max(4, sp * 0.62);
    car.latVel = clamp(car.latVel, -latMax, latMax);
  }
  if(car.offroad){ car.latVel *= 0.9; }
  // 积分
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
  car.pos.x += (fx*car.speed + rx*car.latVel) * dt;
  car.pos.z += (fz*car.speed + rz*car.latVel) * dt;
  // 路缘/护栏约束：按车身朝向计算实际占用宽度，避免车头或车身插进护栏里
  updateTrackPos(car);
  const mk = (car.spec && car.spec.model) || 'ferrari';
  const halfLen = ((CAR_MODELS[mk]||CAR_MODELS.ferrari).size || 4.9) / 2;
  const halfWid = halfLen * 0.46;
  const grassEdge = half - 1.1;
  car.offroad = Math.abs(car.offDist) > grassEdge;
  if(Math.abs(car.offDist) > half - halfWid - 0.2){
    const c = G.world.track.centers[car.idx];
    const rv = G.world.track.rights[car.idx];
    const sgn = Math.sign(car.offDist);
    const nx = rv.x*sgn, nz = rv.z*sgn;                 // 指向护栏外的法线
    // 车身矩形在法线方向上的投影：正向撞墙时按车长算，平行贴墙时按车宽算
    const proj = halfLen*Math.abs(fx*nx + fz*nz) + halfWid*Math.abs(rx*nx + rz*nz);
    const limit = half - Math.max(halfWid, proj) - 0.12;
    if(Math.abs(car.offDist) > limit){
      const cx = c.x + rv.x*limit*sgn, cz = c.z + rv.z*limit*sgn;
      car.pos.x = cx; car.pos.z = cz;
      // 撞墙回弹：把法向速度反射回去并衰减，而不是简单贴死在墙上
      const vx0 = fx*car.speed + rx*car.latVel;
      const vz0 = fz*car.speed + rz*car.latVel;
      const vn = vx0*nx + vz0*nz;                       // >0 表示正朝墙里冲
      car.wallCool = Math.max(0, (car.wallCool||0) - dt);
      if(vn > 0.8){
        const REST = 0.45;                              // 回弹系数
        const vx1 = (vx0 - (1+REST)*vn*nx) * 0.94;      // 反射法向 + 切向损耗
        const vz1 = (vz0 - (1+REST)*vn*nz) * 0.94;
        car.speed  = vx1*fx + vz1*fz;
        car.latVel = vx1*rx + vz1*rz;
        if(car.wallCool <= 0){
          car.wallCool = 0.25;
          car.camShake = Math.max(car.camShake, Math.min(0.9, vn*0.06 + 0.12));
          if(car.isPlayer) AudioSys.crash(Math.min(1, vn/26));
          spawnSpark(car.pos.x - fx*1.6, 0.4, car.pos.z - fz*1.6);
        }
      }
    }
  }
  // 漂移判定
  const slip = Math.abs(Math.atan2(car.latVel, Math.max(Math.abs(car.speed), 1))) * 57.3;
  const drifting = car.speed > 26 && slip > 11 && (Math.abs(input.steer) > 0.06 || input.handbrake);
  car.drifting = drifting;
  if(drifting){
    car.driftScore += car.speed * dt * 2.4;
    car.nitro = Math.min(1, car.nitro + dt*0.10);
  }
  // 胎痕：手刹抱死后轮、或车身已经横滑时就留痕。与"漂移判定"解耦，
  // 否则侧滑角要攒一两秒才过阈值，痕迹会在还没滑起来之前就断掉
  const skidding = car.isPlayer && !car.offroad && car.speed > 10 && (drifting || input.handbrake);
  if(skidding) markSkid(car); else car.skidPrev = null;
  // 漂移胎噪：按滑移角实时给音量，不滑了就归零（否则噪音会一直残留在后台）
  if(car.isPlayer){
    AudioSys.skid(skidding ? clamp((input.handbrake ? 0.45 : 0) + slip/26, 0.2, 1) : 0);
  }
  if(!drifting){
    if(car.offroad && car.isPlayer && car.speed > 6){
      spawnSmoke(car.pos.x - fx*1.8, 0.2, car.pos.z - fz*1.8, 0, 0, 0x7a6a55);
    }
  }
  if(car.driftScore >= 120){
    if(car.isPlayer) popDrift(Math.round(car.driftScore));
    car.driftScore = 0;
  }
  if(!drifting) car.driftScore = Math.max(0, car.driftScore - dt*40);
  // 氮气：车尾喷出白色雾气
  if(car.boosting && car.speed > 5) spawnNitroMist(car, dt);
}

function updateAI(car, dt){
  const track = G.world.track, N = track.N;
  // 前视点按速度缩放但设上限：弯道里看得太远会切内道撞墙（窄弯赛道尤其明显）
  const look = Math.max(8, Math.min(28, Math.floor(22 * (0.55 + Math.abs(car.speed)/42))));
  let angSum = 0, cnt = 0, peakAng = 0;
  for(let k=3;k<look;k+=3){
    const t1 = track.tangents[(car.idx+k)%N], t2 = track.tangents[(car.idx+k+6)%N];
    const a = Math.acos(clamp(t1.dot(t2), -1, 1));
    angSum += a; cnt++;
    if(a > peakAng) peakAng = a;
  }
  // 用前方最急的弯（峰值）而不是平均值：发卡弯不会被平均值稀释，进弯前就能提前收油
  const curv = peakAng || (cnt ? angSum/cnt : 0.05);
  const top = car.st.top/3.6;
  const cornerSpeed = Math.sqrt(900 / Math.max(curv, 0.12));
  let target = Math.min(top*1.12, cornerSpeed, 92);
  target *= car.ai.pace || 1;
  const player = G.world.player;
  const pd = (player.lap*track.totalLen + player.trackDist) - (car.lap*track.totalLen + car.trackDist);
  target *= clamp(1 + pd/4600, 0.94, 1.16);
  target = Math.max(10, target);
  // 跟车：正前方 11m 内有行驶中的车才收油（排除静止车与横向擦边的车），保持间距不叠在一起
  for(const o of G.world.cars){
    if(o === car || o.speed < 3) continue;
    const odx = o.pos.x - car.pos.x, odz = o.pos.z - car.pos.z;
    const d = Math.hypot(odx, odz);
    if(d < 11){
      const proj = odx*Math.sin(car.yaw) + odz*Math.cos(car.yaw);
      if(proj > d*0.4) target = Math.min(target, o.speed*0.95);
    }
  }
  // 避让玩家
  const ddx = player.pos.x - car.pos.x, ddz = player.pos.z - car.pos.z;
  const pd2 = Math.hypot(ddx, ddz);
  if(pd2 < 11 && (pd > -6)){
    target *= 0.9;
  }
  const ti = (car.idx + look + 4) % N;
  const tp = track.centers[ti];
  const toTarget = Math.atan2(tp.x - car.pos.x, tp.z - car.pos.z);
  let dYaw = toTarget - car.yaw;
  while(dYaw > Math.PI) dYaw -= TAU; while(dYaw < -Math.PI) dYaw += TAU;
  // 航向对准 + 回到自己的车道线（line 差异化让车队错开）
  car.ai.steer = clamp(dYaw * 2.4 - (car.offDist - (car.ai.line||0)) * 0.28, -1, 1);
  const thr = car.speed < target ? 1 : (car.speed > target*1.22 ? -0.4 : 0.15);
  const brk = car.speed > target*1.3 ? 0.85 : 0;
  // AI 不做手刹漂移（漂移只留给玩家），入弯提前收油，走线稳定
  const hb = 0;
  updateCar(car, { throttle: Math.max(0, thr), brake: brk, steer: car.ai.steer, handbrake: hb>0.5, nitro:false }, dt);
}

function collideCars(){
  const cars = G.world.cars;
  for(let i=0;i<cars.length;i++){
    for(let j=i+1;j<cars.length;j++){
      const a=cars[i], b=cars[j];
      const dx=a.pos.x-b.pos.x, dz=a.pos.z-b.pos.z;
      const d=Math.hypot(dx,dz), min=3.4;
      if(d<min && d>0.0001){
        const push=(min-d)/2;
        const nx=dx/d, nz=dz/d;
        a.pos.x+=nx*push; a.pos.z+=nz*push;
        b.pos.x-=nx*push; b.pos.z-=nz*push;
        const rel = a.speed - b.speed;
        if(Math.abs(rel) > 2){
          a.speed -= rel*0.22; b.speed += rel*0.22;
        }
        if(Math.abs(rel) > 6){
          spawnSpark((a.pos.x+b.pos.x)/2, 0.5, (a.pos.z+b.pos.z)/2);
          if(a.isPlayer || b.isPlayer) AudioSys.crash(0.45);
        }
      }
    }
  }
}

/* ---------- 粒子池 ---------- */
function makeSmokeTex(){
  const c = document.createElement('canvas'); c.width=64; c.height=64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32,32,4,32,32,30);
  g.addColorStop(0,'rgba(255,255,255,0.85)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}
function createParticlePool(){
  const tex = makeSmokeTex();
  const mat = new THREE.SpriteMaterial({ map:tex, color:0x9fb8cc, transparent:true, opacity:0, depthWrite:false });
  const sprites = [];
  for(let i=0;i<72;i++){
    const s = new THREE.Sprite(mat.clone());
    s.visible = false;
    G.scene.add(s);
    sprites.push(s);
  }
  const list = new Array(72).fill(null);
  return { sprites, list, cursor:0 };
}
function spawnParticle(pos, vel, color, size, life, grow, alpha){
  const pool = G.world.particles;
  const i = pool.cursor; pool.cursor = (pool.cursor+1) % pool.sprites.length;
  const s = pool.sprites[i];
  s.visible = true;
  s.material.color.setHex(color);
  s.material.opacity = 0.4;
  s.position.copy(pos);
  pool.list[i] = { s, vel: vel.clone(), size, life, maxLife: life, grow, color, alpha: alpha||0.42 };
}
function spawnSmoke(x,y,z,vx,vz,color){
  const r = Math.random();
  spawnParticle(new THREE.Vector3(x,y,z), new THREE.Vector3(vx + (Math.random()-0.5)*2, 1.1+Math.random()*0.8, vz + (Math.random()-0.5)*2), color, 1.6+Math.random()*1.6, 0.75+r*0.5, 3.2);
}
function spawnSpark(x,y,z){
  for(let i=0;i<4;i++){
    spawnParticle(new THREE.Vector3(x,y,z), new THREE.Vector3((Math.random()-0.5)*9, 3+Math.random()*4, (Math.random()-0.5)*9), 0xffb300, 0.35, 0.4, 0.5);
  }
}
function updateParticles(dt){
  const pool = G.world.particles;
  for(let i=0;i<pool.list.length;i++){
    const p = pool.list[i];
    if(!p) continue;
    p.life -= dt;
    if(p.life <= 0){
      p.s.visible = false; pool.list[i] = null; continue;
    }
    p.s.position.addScaledVector(p.vel, dt);
    p.vel.y += 0.6*dt;
    const k = p.life/p.maxLife;
    p.s.material.opacity = k*(p.alpha||0.42);
    const sc = p.size + p.grow*(1-k);
    p.s.scale.set(sc, sc, 1);
  }
}

/* ---------- 氮气尾雾：车尾喷出的白色雾气 ---------- */
function spawnNitroMist(car, dt){
  car.mistAcc = (car.mistAcc || 0) + dt;
  if(car.mistAcc < 0.028) return;
  car.mistAcc = 0;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
  const back = car.speed*0.4 + 6;   // 雾团留在车后，而不是被车甩开
  for(const s of [0.34, -0.34]){
    spawnParticle(
      new THREE.Vector3(car.pos.x - fx*1.6 + rx*s, 0.34, car.pos.z - fz*1.6 + rz*s),
      new THREE.Vector3(-fx*back + (Math.random()-0.5)*2, 0.8 + Math.random()*0.7, -fz*back + (Math.random()-0.5)*2),
      0xf2f7ff, 0.85 + Math.random()*0.5, 0.5 + Math.random()*0.2, 2.0, 0.62
    );
  }
}

/* ---------- 漂移胎痕：贴地的黑色刹车痕迹（InstancedMesh 一次绘制） ---------- */
const SKID_COUNT = 320;
const SKID_LIFE = 7.0;
const _skQ = new THREE.Quaternion(), _skP = new THREE.Vector3(), _skS = new THREE.Vector3();
const _skM = new THREE.Matrix4(), _skC = new THREE.Color(), _skHide = new THREE.Matrix4().makeScale(0,0,0);
const _skRoad = new THREE.Color(0x4a5060);
function createSkidMarks(){
  const geo = new THREE.PlaneGeometry(0.3, 1);
  const mat = new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.72, depthWrite:false });
  const mesh = new THREE.InstancedMesh(geo, mat, SKID_COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const col = new THREE.Color(0x0a0b0d);
  for(let i=0;i<SKID_COUNT;i++){ mesh.setMatrixAt(i, _skHide); mesh.setColorAt(i, col); }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  G.scene.add(mesh);
  return { mesh, items: new Array(SKID_COUNT).fill(null), cursor:0 };
}
function addSkidSeg(sk, x, z, yaw, len){
  const i = sk.cursor; sk.cursor = (sk.cursor+1) % SKID_COUNT;
  sk.items[i] = { i, life: SKID_LIFE };
  _skQ.setFromEuler(new THREE.Euler(-Math.PI/2, yaw, 0, 'YXZ'));
  _skP.set(x, 0.045, z);
  _skS.set(1, Math.max(0.4, len), 1);
  _skM.compose(_skP, _skQ, _skS);
  sk.mesh.setMatrixAt(i, _skM);
  _skC.setHex(0x0a0b0d);
  sk.mesh.setColorAt(i, _skC);
  sk.mesh.instanceMatrix.needsUpdate = true;
  sk.mesh.instanceColor.needsUpdate = true;
}
/* 按两后轮的移动轨迹逐段拉出痕迹，跟帧率无关，高速下也不会断成虚线 */
function markSkid(car){
  const w = G.world;
  if(!w || !w.skids) return;
  const sk = w.skids;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
  const pts = [
    [car.pos.x - fx*1.35 + rx*0.62, car.pos.z - fz*1.35 + rz*0.62],
    [car.pos.x - fx*1.35 - rx*0.62, car.pos.z - fz*1.35 - rz*0.62],
  ];
  if(!car.skidPrev) car.skidPrev = pts.map(p=>({ x:p[0], z:p[1] }));
  for(let k=0;k<2;k++){
    const a = car.skidPrev[k], bx = pts[k][0], bz = pts[k][1];
    const dx = bx - a.x, dz = bz - a.z;
    const d = Math.hypot(dx, dz);
    if(d < 0.35) continue;
    if(d > 8){ car.skidPrev[k] = { x:bx, z:bz }; continue; }   // 瞬移/重置不拉长条
    addSkidSeg(sk, (a.x+bx)/2, (a.z+bz)/2, Math.atan2(dx, dz), d + 0.3);
    car.skidPrev[k] = { x:bx, z:bz };
  }
}
/* 胎痕老化：末段渐隐到沥青灰，随后移出视野 */
function updateSkids(dt){
  const w = G.world;
  if(!w || !w.skids) return;
  const sk = w.skids;
  let dirty = false;
  for(let k=0;k<sk.items.length;k++){
    const it = sk.items[k];
    if(!it) continue;
    it.life -= dt;
    if(it.life <= 0){
      sk.mesh.setMatrixAt(it.i, _skHide);
      sk.items[k] = null; dirty = true; continue;
    }
    if(it.life < 1.5){
      const t = 1 - it.life/1.5;
      _skC.setHex(0x0a0b0d).lerp(_skRoad, t);
      sk.mesh.setColorAt(it.i, _skC);
      dirty = true;
    }
  }
  if(dirty){
    sk.mesh.instanceMatrix.needsUpdate = true;
    sk.mesh.instanceColor.needsUpdate = true;
  }
}

/* ---------- 小地图 / 大地图 ---------- */
let mapData = null;
let mapStaticCache = {};
function buildMapPaths(){
  const track = G.world.track;
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  track.centers.forEach(p=>{
    minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
    minZ=Math.min(minZ,p.z); maxZ=Math.max(maxZ,p.z);
  });
  mapData = { minX:minX-46, maxX:maxX+46, minZ:minZ-46, maxZ:maxZ+46, track };
  mapStaticCache = {}; // 换赛道后静态底图失效
}
function mapXY(p){
  const md = mapData;
  return [ (p.x-md.minX)/(md.maxX-md.minX), 1 - (p.z-md.minZ)/(md.maxZ-md.minZ) ];
}
/* 赛道底图（路面/起点/检查点）与车辆无关，按尺寸预渲染一次，每帧只贴图+画车 */
function mapStaticLayer(W, H, big){
  const key = W + 'x' + H + (big ? 'b' : 's');
  if(mapStaticCache[key]) return mapStaticCache[key];
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const track = mapData.track, N = track.N;
  ctx.beginPath();
  for(let i=0;i<=N;i++){
    const [x,y] = mapXY(track.centers[i%N]);
    i ? ctx.lineTo(x*W, y*H) : ctx.moveTo(x*W, y*H);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(23,28,41,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,229,255,0.55)';
  ctx.lineWidth = big? 3 : 1.6;
  ctx.stroke();
  // 起点
  const [sx,sy] = mapXY(track.centers[track.startIdx]);
  ctx.fillStyle = '#ffb300';
  ctx.beginPath(); ctx.arc(sx*W, sy*H, big?7:4, 0, TAU); ctx.fill();
  // 检查点
  ctx.fillStyle = 'rgba(255,46,136,0.55)';
  for(let k=1;k<=6;k++){
    const i = (track.startIdx + Math.floor(N*k/7)) % N;
    const [gx,gy] = mapXY(track.centers[i]);
    ctx.beginPath(); ctx.arc(gx*W, gy*H, big?4:2, 0, TAU); ctx.fill();
  }
  mapStaticCache[key] = cv;
  return cv;
}
function drawMap(canvas, big){
  if(!mapData) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(mapStaticLayer(W,H,big), 0, 0);
  // 车辆
  G.world.cars.forEach(c=>{
    const [cx,cy] = mapXY(c.pos);
    const x = cx*W, y = cy*H;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(c.yaw - Math.PI/2);
    ctx.fillStyle = c.isPlayer ? '#00e5ff' : '#ff2e88';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = big?1.5:1;
    const sz = big? 8 : 5;
    ctx.beginPath();
    ctx.moveTo(sz,0); ctx.lineTo(-sz*0.7,-sz*0.7); ctx.lineTo(-sz*0.7,sz*0.7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  });
}
