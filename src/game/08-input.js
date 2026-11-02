/* ============================================================
   输入（键盘 + 手柄）
   ============================================================ */
const KB = { throttle:false, brake:false, left:false, right:false, handbrake:false, nitro:false };
const edges = {};
const input = { throttle:0, brake:0, steer:0, handbrake:false, nitro:false };
let menuNavCd = 0, posTimer = 0;

const EDGE_CODES = ['KeyC','KeyM','Escape','KeyP','KeyR','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS'];
function keyEdge(code){ return !!edges[code]; }
function clearEdges(){ for(const k in edges) delete edges[k]; }

window.addEventListener('keydown', e=>{
  const code = e.code;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(code)) e.preventDefault();
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if((code==='Enter'||code==='Space') && tag==='BUTTON' && !(G.mode==='race' && !G.paused)){ return; }
  if(code==='KeyW'||code==='ArrowUp') KB.throttle = true;
  else if(code==='KeyS'||code==='ArrowDown') KB.brake = true;
  else if(code==='KeyA'||code==='ArrowLeft') KB.left = true;
  else if(code==='KeyD'||code==='ArrowRight') KB.right = true;
  else if(code==='ShiftLeft'||code==='ShiftRight') KB.handbrake = true;
  else if(code==='Space') KB.nitro = true;
  else if(code==='KeyT'){
    G.steerFlip = !G.steerFlip;
    const t = $('#flipToast');
    t.textContent = '转向方向：' + (G.steerFlip?'反向（A右 D左）':'标准（A左 D右）');
    t.style.display = 'block';
    clearTimeout(G.flipTimer);
    G.flipTimer = setTimeout(()=>{ t.style.display = 'none'; }, 2200);
  }
  else if(code==='KeyH'){
    if(!e.repeat) toggleImmersive();
  }
  if(EDGE_CODES.includes(code)) edges[code] = true;
});
window.addEventListener('keyup', e=>{
  const code = e.code;
  delete edges[code]; // 松开即清除按下沿标记，防止菜单页残留触发自动切换
  if(code==='KeyW'||code==='ArrowUp') KB.throttle = false;
  else if(code==='KeyS'||code==='ArrowDown') KB.brake = false;
  else if(code==='KeyA'||code==='ArrowLeft') KB.left = false;
  else if(code==='KeyD'||code==='ArrowRight') KB.right = false;
  else if(code==='ShiftLeft'||code==='ShiftRight') KB.handbrake = false;
  else if(code==='Space') KB.nitro = false;
});

function pollGamepad(){
  if(!navigator.getGamepads) return null;
  try{
    const gps = navigator.getGamepads();
    for(const gp of gps){ if(gp && gp.connected) return gp; }
  }catch(e){}
  return null;
}

function readInput(){
  if(G.simInput) return G.simInput;
  input.throttle = KB.throttle?1:0;
  input.brake = KB.brake?1:0;
  input.steer = ((KB.left?1:0) + (KB.right?-1:0)) * (G.steerFlip?-1:1);
  input.handbrake = KB.handbrake;
  input.nitro = KB.nitro;
  const gp = pollGamepad();
  if(gp){
    const a0 = (gp.axes[0]||0) * (G.steerFlip?-1:1) * -1;
    if(Math.abs(a0) > 0.14) input.steer = clamp(input.steer + a0, -1, 1);
    if(gp.buttons[7]) input.throttle = clamp(input.throttle + gp.buttons[7].value, 0, 1);
    if(gp.buttons[6]) input.brake = clamp(input.brake + gp.buttons[6].value, 0, 1);
    if(gp.buttons[0] && gp.buttons[0].pressed) input.handbrake = true;
    if(gp.buttons[4] && gp.buttons[4].pressed) input.nitro = true;
  }
  return input;
}

function handleEdges(){
  const gp = pollGamepad();
  const b = (i)=> !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
  if(G.mode==='menu'){
    if(menuNavCd<=0){
      let nav = false;
      if(keyEdge('ArrowLeft')||keyEdge('KeyA')){ changeCar(-1); nav=true; }
      else if(keyEdge('ArrowRight')||keyEdge('KeyD')){ changeCar(1); nav=true; }
      else if(b(14)){ changeCar(-1); nav=true; }
      else if(b(15)){ changeCar(1); nav=true; }
      if(!nav && (keyEdge('ArrowUp')||keyEdge('KeyW'))){ changeTrack(-1); nav=true; }
      else if(!nav && (keyEdge('ArrowDown')||keyEdge('KeyS'))){ changeTrack(1); nav=true; }
      else if(!nav && (b(12))){ changeTrack(-1); nav=true; }
      else if(!nav && (b(13))){ changeTrack(1); nav=true; }
      if(nav) menuNavCd = 0.4;
    }
    if(keyEdge('Enter') || b(0)){ AudioSys.init(); startRace(); }
    return;
  }
  if(G.mode==='race'){
    if(keyEdge('KeyC') || b(1)) cycleCamera();
    if(keyEdge('KeyM')) toggleMap();
    if(keyEdge('Escape')||keyEdge('KeyP')||b(9)) pauseRace(!G.paused);
    if(keyEdge('KeyR')) startRace();
  }
}
