/* ============================================================
   音频引擎（Web Audio 合成，用户手势后启动）
   ============================================================ */
const AudioSys = {
  ctx:null, master:null, muted:false,
  engOsc1:null, engOsc2:null, engFilter:null, engGain:null,
  skidSrc:null, skidGain:null, skidFilter:null,
  skidSquealSrc:null, skidSquealGain:null, skidSquealFilter:null,
  nitroSrc:null, nitroGain:null, nitroFilter:null,
  started:false,

  init(){
    if(this.started) return;
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      // 引擎：双振荡器 + 低通
      this.engOsc1 = this.ctx.createOscillator();
      this.engOsc1.type = 'sawtooth';
      this.engOsc2 = this.ctx.createOscillator();
      this.engOsc2.type = 'square';
      this.engFilter = this.ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass';
      this.engFilter.frequency.value = 500;
      this.engGain = this.ctx.createGain();
      this.engGain.gain.value = 0;
      this.engOsc1.connect(this.engFilter);
      this.engOsc2.connect(this.engFilter);
      this.engFilter.connect(this.engGain);
      this.engGain.connect(this.master);
      this.engOsc1.frequency.value = 60;
      this.engOsc2.frequency.value = 30;
      this.engOsc1.start(); this.engOsc2.start();
      // 漂移胎噪
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate*2, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
      this.skidSrc = this.ctx.createBufferSource();
      this.skidSrc.buffer = buf; this.skidSrc.loop = true;
      this.skidFilter = this.ctx.createBiquadFilter();
      this.skidFilter.type = 'bandpass'; this.skidFilter.frequency.value = 900; this.skidFilter.Q.value = 1.4;
      this.skidGain = this.ctx.createGain(); this.skidGain.gain.value = 0;
      this.skidSrc.connect(this.skidFilter); this.skidFilter.connect(this.skidGain); this.skidGain.connect(this.master);
      this.skidSrc.start();
      // 漂移尖叫：窄带高频胎噪，滑移角越大越尖、越响（低频那层负责"沙沙"的摩擦感）
      this.skidSquealSrc = this.ctx.createBufferSource();
      this.skidSquealSrc.buffer = buf; this.skidSquealSrc.loop = true;
      this.skidSquealFilter = this.ctx.createBiquadFilter();
      this.skidSquealFilter.type = 'bandpass'; this.skidSquealFilter.frequency.value = 1800; this.skidSquealFilter.Q.value = 5;
      this.skidSquealGain = this.ctx.createGain(); this.skidSquealGain.gain.value = 0;
      this.skidSquealSrc.connect(this.skidSquealFilter); this.skidSquealFilter.connect(this.skidSquealGain); this.skidSquealGain.connect(this.master);
      this.skidSquealSrc.start();
      // 氮气
      this.nitroSrc = this.ctx.createBufferSource();
      this.nitroSrc.buffer = buf; this.nitroSrc.loop = true;
      this.nitroFilter = this.ctx.createBiquadFilter();
      this.nitroFilter.type = 'highpass'; this.nitroFilter.frequency.value = 700;
      this.nitroGain = this.ctx.createGain(); this.nitroGain.gain.value = 0;
      this.nitroSrc.connect(this.nitroFilter); this.nitroFilter.connect(this.nitroGain); this.nitroGain.connect(this.master);
      this.nitroSrc.start();
      this.started = true;
      if(this.ctx.state === 'suspended') this.ctx.resume();
    }catch(e){ /* 音频不可用时静默降级 */ }
  },

  resume(){ if(this.ctx && this.ctx.state==='suspended') this.ctx.resume(); },

  /* 离开页面（切标签/切窗口/最小化）时整体挂起音频上下文，回来再恢复 */
  suspend(){ if(!this.ctx) return; try{ if(this.ctx.state==='running') this.ctx.suspend(); }catch(e){} },

  setMuted(m){
    this.muted = m;
    try{ localStorage.setItem('neonrush_muted', m?'1':'0'); }catch(e){}
    if(this.master) this.master.gain.linearRampToValueAtTime(m?0:0.5, this.ctx.currentTime+0.05);
  },

  engine(rpm, throttle, inRace){
    if(!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    const f = 52 + rpm*150 + throttle*26;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.03);
    this.engOsc2.frequency.setTargetAtTime(f*0.5, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(320 + rpm*1500, t, 0.05);
    const g = inRace ? (0.05 + rpm*0.10 + throttle*0.06) : 0.02;
    this.engGain.gain.setTargetAtTime(g, t, 0.08);
  },

  skid(amount){
    if(!this.ctx || !this.started) return;
    const a = clamp(amount,0,1);
    const t = this.ctx.currentTime;
    this.skidGain.gain.setTargetAtTime(a*0.26, t, 0.05);
    this.skidSquealGain.gain.setTargetAtTime(a*0.22, t, 0.05);
    this.skidSquealFilter.frequency.setTargetAtTime(1250 + a*1250, t, 0.08);
  },

  nitro(on){
    if(!this.ctx || !this.started) return;
    this.nitroGain.gain.setTargetAtTime(on?0.10:0, this.ctx.currentTime, 0.05);
  },

  blip(freq=660, dur=0.08, type='sine', vol=0.2){
    if(!this.ctx || !this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+dur+0.02);
  },

  crash(intensity){
    if(!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate*0.4, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/d.length, 2);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = 0.5*clamp(intensity,0,1);
    const f = this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = 300;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },
};
