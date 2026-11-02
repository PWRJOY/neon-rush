/* ============================================================
   菜单渲染
   ============================================================ */
function renderCars(){
  const c = CARS[G.selectedCar];
  $('#carName').textContent = c.name;
  $('#carClass').textContent = c.cls;
  const chip = $('#carChip');
  chip.style.background = '#' + c.color.toString(16).padStart(6,'0');
  chip.style.color = '#' + c.color.toString(16).padStart(6,'0');
  const labels = { top:'极速', accel:'加速', hand:'操控', grip:'抓地' };
  const statsBox = $('#carStats');
  statsBox.innerHTML = '';
  Object.keys(labels).forEach(k=>{
    const d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = '<div class="lab">' + labels[k] + '</div><div class="bar"><div class="fill" style="width:' + Math.round(c.stats[k]*100) + '%"></div></div>';
    statsBox.appendChild(d);
  });
  const spec = $('#carSpec');
  spec.innerHTML = '';
  Object.keys(c.spec).forEach(k=>{
    const s = document.createElement('span');
    s.innerHTML = k + ' <b>' + c.spec[k] + '</b>';
    spec.appendChild(s);
  });
}

function trackSvg(pts){
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  pts.forEach(p=>{ minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minZ=Math.min(minZ,p[1]); maxZ=Math.max(maxZ,p[1]); });
  const W=100,H=78,pad=9;
  const sx=W-pad*2, sy=H-pad*2;
  const n=(v,mn,mx,sz)=> pad + (v-mn)/(mx-mn)*sz;
  let d='';
  pts.forEach((p,i)=>{
    const x=n(p[0],minX,maxX,sx), y=n(p[1],minZ,maxZ,sy);
    d += (i?'L':'M') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  });
  d += 'Z';
  const sx0=n(pts[0][0],minX,maxX,sx).toFixed(1), sy0=n(pts[0][1],minZ,maxZ,sy).toFixed(1);
  return '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg"><path d="'+d+'" fill="rgba(0,229,255,0.07)"/><path d="'+d+'" fill="none" stroke="#00e5ff" stroke-width="2.4" opacity="0.95"/><circle cx="'+sx0+'" cy="'+sy0+'" r="3.2" fill="#ffb300"/></svg>';
}

function renderTracks(){
  const row = $('#trackRow');
  row.innerHTML = '';
  const maxDiff = Math.max(...TRACKS.map(t=>t.diff));
  const t = TRACKS[G.selectedTrack];
  const rec = getRecord(t.id);
  const recVal = rec && rec.bestLap != null ? fmtTime(rec.bestLap) : (rec && rec.total != null ? fmtTime(rec.total) : '暂无');
  const recSpan = '<span>最佳 <b>' + recVal + '</b></span>';
  const card = document.createElement('div');
  card.className = 'track-card sel';
  card.innerHTML =
    '<div class="track-prev">' + trackSvg(t.pts) + '</div>' +
    '<div class="track-info"><h3>' + t.name + ' · ' + t.en + '</h3>' +
    '<p>' + t.desc + '</p>' +
    '<div class="track-meta"><span>长度 <b>' + t.len + '</b></span><span>难度 <b>' + '●'.repeat(t.diff) + '○'.repeat(maxDiff - t.diff) + '</b></span><span>圈数 <b>' + t.laps + '</b></span>' + recSpan + '<span class="track-idx">' + (G.selectedTrack+1) + '/' + TRACKS.length + '</span></div></div>';
  row.appendChild(card);
}

function changeCar(d){
  G.selectedCar = (G.selectedCar + d + CARS.length) % CARS.length;
  renderCars();
  setShowcaseCar(G.selectedCar);
  saveSelection();
  AudioSys.blip(520, 0.06);
}
function changeTrack(d){
  G.selectedTrack = (G.selectedTrack + d + TRACKS.length) % TRACKS.length;
  renderTracks();
  saveSelection();
  AudioSys.blip(420, 0.06);
}

/* ---------- 战绩存档 / 选择记忆（localStorage） ---------- */
const REC_KEY = 'neonrush_records_v1';
const SEL_KEY = 'neonrush_sel_v1';
let RECORDS = {};
function loadRecords(){
  try{ RECORDS = JSON.parse(localStorage.getItem(REC_KEY) || '{}') || {}; }catch(e){ RECORDS = {}; }
}
function getRecord(id){ return RECORDS[id] || null; }
function saveRecord(id, bestLap, total){
  if(!id) return { newLap:false, newTotal:false };
  const r = Object.assign({}, RECORDS[id] || {});
  let newLap = false, newTotal = false;
  if(bestLap != null && (r.bestLap == null || bestLap < r.bestLap)){ r.bestLap = bestLap; newLap = true; }
  if(total != null && (r.total == null || total < r.total)){ r.total = total; newTotal = true; }
  if(newLap || newTotal){
    RECORDS[id] = r;
    try{ localStorage.setItem(REC_KEY, JSON.stringify(RECORDS)); }catch(e){}
  }
  return { newLap, newTotal };
}
function saveSelection(){
  try{ localStorage.setItem(SEL_KEY, JSON.stringify({ car:G.selectedCar, track:G.selectedTrack })); }catch(e){}
}
function loadSelection(){
  try{
    const s = JSON.parse(localStorage.getItem(SEL_KEY) || 'null');
    if(!s) return;
    if(typeof s.car === 'number') G.selectedCar = clamp(Math.round(s.car), 0, CARS.length-1);
    if(typeof s.track === 'number') G.selectedTrack = clamp(Math.round(s.track), 0, TRACKS.length-1);
  }catch(e){}
}

/* ---------- 声音开关 ---------- */
function loadMutePref(){
  let m = false;
  try{ m = localStorage.getItem('neonrush_muted') === '1'; }catch(e){}
  AudioSys.muted = m;
  syncMuteUI();
}
function toggleMute(){
  AudioSys.init();
  AudioSys.setMuted(!AudioSys.muted);
  syncMuteUI();
}
/* 沉浸模式：隐藏计时/名次/小地图，只留速度与氮气，画面更接近"开车的氛围" */
function toggleImmersive(){
  G.immersive = !G.immersive;
  $('#view-hud').classList.toggle('immersive', G.immersive);
  AudioSys.blip(600, 0.05);
  showToast(G.immersive ? '沉浸模式：开（按 H 恢复 HUD）' : '沉浸模式：关');
}
function syncMuteUI(){
  const off = AudioSys.muted;
  $('#muteBtn').classList.toggle('off', off);
  $('#muteBtn').setAttribute('aria-checked', String(!off));
  $('#hudMute').classList.toggle('off', off);
  $('#hudMute').setAttribute('aria-checked', String(!off));
}

/* ---------- 主状态更新 ---------- */
function update(dt){
  if(G.mode==='menu'){
    updateMenu(dt);
    handleEdges();
    if(menuNavCd>0) menuNavCd -= dt;
    // 手柄状态
    const gp = pollGamepad();
    if(gp && !gpConnected){
      gpConnected = true;
      $('#gpStatus').textContent = '已连接手柄 · ' + (gp.id||'');
      $('#gpStatus').classList.add('on');
    }
    return;
  }
  handleEdges();
  if(menuNavCd>0) menuNavCd -= dt;
  if(G.mode==='result') return;
  if(G.paused) return;
  if(!G.world) return;
  updateRace(dt);
}
