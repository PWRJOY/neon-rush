/* ============================================================
   初始化
   ============================================================ */
function bindUI(){
  $('#carPrev').addEventListener('click', ()=>changeCar(-1));
  $('#carNext').addEventListener('click', ()=>changeCar(1));
  $('#trackPrev').addEventListener('click', ()=>changeTrack(-1));
  $('#trackNext').addEventListener('click', ()=>changeTrack(1));
  $('#startBtn').addEventListener('click', ()=>{ AudioSys.init(); startRace(); $('#startBtn').blur(); });
  $('#againBtn').addEventListener('click', ()=>{ AudioSys.init(); startRace(); $('#againBtn').blur(); });
  $('#menuBtn').addEventListener('click', toMenu);
  $('#resumeBtn').addEventListener('click', ()=>{ pauseRace(false); $('#resumeBtn').blur(); });
  $('#restartBtn').addEventListener('click', ()=>{ startRace(); $('#restartBtn').blur(); });
  $('#quitBtn').addEventListener('click', toMenu);
  $('#mapClose').addEventListener('click', ()=>$('#mapOverlay').classList.remove('show'));
  $('#muteBtn').addEventListener('click', toggleMute);
  $('#hudMute').addEventListener('click', toggleMute);
  ['keydown','pointerdown','mousedown','touchstart'].forEach(t=>window.addEventListener(t, ()=>{ G.inputSeen = true; }, { passive:true }));
  window.addEventListener('gamepadconnected', e=>{
    gpConnected = true;
    $('#gpStatus').textContent = '已连接手柄 · ' + (e.gamepad.id||'');
    $('#gpStatus').classList.add('on');
  });
  window.addEventListener('gamepaddisconnected', ()=>{
    gpConnected = false;
    $('#gpStatus').textContent = '未检测到手柄 · 点击画面后可用键盘操作';
    $('#gpStatus').classList.remove('on');
  });
  window.addEventListener('pointerdown', ()=>AudioSys.init(), { once:false });
  window.addEventListener('keydown', ()=>AudioSys.init(), { once:false });
  // 离开网页（切标签/切窗口/最小化）时停声，回来恢复
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) AudioSys.suspend(); else AudioSys.resume(); });
  window.addEventListener('blur', ()=>AudioSys.suspend());
  window.addEventListener('focus', ()=>{ if(!document.hidden) AudioSys.resume(); });
}

function init(){
  loadRecords();
  loadSelection();
  initRenderer();
  $('#carModeling').style.display = '';
  loadCarModel(()=>{ $('#carModeling').style.display = 'none'; setShowcaseCar(G.selectedCar); });
  buildShowcase();
  bindUI();
  renderCars();
  renderTracks();
  loadMutePref();
  updateHud();
  window.__gameReady = true;
  window.__game = {
    startRace:(t,c)=>{ G.selectedTrack = t==null?G.selectedTrack:t; G.selectedCar = c==null?G.selectedCar:c; startRace(); },
    skipCountdown:()=>{ if(G.mode==='race' && G.raceState==='countdown'){ G.raceState='racing'; G.goTime=G.time; G.world.player.lapStart=G.time; hideCountdown(); } },
    forceFinish:()=>{ if(G.mode==='race'){ const p=G.world.player; p.lap=G.world.laps; p.finished=true; p.finishTime=G.time-G.goTime; onPlayerFinish(); } },
    setSimInput:(obj)=>{ G.simInput = obj; },
    clearSimInput:()=>{ G.simInput = null; },
    toMenu, toggleMap, cycleCamera,
    state:()=>({
      mode:G.mode, raceState:G.raceState, paused:G.paused,
      speed: G.world ? Math.round(G.world.player.speed*3.6) : 0,
      cars: G.world ? G.world.cars.length : 0,
      pos: G.world ? G.world.player.posRank : 0,
      lap: G.world ? G.world.player.lap : 0,
    }),
    selectTrack:(i)=>{ G.selectedTrack = i; renderTracks(); },
    selectCar:(i)=>{ G.selectedCar = i; renderCars(); setShowcaseCar(i); },
    playerPos:()=> G.world ? { x:G.world.player.pos.x, z:G.world.player.pos.z, yaw:G.world.player.yaw, sinYaw:Math.sin(G.world.player.yaw), offDist:G.world.player.offDist } : null,
    allCars:()=> G.world ? G.world.cars.map(c=>({ id:c.id, player:c.isPlayer, speed:Math.round(c.speed*3.6), off:Math.round(c.offDist*10)/10, lap:c.lap, fin:c.finished, yaw:Math.round(c.yaw*10)/10 })) : null,
    scene:()=> G.scene,
    freezeCam:(mode)=>{ if(G.world){ const p=G.world.player; const fx=Math.sin(p.yaw), fz=Math.cos(p.yaw); const rx=Math.cos(p.yaw), rz=-Math.sin(p.yaw);
      if(mode===1){ G.camera.position.set(p.pos.x + rx*3.6, 1.5, p.pos.z + rz*3.6); G.camera.lookAt(p.pos.x - fx*2, 0.8, p.pos.z - fz*2); }
      else if(mode===2){ G.camera.position.set(p.pos.x - fx*6.5, 1.5, p.pos.z - fz*6.5); G.camera.lookAt(p.pos.x + fx*1, 0.7, p.pos.z + fz*1); }
      else if(mode===3){ G.camera.position.set(p.pos.x - fx*7.4 + rx*0.8, 3.2, p.pos.z - fz*7.4 + rz*0.8); G.camera.lookAt(p.pos.x + fx*5, 0.9, p.pos.z + fz*5); }
      else { G.camera.position.set(p.pos.x, 3.4, p.pos.z + 6.0); G.camera.lookAt(p.pos.x, 0.8, p.pos.z); }
      G.cameraFreeze = true; } },
  };
  loop();
}
init();
