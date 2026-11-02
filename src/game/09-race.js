/* ============================================================
   比赛流程
   ============================================================ */
function startRace(){
  if(!carModelReady){ showToast('车辆模型加载中，请稍候…'); return; }
  if(G.showcase && G.showcase.root) G.showcase.root.visible = false;
  window.focus();
  AudioSys.init(); AudioSys.resume();
  clearWorld();
  buildWorld();
  G.mode = 'race';
  G.raceState = 'countdown';
  // 菜单里为了展车压暗了曝光/辉光，回到比赛恢复标准档位
  G.renderer.toneMappingExposure = 1.02;
  if(G.bloomPass) G.bloomPass.strength = G.quality.low ? 0.42 : 0.55;
  G.countdownT = CFG.countdownTime;
  G.goTime = G.time + CFG.countdownTime;
  G.paused = false;
  G.finishTimer = 0;
  G.simInput = null;
  const p = G.world.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  G.camera.position.set(p.pos.x - fx*7.2, 3.2, p.pos.z - fz*7.2);
  G.camera.lookAt(p.pos.x + fx*5, 0.9, p.pos.z + fz*5);
  G.camLook = { x: p.pos.x + fx*5, z: p.pos.z + fz*5 };
  G.camera.fov = 45; G.camera.updateProjectionMatrix();
  $('#view-menu').classList.add('hidden');
  $('#view-result').classList.add('hidden');
  $('#view-hud').classList.remove('hidden');
  $('#pauseOverlay').classList.remove('show');
  $('#mapOverlay').classList.remove('show');
  hideCountdown();
  $('#wrongway').style.display = 'none';
  const mc = $('#miniMap'); mc.width = 300; mc.height = 300;
  updateHud();
  computePos();
  showCountdown('3');
  AudioSys.blip(440, 0.12, 'square', 0.22);
}

function onPlayerFinish(){
  G.raceState = 'done';
  G.finishTimer = 1.2;
  showCountdown('FINISH', 'go');
  AudioSys.blip(784, 0.2, 'square', 0.3);
  setTimeout(()=>{ hideCountdown(); }, 1200);
}

function updateRace(dt){
  const w = G.world;
  if(G.raceState==='countdown'){
    G.countdownT -= dt;
    const n = Math.ceil(G.countdownT);
    const el = $('#countdown');
    if(n >= 1 && el.textContent !== String(n)){
      el.textContent = String(n);
      el.className = 'countdown';
      el.style.display = 'block';
      AudioSys.blip(520, 0.1, 'square', 0.2);
    } else if(n < 1 && el.textContent !== 'GO!'){
      el.textContent = 'GO!';
      el.className = 'countdown go';
      el.style.display = 'block';
      AudioSys.blip(880, 0.25, 'square', 0.3);
    }
    if(G.countdownT <= 0){
      G.raceState = 'racing';
      w.player.lapStart = G.time;
      hideCountdown();
    }
    const inp = readInput();
    const rpm = clamp(inp.throttle*0.5, 0, 0.6);
    AudioSys.engine(rpm, inp.throttle, true);
    updateHud();
    return;
  }
  if(G.raceState==='done'){
    G.finishTimer -= dt;
    const inp = readInput();
    w.player.boosting = false;
    updateCar(w.player, { throttle:0.25, brake:inp.brake, steer:inp.steer, handbrake:false, nitro:false }, dt);
    w.cars.forEach(c=>{ if(!c.isPlayer && !c.finished) updateAI(c, dt); });
    collideCars();
    updateParticles(dt);
    updateSkids(dt);
    updateCamera(dt);
    syncCarVisuals(dt);
    if(G.finishTimer <= 0){ showResult(); return; }
    return;
  }
  // racing
  const inp = readInput();
  const boost = !!(inp.nitro && w.player.nitro > 0.02 && (inp.throttle > 0.35 || w.player.speed > 10));
  w.player.boosting = boost;
  if(inp.throttle > 0.2 || inp.brake || inp.handbrake || inp.nitro || Math.abs(inp.steer) > 0.1) G.playerInputEver = true;
  updateCar(w.player, inp, dt);
  w.cars.forEach(c=>{ if(!c.isPlayer) updateAI(c, dt); });
  collideCars();
  updateParticles(dt);
  updateSkids(dt);
  updateCamera(dt);
  updateHud();
  // 音频
  const rpm = clamp(Math.abs(w.player.speed)/(w.player.st.top/3.6), 0, 1);
  AudioSys.engine(rpm, inp.throttle, true);
  AudioSys.nitro(boost && w.player.speed>4);
  // 方向错误
  const fx = Math.sin(w.player.yaw), fz = Math.cos(w.player.yaw);
  const tg = w.track.tangents[w.player.idx];
  const wrong = (fx*tg.x + fz*tg.z) < -0.25 && w.player.speed > 8;
  w.player.wrongTimer = wrong ? w.player.wrongTimer + dt : 0;
  $('#wrongway').style.display = (w.player.wrongTimer > 1) ? 'block' : 'none';
  // 输入焦点兜底：长时间无任何驱动输入时提示点击画面
  const focusNoInput = !G.playerInputEver && (G.time - G.goTime) > 3.5;
  $('#focusHint').style.display = focusNoInput ? 'block' : 'none';
  // 速度线（氮气喷射时再加一层）
  const sl = $('#speedLines');
  sl.style.opacity = clamp((Math.abs(w.player.speed)-32)/85 + (boost?0.35:0), 0, 1).toFixed(3);
  // 小地图：静态底图已预渲染，20Hz 刷新足够
  mapTimer -= dt;
  if(mapTimer <= 0){ drawMap($('#miniMap'), false); mapTimer = 0.05; }
  // 车轮旋转 + 车身同步（位置/朝向/侧倾——此前车身从不跟随物理位置，玩家一直开"看不见的车"）
  syncCarVisuals(dt);
  updateDriftPop(dt);
  posTimer -= dt;
  if(posTimer <= 0){ computePos(); posTimer = 0.2; }
}

/* 车身视觉同步：比赛中与冲线后的"done"阶段都要调用，否则冲线后车辆继续滑行而模型留在原地，看起来像凭空消失 */
function syncCarVisuals(dt){
  const w = G.world;
  w.cars.forEach(c=>{
    const rot = c.speed/0.34*dt;
    c.mesh.userData.wheels.forEach(wl=>{ wl.rotation.x += rot; });
    c.mesh.position.set(c.pos.x, 0, c.pos.z);
    const mk = c.mesh.userData && c.mesh.userData.modelKey;
    c.mesh.rotation.y = c.yaw + ((CAR_MODELS[mk]||CAR_MODELS.ferrari).yawFix);
    const roll = -c.steerVis * clamp(Math.abs(c.speed)/42, 0, 1) * 0.14;
    c.mesh.rotation.z = clamp(roll, -0.09, 0.09);
    // 氮气喷射：底盘氛围灯略微变亮；不再大幅提亮，否则夜间会糊成一团白雾
    if(c.mesh.userData.glow) c.mesh.userData.glow.material.opacity = c.boosting ? 0.3 : 0.12;
    c.light.position.set(c.pos.x, 0.55, c.pos.z);
  });
  w.shadows.forEach((s,i)=>{ s.position.x = w.cars[i].pos.x; s.position.z = w.cars[i].pos.z; });
}

function computePos(){
  const w = G.world;
  const key = c => c.finished ? (1e9 - c.finishTime) : (c.lap*w.track.totalLen + c.trackDist);
  const sorted = [...w.cars].sort((a,b)=> key(b)-key(a));
  w.cars.forEach(c=>{ c.posRank = sorted.indexOf(c)+1; });
  // 名次显示为 "当前名次/总人数"，数字与斜杠总数分开写，避免出现 3/6/6 这样的重复
  if(w.player){
    $('#hudPos').textContent = w.player.posRank;
    $('#hudPosTotal').textContent = '/' + w.cars.length;
  }
}

function updateCamera(dt){
  if(G.cameraFreeze) return;
  const w = G.world;
  const car = w.player;
  // 月光跟随玩家：阴影始终覆盖玩家周围赛道
  if(G.moon){
    G.moon.position.set(car.pos.x + 70, 110, car.pos.z + 55);
    G.moon.target.position.set(car.pos.x, 0, car.pos.z);
  }
  const modes = [
    { dist:7.4, h:3.2, look:5.0 },
    { dist:0.4, h:1.42, look:14 },
    { dist:11, h:5.6, look:2.2 },
  ];
  const m = modes[w.cameraMode];
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
  const side = w.cameraMode===1 ? 0 : 0.8;
  const tx = car.pos.x - fx*m.dist + rx*side;
  const tz = car.pos.z - fz*m.dist + rz*side;
  const ty = m.h + Math.sin(G.time*1.3)*0.04;
  const k = 1 - Math.exp(-7*dt);
  G.camera.position.x += (tx - G.camera.position.x)*k;
  G.camera.position.y += (ty - G.camera.position.y)*k;
  G.camera.position.z += (tz - G.camera.position.z)*k;
  if(car.camShake > 0){
    G.camera.position.x += (Math.random()-0.5)*car.camShake*0.5;
    G.camera.position.y += (Math.random()-0.5)*car.camShake*0.4;
    car.camShake = Math.max(0, car.camShake - dt*1.5);
  }
  // 镜头横摆：向转向同侧取景，车身向转弯方向偏移（转向可见化，符号与 A左/D右 一致）
  const sway = (w.cameraMode===1 ? 0 : -car.steerVis*(m.look*0.45));
  // 视线目标同样平滑：转向时画面像被"拖"过去，而不是硬邦邦地锁死前方
  const lookX = car.pos.x + fx*m.look - rx*sway;
  const lookZ = car.pos.z + fz*m.look - rz*sway;
  if(!G.camLook) G.camLook = { x:lookX, z:lookZ };
  const lk = 1 - Math.exp(-10*dt);
  G.camLook.x += (lookX - G.camLook.x)*lk;
  G.camLook.z += (lookZ - G.camLook.z)*lk;
  G.camera.lookAt(G.camLook.x, 0.9, G.camLook.z);
  // 压弯侧倾：过弯时画面轻微歪斜，驾驶体感更真实
  const roll = clamp(-car.steerVis*0.016 - car.latVel*0.0014, -0.03, 0.03);
  G.camera.rotateZ(roll);
  const tf = 45 + clamp(Math.abs(car.speed)/70, 0, 1)*16 + (car.drifting? 6 : 0) + (car.boosting? 5 : 0);
  G.camera.fov += (tf - G.camera.fov)*Math.min(1, 4*dt);
  G.camera.updateProjectionMatrix();
}

let hudLastT = -1;
function updateHud(){
  // 比赛中 15Hz 刷新足够：避免每帧写 DOM 触发无谓的重排
  if(G.raceState==='racing' && hudLastT >= 0 && G.time - hudLastT < 0.066) return;
  hudLastT = G.time;
  const w = G.world;
  if(!w) return;
  const p = w.player;
  $('#hudLap').textContent = Math.min(p.lap+1, w.laps);
  $('#hudLapTotal').textContent = '/' + w.laps;
  $('#hudSpeed').textContent = fmtSpeed(Math.abs(p.speed));
  $('#nitroFill').style.width = (p.nitro*100).toFixed(0) + '%';
  $('#nitroFill').classList.toggle('boost', !!p.boosting);
  if(G.raceState==='racing'){
    $('#hudTime').textContent = fmtTime(Math.max(0, G.time - p.lapStart));
  } else if(G.raceState==='countdown'){
    $('#hudTime').textContent = fmtTime(0);
  } else if(p.lastLap != null){
    $('#hudTime').textContent = fmtTime(p.lastLap);
  }
  $('#hudBest').textContent = fmtTime(p.bestLap);
  const r = Math.abs(p.speed)/(p.st.top/3.6);
  const n = readInput().nitro;
  $('#hudGear').textContent = p.speed < -0.5 ? 'R' : ((n && p.nitro>0.2 && p.speed>4) ? 'N' : String(1+Math.floor(Math.min(1,r)*6)));
}

/* ---------- 暂停 / 结果 / 菜单 ---------- */
function pauseRace(show){
  if(G.mode!=='race') return;
  G.paused = show;
  $('#pauseOverlay').classList.toggle('show', show);
  if(show){ AudioSys.engine(0, 0, false); AudioSys.skid(0); }
}

function showResult(){
  const w = G.world;
  const key = c => c.finished ? (1e12 - c.finishTime) : (c.lap*w.track.totalLen + c.trackDist);
  const sorted = [...w.cars].sort((a,b)=> key(b)-key(a));
  sorted.forEach((c,i)=>{ c.posRank = i+1; });
  const tbody = $('#standingsBody');
  tbody.innerHTML = '';
  sorted.forEach((c, i)=>{
    const tr = document.createElement('tr');
    if(c.isPlayer) tr.className = 'me';
    const rank = i+1;
    const name = c.isPlayer ? '玩家' : (c.spec.aiName || '对手');
    const carName = c.isPlayer ? CARS[G.selectedCar].name : (c.spec.name || 'AI 对手');
    const timeTxt = c.finished ? fmtTime(c.finishTime) : (c.lap + ' 圈 · 进行中');
    const col = c.isPlayer ? '00e5ff' : AI_COLORS[c.id-1].toString(16).padStart(6,'0');
    tr.innerHTML = '<td class="rank r'+rank+'">'+rank+'</td><td><span class="car-dot" style="background:#'+col+'"></span>'+name+'</td><td>'+carName+'</td><td class="time-col">'+timeTxt+'</td>';
    tbody.appendChild(tr);
  });
  const win = w.player.posRank === 1;
  const title = $('#resultTitle');
  title.textContent = win ? '冠 军!' : '冲 线 完 成';
  title.className = 'result-title ' + (win ? 'win' : 'lose');
  const best = w.player.bestLap ? ' · 最佳单圈 ' + fmtTime(w.player.bestLap) : '';
  // 写入赛道纪录（单圈 / 总时间），并提示是否破纪录
  const recInfo = saveRecord(w.tdef.id, w.player.bestLap, w.player.finished ? w.player.finishTime : null);
  const recTxt = (recInfo.newLap || recInfo.newTotal) ? ' · 新纪录！' : '';
  $('#resultSub').textContent = w.tdef.name + ' · ' + w.laps + ' 圈' + (w.player.finished ? ' · 用时 ' + fmtTime(w.player.finishTime) : '') + best + recTxt;
  $('#view-hud').classList.add('hidden');
  $('#view-result').classList.remove('hidden');
  G.mode = 'result';
  AudioSys.engine(0.08, 0, false);
  AudioSys.blip(win ? 1046 : 660, 0.3, 'square', 0.25);
}

function toMenu(){
  clearWorld();
  clearEdges(); // 清空残留按键标记，防止菜单页自动跳车
  if(G.showcase && G.showcase.root) G.showcase.root.visible = true;
  G.mode = 'menu';
  G.paused = false;
  G.simInput = null;
  $('#view-hud').classList.add('hidden');
  $('#view-result').classList.add('hidden');
  $('#view-menu').classList.remove('hidden');
  $('#mapOverlay').classList.remove('show');
  hideCountdown();
  $('#wrongway').style.display = 'none';
  AudioSys.engine(0, 0, false);
}

function toggleMap(){
  if(G.mode!=='race') return;
  const ov = $('#mapOverlay');
  const show = !ov.classList.contains('show');
  if(show && G.world){
    const cv = $('#bigMap');
    const panel = cv.parentElement;
    const pw = panel.clientWidth - 30;
    const h = Math.min(440, pw*0.72);
    cv.width = Math.round(pw*2); cv.height = Math.round(h*2);
    cv.style.height = h + 'px';
    $('#mapTitle').textContent = G.world.tdef.en + ' · TRACK MAP';
    drawMap(cv, true);
  }
  ov.classList.toggle('show', show);
}

function cycleCamera(){
  if(G.world){
    G.world.cameraMode = (G.world.cameraMode+1)%3;
    AudioSys.blip(700, 0.05);
  }
}

/* ---------- HUD 辅助 ---------- */
function showCountdown(txt, cls){
  const el = $('#countdown');
  el.textContent = txt;
  el.className = 'countdown' + (cls ? ' ' + cls : '');
  el.style.display = 'block';
}
function hideCountdown(){ $('#countdown').style.display = 'none'; }
let driftPopT = 0;
let mapTimer = 0;
function popDrift(v){
  const el = $('#driftPop');
  el.textContent = 'DRIFT +' + v;
  el.style.opacity = 1;
  driftPopT = 1.1;
}
function updateDriftPop(dt){
  if(driftPopT > 0){
    driftPopT -= dt;
    if(driftPopT <= 0) $('#driftPop').style.opacity = 0;
  }
}
