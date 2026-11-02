/* ============================================================
   霓虹狂飙 NEON RUSH — 游戏核心
   ============================================================ */
/* ---------- 常量 ---------- */
const CFG = {
  aiCount: 5,              // 对手数量（总 6 车）
  sampleN: 520,            // 赛道采样点数
  countdownTime: 3.0,      // 起跑倒计时（秒）
  dtMax: 0.05,
  gravity: 22,
  pixelCap: 1.5,
  driftScoreMul: 1.0,
};

/* ---------- 车辆数据 ---------- */
const CARS = [
  { id:'gt01', name:'GT-01 疾风', cls:'法拉利 · 平衡超跑', model:'ferrari', color:0xe8ecf4, neon:0x00e5ff,
    stats:{ top:265, accel:0.82, hand:0.78, grip:0.75 },
    spec:{ 极速:'265 km/h', 车重:'轻', 驱动:'后驱', 特点:'均衡可靠' } },
  { id:'v8', name:'V8 夜影', cls:'经典敞篷 · 直线猛兽', model:'toycar', color:0xff2e88, neon:0xff2e88,
    stats:{ top:292, accel:0.72, hand:0.60, grip:0.70 },
    spec:{ 极速:'292 km/h', 车重:'重', 驱动:'后驱', 特点:'极速见长' } },
  { id:'erush', name:'E-RUSH 闪电', cls:'法拉利 · 电动超跑', model:'ferrari', color:0x00ff9d, neon:0x00ff9d,
    stats:{ top:276, accel:0.95, hand:0.70, grip:0.66 },
    spec:{ 极速:'276 km/h', 车重:'中', 驱动:'四驱', 特点:'起步无敌' } },
  { id:'drift9', name:'DRIFT-9 漂移者', cls:'经典敞篷 · 甩尾专家', model:'toycar', color:0xffb300, neon:0xffb300,
    stats:{ top:238, accel:0.66, hand:0.95, grip:0.42 },
    spec:{ 极速:'238 km/h', 车重:'轻', 驱动:'后驱', 特点:'轻松甩尾' } },
  { id:'classic', name:'Milk 奶罐车', cls:'运输卡车 · 大力出奇迹', model:'milk', color:0xff6b35, neon:0xff6b35,
    stats:{ top:196, accel:0.58, hand:0.55, grip:0.88 },
    spec:{ 极速:'196 km/h', 车重:'超重', 驱动:'后驱', 特点:'稳如磐石' } },
  { id:'gtx', name:'GTX 猎风', cls:'GT 赛车 · 耐力涂装', model:'gtr', color:0xdfe6f0, neon:0xff3355,
    stats:{ top:268, accel:0.88, hand:0.74, grip:0.76 },
    spec:{ 极速:'268 km/h', 车重:'中', 驱动:'后驱', 特点:'均衡好开' } },
];

/* ---------- 赛道数据（控制点 x,z） ---------- */
const TRACKS = [
  { id:'coast', name:'海岸疾驰', en:'COAST DRIVE', desc:'沿临海公路的高速赛道，弯缓路宽，考验极速与走线。',
    laps:2, width:40, curbs:false, buildings:false,
    diff:1, len:'约 4.2 km',
    pts:[[0,-560],[300,-540],[560,-420],[740,-200],[740,120],[560,360],[260,520],[0,560],[-300,540],[-560,420],[-740,200],[-740,-120],[-560,-360]] },
  { id:'city', name:'霓虹都市', en:'NEON CITY', desc:'高楼环绕的市中心环线，弯道密集，适合贴身缠斗。',
    laps:2, width:32, curbs:true, buildings:true,
    diff:2, len:'约 3.3 km',
    pts:[[0,-430],[210,-430],[430,-360],[560,-180],[560,90],[470,280],[260,400],[0,430],[-260,400],[-470,280],[-560,90],[-560,-180],[-430,-360]] },
  { id:'industrial', name:'工业回廊', en:'INDUSTRIAL LOOP', desc:'厂房与吊臂之间的窄巷道，三个连续大弯反复撕扯节奏。',
    laps:2, width:27, curbs:true, buildings:true,
    diff:3, len:'约 4.0 km',
    pts:[[0,-692],[130,-611],[216,-486],[265,-365],[306,-275],[371,-214],[472,-153],[584,-61],[665,70],[674,219],[599,346],[464,418],[313,431],[183,412],[86,402],[0,428],[-103,485],[-239,537],[-393,541],[-527,474],[-599,346],[-594,193],[-529,56],[-448,-47],[-391,-127],[-371,-214],[-368,-332],[-345,-475],[-272,-611],[-147,-693]] },
  { id:'sunset', name:'落日海岸', en:'SUNSET SHORE', desc:'逆光海岸线的四连 S 弯，路面收窄，几乎没有并排超车的空间。',
    laps:2, width:26, curbs:true, buildings:false,
    diff:4, len:'约 4.2 km',
    pts:[[0,-695],[124,-624],[208,-503],[263,-394],[329,-329],[436,-291],[569,-236],[673,-134],[695,0],[624,124],[503,208],[394,263],[329,329],[291,436],[236,569],[134,673],[0,695],[-124,624],[-208,503],[-263,394],[-329,329],[-436,291],[-569,236],[-673,134],[-695,0],[-624,-124],[-503,-208],[-394,-263],[-329,-329],[-291,-436],[-236,-569],[-134,-673]] },
  { id:'summit', name:'霓虹之巅', en:'NEON SUMMIT', desc:'全游戏最窄的五连收弯，容错率极低，一次失误就连丢几个位置。',
    laps:2, width:24, curbs:true, buildings:true,
    diff:5, len:'约 4.3 km',
    pts:[[0,-695],[118,-649],[203,-542],[264,-442],[338,-387],[453,-361],[581,-312],[661,-215],[653,-88],[578,26],[502,114],[473,202],[483,319],[476,456],[409,562],[286,594],[154,558],[46,512],[-46,512],[-154,558],[-286,594],[-409,562],[-476,456],[-483,319],[-473,202],[-502,114],[-578,26],[-653,-88],[-661,-215],[-581,-312],[-453,-361],[-338,-387],[-264,-442],[-203,-542],[-118,-649]] },
];

/* ---------- AI 对手配色 ---------- */
const AI_COLORS = [0x7df9ff, 0xff9a5c, 0xb37bff, 0xff5c7a, 0x5cd6a0];

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const TAU = Math.PI*2;
function fmtTime(t){
  if(t==null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t/60), s = t - m*60;
  return m + ':' + String(s.toFixed(3)).padStart(6,'0');
}
function fmtSpeed(ms){ return Math.round(ms*3.6); }
function showToast(msg){
  const t = $('#toast');
  if(!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(()=> t.classList.remove('show'), 1800);
}
