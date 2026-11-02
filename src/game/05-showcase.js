/* ============================================================
   菜单展示场景
   ============================================================ */
function buildShowcase(){
  const sc = G.scene;
  const root = new THREE.Group();
  const group = new THREE.Group();
  root.add(group);
  // 地面：磨砂展厅地板，避免镜面反射把霓虹环境光斑糊成一片
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 48),
    new THREE.MeshStandardMaterial({ color:0x070a12, metalness:.35, roughness:.55 })
  );
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.02;
  root.add(ground);
  // 展示台
  const plat = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 3.5, 0.55, 40),
    new THREE.MeshStandardMaterial({ color:0x141a29, metalness:.9, roughness:.24, emissive:0x0b1428, emissiveIntensity:.9 })
  );
  plat.position.y = 0.27;
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.045, 8, 72), new THREE.MeshBasicMaterial({ color:0x00e5ff, transparent:true, opacity:.8 }));
  ring1.rotation.x = Math.PI/2; ring1.position.y = 0.55;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.035, 8, 72), new THREE.MeshBasicMaterial({ color:0xff2e88, transparent:true, opacity:.62 }));
  ring2.rotation.x = Math.PI/2; ring2.position.y = 0.6;
  group.add(plat, ring1, ring2);
  group.scale.set(1.2, 1.2, 1.2);
  // 主射灯：柔和顶光，照亮车身但不把漆面打成一片死白
  const spot = new THREE.SpotLight(0xfff4e8, 1.0, 22, 0.5, 0.75, 1.1);
  spot.position.set(2.4, 9.5, 3.4);
  spot.target.position.set(0, 0.9, 0);
  root.add(spot, spot.target);
  // 双色轮廓光：从车后方两侧打边光，勾出车身剪影
  const poleLight1 = new THREE.PointLight(0x00e5ff, 1.2, 11);
  poleLight1.position.set(-2.8, 2.2, -2.6);
  const poleLight2 = new THREE.PointLight(0xff2e88, 1.0, 9);
  poleLight2.position.set(3.0, 1.6, -2.6);
  root.add(poleLight1, poleLight2);
  // 远处楼宇剪影（压暗两档，避免抢走展车视线）
  const bMat = new THREE.MeshStandardMaterial({ color:0x0a0e1c, roughness:.8, emissive:0x0a0e1c, emissiveMap:winTexture('city'), emissiveIntensity:.55 });
  const city = new THREE.Group();
  for(let i=0;i<46;i++){
    const a = i/46*TAU;
    const r = 30 + Math.random()*18;
    const h = 4 + Math.random()*22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.2+Math.random()*3, h, 2.2+Math.random()*3), bMat);
    b.position.set(Math.cos(a)*r, h/2-0.5, Math.sin(a)*r);
    b.rotation.y = Math.random()*TAU;
    city.add(b);
  }
  root.add(city);
  // 氛围霓虹支柱
  const pillarMat = new THREE.MeshBasicMaterial({ color:0x00e5ff, transparent:true, opacity:.28 });
  for(let i=0;i<8;i++){
    const a = i/8*TAU;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6, 0.16), pillarMat);
    p.position.set(Math.cos(a)*11, 3, Math.sin(a)*11);
    root.add(p);
  }
  sc.add(root);
  G.showcase = { root, group, city, angle:0, car:null };
  setShowcaseCar(0);
}

function setShowcaseCar(idx){
  const spec = CARS[idx];
  if(G.showcase.car){
    G.showcase.group.remove(G.showcase.car);
    disposeObject(G.showcase.car);
  }
  const car = buildCarMesh(spec.model||'ferrari', spec.color, spec.neon, false);
  car.position.y = 0.55;
  const mk = car.userData && car.userData.modelKey;
  car.rotation.y = ((CAR_MODELS[mk]||CAR_MODELS.ferrari).yawFix) + Math.PI/4; /* 车头朝向展示相机 */
  G.showcase.group.add(car);
  G.showcase.car = car;
}

function disposeObject(obj){
  obj.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){
      const ms = Array.isArray(o.material)? o.material : [o.material];
      ms.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

/* 画质档位：低帧率自动降档（关像素比、弱辉光、缩阴影贴图），帧率回升自动恢复 */
function applyQuality(low){
  const q = G.quality;
  if(q.low === low) return;
  q.low = low; q.good = 0;
  G.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio||1, CFG.pixelCap));
  G.bloomPass.strength = low ? 0.42 : 0.55;
  if(G.moon){
    const s = low ? 1024 : 2048;
    G.moon.shadow.mapSize.set(s, s);
    if(G.moon.shadow.map){ G.moon.shadow.map.dispose(); G.moon.shadow.map = null; }
  }
  onResize();
}

/* ---------- 主循环 ---------- */
const _clock = new THREE.Clock();
function loop(){
  requestAnimationFrame(loop);
  const dt = Math.min(_clock.getDelta(), CFG.dtMax);
  G.time += dt;
  update(dt);
  animateScenery(dt);
  // 天空跟随相机（只跟水平位置，海平面高度不变）
  if(G.skyGroup) G.skyGroup.position.set(G.camera.position.x, 0, G.camera.position.z);
  // 质量监控
  const q = G.quality;
  q.acc += dt; q.frames++;
  q.counter += dt;
  if(q.counter >= 2){
    const fps = q.frames / q.acc;
    if(!q.low && fps < 34) applyQuality(true);
    else if(q.low && fps > 54){ q.good++; if(q.good >= 2) applyQuality(false); }
    else q.good = 0;
    q.counter = 0; q.acc = 0; q.frames = 0;
  }
  G.composer.render();
  if(AudioSys.started && G.mode==='menu') AudioSys.engine(0.1, 0, false);
}

function updateMenu(dt){
  const sh = G.showcase;
  if(!sh) return;
  const spd = REDUCED_MOTION ? 0 : 0.25;
  sh.angle += dt*spd;
  if(sh.car){
    const shk = sh.car.userData && sh.car.userData.modelKey;
    sh.car.rotation.y = ((CAR_MODELS[shk]||CAR_MODELS.ferrari).yawFix) + Math.PI/4 + Math.sin(sh.angle*0.6)*0.15;
    // 车轮必须压在台面上（台面顶 0.545），之前基准 0.85 会让整车悬空半米
    sh.car.position.y = 0.552 + Math.sin(sh.angle*1.3)*0.015;
  }
  // 固定机位：展台留在画面右侧（左侧是选车/选赛道面板），只做轻微呼吸式晃动
  const swayX = REDUCED_MOTION ? 0 : Math.sin(G.time*0.32)*0.3;
  const swayY = REDUCED_MOTION ? 0 : Math.sin(G.time*0.5)*0.1;
  const camPos = new THREE.Vector3(7.4 + swayX, 3.1 + swayY, 8.8);
  G.camera.position.copy(camPos);
  const target = new THREE.Vector3(0, 1.15, 0.5);
  // 把看向点沿相机右方向左移，让展车落在画面偏右的位置
  const fwd = target.clone().sub(camPos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
  const half = Math.tan((G.camera.fov*Math.PI/180)/2) * camPos.distanceTo(target) * G.camera.aspect;
  target.addScaledVector(right, -Math.min(half*0.36, 3.0));
  G.camera.lookAt(target);
  // 菜单场景单独压低曝光与辉光：没有遮罩后按比赛档位渲染会整体过曝
  G.renderer.toneMappingExposure = 0.8;
  if(G.bloomPass) G.bloomPass.strength = 0.4;
}
