/* ============================================================
 * fp-core.js —— 户型数据层核心（无 DOM 依赖，浏览器 / Node 双端）
 *
 * 职责：格式检测 → Adapter（A/B/C）→ FPModel(fp.model/1) → Validator
 *       铁律：任何校验/转换都不得修改用户输入的建筑几何（坐标逐字保留），
 *       只允许：缺失字段补默认值（记录 provenance）、派生字段（bounds/envelope/labelAt）。
 *
 * 导出（UMD）：FPCore.DEFAULTS / registry / detectFormat / importFromText /
 *       exportStandard / builtinModel / canDemolish / demolishBlockReason /
 *       roomLabelAt / blankModel
 * 结构说明见 docs/PROJECT_HANDOVER.md §3。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const MODEL_VERSION = 'fp.model/1';
  const STD_VERSION = 'floorplan.standard/1';

  /* ======================= 预览默认值 ======================= */
  const DEFAULTS = {
    ceilingHeight: 2800,          // 层高 mm
    window: { sill: 900, top: 2400 },   // 窗台 / 窗顶（窗高 = top - sill = 1500）
    door:   { height: 2050, lintel: 2100 }, // 门扇高 / 门洞过梁
    slide:  { height: 2100, tallHeight: 2400 }, // 推拉门常规 / 高门（阳台）
    room:   { counted: true, floorElevation: 0 },
  };
  const WINDOW_HEIGHT = DEFAULTS.window.top - DEFAULTS.window.sill;

  /* ======================= 内置默认户型（原 index.html 数据块迁移） =======================
   * 墙体: [x0,y0,x1,y1,类型]  b=承重(黑) e=外墙 n=可拆非承重 low=矮墙
   * 坐标：mm，原点 = 左侧外墙内皮 / 顶部外墙内皮，y 向下。
   * ============================================================ */
  const BUILTIN = {};
  BUILTIN.name = '三室两厅两卫';
  BUILTIN.declaredBounds = { x: -1850, y: -1750, w: 15600, h: 14100 };
  BUILTIN.walls = [
    // 顶部外墙
    [1580,-240,2120,0,'b'],[1580,0,1820,300,'b'],[2120,-240,4580,0,'e'],[4580,-240,5140,0,'e'],
    [5760,-240,6050,0,'e'],[6050,-240,6600,0,'b'],[6360,0,6600,300,'b'],[6600,-240,9960,0,'e'],
    [9960,-240,10510,0,'b'],[10270,0,10510,300,'b'],
    // 右侧外墙
    [10270,300,10510,800,'e'],[10270,2600,10510,3090,'e'],[10270,3090,10510,4260,'b'],
    [10270,5740,10510,6370,'b'],[9960,6370,10510,6610,'b'],[10270,6610,10510,7400,'b'],
    [10270,9770,10510,10560,'b'],[9960,10560,10510,10800,'b'],
    // 底部 / 阳台
    [4580,10560,9960,10800,'e'],[10510,10560,12090,10800,'e'],[11850,9960,12090,10560,'e'],
    // 客厅左墙（入户门两侧）
    [4580,9200,4820,10560,'e'],[4580,7960,4820,8310,'e'],
    // 餐厅 / 厨房外墙
    [3620,7960,4580,8200,'e'],[2180,7960,3620,8200,'b'],[2180,7590,2420,7960,'b'],[2180,7400,2420,7590,'n'],
    [-240,7960,2180,8200,'e'],[-240,3610,0,7960,'e'],
    // 洗衣阳台
    [0,4950,200,5190,'n'],[200,4950,1275,5190,'low'],[1580,3370,2420,3825,'b'],
    [2180,4430,2420,5796,'n'],[2090,4950,2180,5190,'n'],
    // 客卫
    [2420,4950,4580,5190,'n'],[4580,3280,4820,4075,'n'],[4580,4860,4820,5190,'n'],[2420,3370,4580,3610,'n'],
    // 小孩房 / 主卫
    [4580,0,4820,2400,'n'],[4820,2080,6360,2320,'n'],[6360,300,6600,1198,'n'],[6360,1983,6600,2400,'n'],
    // 过道 / 主卧 / 子女房
    [6083,3370,6600,3707,'b'],[6360,3280,6600,3370,'n'],[6600,3370,9960,3610,'n'],[9960,3370,10270,3610,'b'],
    [6083,4600,6323,6610,'n'],[6323,6370,9960,6610,'n'],
  ];
  BUILTIN.wins = [
    [5140,-240,5760,0],[1580,300,1820,3370],[-240,3370,1580,3610],[2180,3825,2420,4430],
    [10510,6370,12090,6610],[11850,6610,12090,9960],
    // 飘窗（主卧 / 子女房）：三矩形一组
    [10510,660,11130,760],[11030,760,11130,2650],[10510,2650,11130,2750],
    [10510,4110,11130,4210],[11030,4210,11130,5785],[10510,5785,11130,5885],
  ];
  BUILTIN.doors = [
    {name:'小孩房门',rect:[4580,2400,4820,3280],h:[4580,3280],c:[0,-1],o:[-1,0],len:880},
    {name:'主卧门',rect:[6360,2400,6600,3280],h:[6600,3280],c:[0,-1],o:[1,0],len:880},
    {name:'主卫门',rect:[6360,1198,6600,1983],h:[6360,1198],c:[0,1],o:[-1,0],len:785},
    {name:'客卫门',rect:[4580,4075,4820,4860],h:[4580,4860],c:[0,-1],o:[-1,0],len:785},
    {name:'子女房门',rect:[6083,3707,6323,4600],h:[6323,4600],c:[0,-1],o:[1,0],len:893},
    {name:'入户门',rect:[4580,8310,4820,9200],h:[4820,9200],c:[0,-1],o:[1,0],len:890,entry:true},
  ];
  BUILTIN.slides = [
    {rect:[10270,7400,10510,9770],v:true},
    {rect:[1275,4950,2090,5190],v:false},
  ];
  const R = (x0,y0,x1,y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  BUILTIN.rooms = [
    {id:'master', name:'主卧室', poly:R(6600,0,10270,3370), mat:'wood', at:[8435,2420]},
    {id:'mbath', name:'主卫浴', poly:R(4820,0,6360,2080), mat:'antislip', at:[5980,1780]},
    {id:'kid', name:'小孩房', poly:R(1820,0,4580,3370), mat:'wood', at:[3380,2330]},
    {id:'gbath', name:'客卫浴', poly:R(2420,3610,4580,4950), mat:'antislip', at:[3760,4620]},
    {id:'laundry', name:'洗衣阳台', poly:R(0,3610,2180,4950), mat:'antislip', at:[1250,4330]},
    {id:'child', name:'子女房', poly:R(6323,3610,10270,6370), mat:'wood', at:[8850,4850]},
    {id:'kitchen', name:'厨房', poly:R(0,5190,2180,7960), mat:'tile600', at:[1300,6500]},
    {id:'dining', name:'餐厅', poly:[[2420,5190],[4820,5190],[4820,7960],[2420,7960],[2420,7400],[2180,7400],[2180,5796],[2420,5796]], mat:'tile800', at:[3900,5520]},
    {id:'hall', name:'过道', poly:[[4820,2320],[6360,2320],[6360,3370],[6083,3370],[6083,6610],[4820,6610]], mat:'tile800', at:[5450,4450]},
    {id:'living', name:'客厅', poly:R(4820,6610,10270,10560), mat:'tile800', at:[7600,7560]},
    {id:'balcony', name:'休闲阳台', poly:R(10510,6610,11850,10560), mat:'walnut', at:[11180,9450]},
    {id:'bay1', name:'主卧飘窗', poly:[[10270,800],[10510,800],[10510,760],[11030,760],[11030,2650],[10510,2650],[10510,2600],[10270,2600]], mat:'marble', counted:false},
    {id:'bay2', name:'子女房飘窗', poly:[[10270,4260],[10510,4260],[10510,4210],[11030,4210],[11030,5785],[10510,5785],[10510,5740],[10270,5740]], mat:'marble', counted:false},
  ];
  BUILTIN.mats = {
    wood:    {name:'橡木地板', price:320, sw:'#d8b88a'},
    walnut:  {name:'胡桃木地板', price:380, sw:'#9b7250'},
    tile800: {name:'800 地砖', price:220, sw:'#ebe6dc'},
    tile600: {name:'600 地砖', price:160, sw:'#dfe3e1'},
    marble:  {name:'大理石', price:650, sw:'#f1eee8'},
    antislip:{name:'300 防滑砖', price:140, sw:'#d3d8d4'},
    terrazzo:{name:'水磨石', price:280, sw:'#e6dfd3'},
    carpet:  {name:'满铺地毯', price:200, sw:'#c9c3d3'},
  };
  // 内置户型原始尺寸链（渲染层直接使用；导入户型 dims=null → 自动生成外包两条）
  BUILTIN.dims = {chains:[
    {horiz:true,  at:-750,  start:0, segs:[1580,240,2760,240,1540,240,3670]},
    {horiz:true,  at:-1250, start:0, segs:[10270]},
    {horiz:true,  at:11350, start:0, segs:[2180,240,2160,240,5450,240,1340]},
    {horiz:true,  at:11850, start:0, segs:[11850]},
    {horiz:false, at:-800,  start:0, segs:[3370,1580,240,2770,240,2360]},
    {horiz:false, at:-1300, start:0, segs:[10560]},
    {horiz:false, at:12750, start:0, segs:[3370,240,2760,240,3950]},
    {horiz:false, at:13250, start:0, segs:[10560]},
  ]};

  /* ======================= 小工具 ======================= */
  const isNum = v => typeof v === 'number' && isFinite(v);
  const isRect = r => Array.isArray(r) && r.length === 4 && r.every(isNum);
  const rectOK = r => isRect(r) && r[2] > r[0] && r[3] > r[1];       // 正向、非零面积
  const normRect = r => [Math.min(r[0],r[2]), Math.min(r[1],r[3]), Math.max(r[0],r[2]), Math.max(r[1],r[3])];
  const overlap = (a, b) => Math.max(0, Math.min(a[2],b[2]) - Math.max(a[0],b[0])) * Math.max(0, Math.min(a[3],b[3]) - Math.max(a[1],b[1]));
  const grow = (r, m) => [r[0]-m, r[1]-m, r[2]+m, r[3]+m];
  const polyArea = poly => Math.abs(poly.reduce((a,p,i) => { const q = poly[(i+1)%poly.length]; return a + p[0]*q[1] - q[0]*p[1]; }, 0)) / 2;
  const ptInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
      const [xi,yi] = poly[i], [xj,yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi) + xi) inside = !inside;
    }
    return inside;
  };
  const segIntersect = (a, b, c, d) => {
    const d1 = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    const d2 = (b[0]-a[0])*(d[1]-a[1]) - (b[1]-a[1])*(d[0]-a[0]);
    const d3 = (d[0]-c[0])*(a[1]-c[1]) - (d[1]-c[1])*(a[0]-c[0]);
    const d4 = (d[0]-c[0])*(b[1]-c[1]) - (d[1]-c[1])*(b[0]-c[0]);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const polySelfIntersects = poly => {
    const n = poly.length;
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++){
      if (j === i || (j+1)%n === i || (i+1)%n === j) continue;   // 相邻边共享端点，跳过
      if (segIntersect(poly[i], poly[(i+1)%n], poly[j], poly[(j+1)%n])) return true;
    }
    return false;
  };
  const dist = (x, y, p) => Math.hypot(x-p[0], y-p[1]);
  const distToSeg = (x, y, a, b) => {
    const l2 = (b[0]-a[0])**2 + (b[1]-a[1])**2;
    if (!l2) return dist(x, y, a);
    let t = ((x-a[0])*(b[0]-a[0]) + (y-a[1])*(b[1]-a[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist(x, y, [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]);
  };
  const distToPolyEdge = (x, y, poly) => Math.min(...poly.map((p,i) => distToSeg(x, y, p, poly[(i+1)%poly.length])));

  /* ======================= FPModel 骨架 ======================= */
  function blankModel(){
    return {
      version: MODEL_VERSION,
      meta: {name:'', units:'mm', coordinateSystem:'top-left-inner-y-down',
             ceilingHeight: DEFAULTS.ceilingHeight, isDefault:false,
             source:{format:null, file:null}, declaredBounds:null},
      bounds: null,
      walls: [], windows: [], doors: [], slides: [], rooms: [],
      materials: Object.assign({}, BUILTIN.mats),
      furniture: [], dims: null, defaults: [],
    };
  }

  /* ---------- 派生字段 ---------- */
  function computeBounds(m){
    let b = null;
    const eat = r => { if (!isRect(r)) return; b = b || [r[0],r[1],r[2],r[3]];
      b[0]=Math.min(b[0],r[0]); b[1]=Math.min(b[1],r[1]); b[2]=Math.max(b[2],r[2]); b[3]=Math.max(b[3],r[3]); };
    m.walls.forEach(w => eat(w.rect)); m.windows.forEach(w => eat(w.rect));
    m.doors.forEach(d => eat(d.rect)); m.slides.forEach(s => eat(s.rect));
    m.rooms.forEach(r => r.polygon.forEach(p => eat([p[0],p[1],p[0],p[1]])));
    m.bounds = b && {x:b[0], y:b[1], w:b[2]-b[0], h:b[3]-b[1]};
    return m.bounds;
  }
  // 外围墙派生：贴几何包围盒 ±25mm 的墙标记 envelope（保护，不可拆除）
  function markEnvelope(m){
    const b = m.bounds, T = 25;
    if (!b) return;
    const X0=b.x, Y0=b.y, X1=b.x+b.w, Y1=b.y+b.h;
    m.walls.forEach(w => {
      w.envelope = Math.min(Math.abs(w.rect[0]-X0), Math.abs(w.rect[2]-X1),
                            Math.abs(w.rect[1]-Y0), Math.abs(w.rect[3]-Y1)) <= T;
    });
  }
  // 开口所属墙：取重叠面积最大的墙（无重叠 → 相邻 30mm 内的墙，再无 → null）
  function embedWallId(m, rect){
    let best = null, bestA = 0;
    m.walls.forEach(w => { const a = overlap(rect, w.rect); if (a > bestA){ bestA = a; best = w; } });
    if (best) return best.id;
    let near = null, nearD = Infinity;
    m.walls.forEach(w => { const g = grow(w.rect, 30), a = overlap(rect, g);
      if (a > 0){ const d = Math.min(Math.abs(rect[0]-w.rect[2]), Math.abs(w.rect[0]-rect[2]), Math.abs(rect[1]-w.rect[3]), Math.abs(w.rect[1]-rect[3]));
        if (d < nearD){ nearD = d; near = w; } } });
    return near ? near.id : null;
  }
  // 飘窗组识别（原生格式无 kind 声明）：三矩形一组 —— 两端盖垂直于中间条带且端点贴合（±30mm）
  function detectBayGroups(windows){
    const T = 30;
    const touch = (a, b) => overlap(grow(a, T), b) > 0;
    const longAxis = r => (r[2]-r[0]) >= (r[3]-r[1]) ? 'x' : 'y';
    let gid = 0;
    for (let i = 0; i < windows.length; i++) for (let j = i+1; j < windows.length; j++) for (let k = j+1; k < windows.length; k++){
      const a = windows[i].rect, b = windows[j].rect, c = windows[k].rect;
      const axisCount = {x:0, y:0};
      [a, b, c].forEach(r => axisCount[longAxis(r)]++);
      if (axisCount.x !== 2 && axisCount.y !== 2) continue;          // 两端盖 + 一条带
      const mid = axisCount.x === 1 ? [a,b,c].find(r => longAxis(r)==='x') : [a,b,c].find(r => longAxis(r)==='y');
      const caps = [a,b,c].filter(r => r !== mid);
      if (caps[0] === caps[1]) continue;
      if (!touch(caps[0], mid) || !touch(caps[1], mid)) continue;
      // 端盖须位于条带两端（沿条带长轴）
      const hz = longAxis(mid) === 'x';
      const lo = hz ? Math.min(mid[0], mid[2]) : Math.min(mid[1], mid[3]);
      const hi = hz ? mid[2] : mid[3];
      const capMid = r => hz ? (r[0]+r[2])/2 : (r[1]+r[3])/2;
      const cms = caps.map(capMid).sort((p,q) => p-q);
      if (!(cms[0] <= lo + T && cms[1] >= hi - T)) continue;
      if (windows[i].kind || windows[j].kind || windows[k].kind) continue;
      const g = 'bay' + (++gid);
      [i,j,k].forEach(idx => { windows[idx].kind = 'bay'; windows[idx].group = g; });
    }
  }

  /* ---------- 标签点推导 ---------- */
  function roomLabelAt(poly){
    // 质心优先：落在多边形内直接用；否则在包围盒内 9×9 采样取离边最远的内点
    const c = poly.reduce((a,p) => [a[0]+p[0], a[1]+p[1]], [0,0]).map(v => v/poly.length);
    if (ptInPoly(c[0], c[1], poly)) return [Math.round(c[0]), Math.round(c[1])];
    const xs = poly.map(p=>p[0]), ys = poly.map(p=>p[1]);
    const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
    let best = null, bestD = -1;
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++){
      const x = x0 + (x1-x0)*i/10, y = y0 + (y1-y0)*j/10;
      if (!ptInPoly(x, y, poly)) continue;
      const d = distToPolyEdge(x, y, poly);
      if (d > bestD){ bestD = d; best = [Math.round(x), Math.round(y)]; }
    }
    return best;
  }

  // 可选窗框分格：按玻璃净宽的相对比例布局，所有框料均落在原窗洞内（单位 mm）。
  // 未声明 frame 的旧模型继续使用原来的自动等分渲染。
  function windowFrameLayout(w){
    if (!w.frame || !rectOK(w.rect)) return null;
    const f = w.frame, r = w.rect, length = Math.max(r[2]-r[0], r[3]-r[1]);
    const ratios = f.panelRatios || Array(Math.max(1, Math.round(length / 900))).fill(1);
    const width = f.width === undefined ? 40 : f.width;
    const depth = f.depth === undefined ? 60 : f.depth;
    const total = ratios.reduce((a, v) => a + v, 0), clear = length - (ratios.length + 1) * width;
    if (clear <= 0 || !isNum(total) || total <= 0) return null;
    const panels = [], bars = [{start:0, end:width}];
    let cursor = width;
    ratios.forEach((ratio, i) => {
      const end = i === ratios.length-1 ? length-width : cursor + clear * ratio / total;
      panels.push({start:cursor, end});
      bars.push({start:end, end:end+width});
      cursor = end + width;
    });
    return {length, width, depth, color:f.color || '#5d6166', panels, bars};
  }

  // 门洞两侧采用同款瓷砖且等高时，延续房间地面；入户、湿区及不同材质仍用门槛。
  function openingFloor(model, opening, roomState = {}){
    const stone = {continuous:false};
    if (opening.entry) return stone;
    const [x0,y0,x1,y1] = opening.rect, horizontal = x1-x0 >= y1-y0;
    const cx = (x0+x1)/2, cy = (y0+y1)/2;
    const probes = horizontal ? [[cx,y0-2],[cx,y1+2]] : [[x0-2,cy],[x1+2,cy]];
    const rooms = probes.map(p => model.rooms.find(r => ptInPoly(p[0],p[1],r.polygon)));
    if (rooms.some(r => !r || r.counted === false) || rooms[0].id === rooms[1].id) return stone;
    const wet = r => r.matId === 'antislip' || roomState[r.id]?.mat === 'antislip' ||
      /卫生|卫浴|浴室|洗衣|bath|toilet|laundry/i.test(r.name+' '+(roomState[r.id]?.name || ''));
    if (rooms.some(wet) || (rooms[0].floorElevation || 0) !== (rooms[1].floorElevation || 0)) return stone;
    const mats = rooms.map(r => roomState[r.id]?.mat || r.matId);
    const tile = /^(tile\d*|marble|terrazzo)$/.test(mats[0]) || /瓷砖|地砖|tile/i.test(model.materials[mats[0]]?.name || '');
    return mats[0] === mats[1] && tile ? {continuous:true, matId:mats[0], roomIds:rooms.map(r=>r.id)} : stone;
  }

  /* ======================= Validator ======================= */
  /* 错误 = 拒绝导入（model=null）；警告 = 放行；默认值 = 记录 provenance。
   * 铁律：报告一律引用原始坐标，不修改几何。 */
  function validateGeometry(m){
    const errors = [], warnings = [];
    if (!m.walls.length) errors.push({code:'no_walls', message:'缺少墙体数据（walls 为空）'});
    // 墙体
    const seen = new Set();
    m.walls.forEach((w, i) => {
      if (!isRect(w.rect)) errors.push({code:'bad_wall', path:`walls[${i}].rect`, message:`墙体坐标非法（须为 4 个数值）`});
      else if (!(w.rect[2] > w.rect[0] && w.rect[3] > w.rect[1])) errors.push({code:'bad_wall', path:`walls[${i}].rect`, message:`墙体矩形负向或零面积：[${w.rect.join(', ')}]`});
      if (seen.has(w.id)) errors.push({code:'dup_id', path:`walls[${i}].id`, message:`墙体 id 重复：${w.id}`});
      seen.add(w.id);
    });
    // 完全重复墙体（警告，不去重）
    for (let i = 0; i < m.walls.length; i++) for (let j = i+1; j < m.walls.length; j++){
      const a = m.walls[i].rect, b = m.walls[j].rect;
      if (a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3])
        warnings.push({code:'dup_wall', message:`完全重复的墙体（保留不去重）：${m.walls[i].id} 与 ${m.walls[j].id} [${a.join(', ')}]`});
    }
    // 单位
    if (m.meta.units !== 'mm') errors.push({code:'bad_units', message:`未知单位：${m.meta.units}（当前仅支持 mm）`});
    // 房间
    const rSeen = new Set();
    m.rooms.forEach((r, i) => {
      const P = `rooms[${i}](${r.id})`;
      if (rSeen.has(r.id)) errors.push({code:'dup_id', path:`${r.id}`, message:`房间 id 重复：${r.id}`});
      rSeen.add(r.id);
      if (!Array.isArray(r.polygon) || r.polygon.length < 3) errors.push({code:'bad_poly', path:P, message:'房间多边形至少需要 3 个点'});
      else {
        if (r.polygon.some(p => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])))
          errors.push({code:'bad_poly', path:P, message:'房间多边形含非数值坐标'});
        else {
          if (polyArea(r.polygon) < 1e-6) errors.push({code:'bad_poly', path:P, message:'房间多边形面积为零'});
          if (polySelfIntersects(r.polygon)) errors.push({code:'bad_poly', path:P, message:'房间多边形自相交'});
        }
      }
      if (r.matId && !m.materials[r.matId])
        warnings.push({code:'unknown_mat', path:P, message:`未知材质「${r.matId}」`});
    });
    // 门窗：悬浮 / 嵌入超差 / 铰点 / 门宽
    const checkOpening = (o, kind, i) => {
      if (!isRect(o.rect)){ errors.push({code:'bad_opening', path:`${kind}[${i}].rect`, message:'开口矩形坐标非法'}); return; }
      const hit = embedWallId(m, o.rect);
      if (hit === null){ warnings.push({code:'floating', path:o.id, message:`${kind === 'windows' ? '窗' : '门'}「${o.name || o.id}」未嵌入任何墙体（悬浮）`}); return; }
      const w = m.walls.find(x => x.id === hit);
      if (!w || overlap(o.rect, w.rect) <= 0) return;               // 贴边补洞式开口不算超差
      // 与嵌入墙的重叠超出量（按原始坐标报 mm）：取横向/纵向超出中的较大者
      const ox = Math.max(w.rect[0]-o.rect[0], o.rect[2]-w.rect[2]);
      const oy = Math.max(w.rect[1]-o.rect[1], o.rect[3]-w.rect[3]);
      const over = Math.max(0, ox, oy);
      if (over > 2) warnings.push({code:'opening_over', path:o.id,
        message:`${kind === 'windows' ? '窗' : '门'}「${o.name || o.id}」超出嵌入墙 ${w.id} 约 ${Math.round(over)} mm（保留原始几何，仅提示）`});
    };
    m.windows.forEach((w, i) => {
      checkOpening(w, 'windows', i);
      if (!w.frame) return;
      const f = w.frame, P = `windows[${i}].frame`, ratios = f.panelRatios;
      const validRatios = ratios === undefined || (Array.isArray(ratios) && ratios.length >= 1 && ratios.length <= 32
        && ratios.every(v => isNum(v) && v > 0) && isNum(ratios.reduce((a,v) => a+v, 0)));
      const width = f.width === undefined ? 40 : f.width;
      if (!validRatios) errors.push({code:'bad_window_frame', path:P+'.panelRatios', message:'窗玻璃比例须为 1~32 个正数'});
      if (!isNum(width) || width <= 0 || (isNum(w.height) && width*2 >= w.height))
        errors.push({code:'bad_window_frame', path:P+'.width', message:'窗框宽度须为正数且小于窗高的一半'});
      if (f.depth !== undefined && (!isNum(f.depth) || f.depth <= 0))
        errors.push({code:'bad_window_frame', path:P+'.depth', message:'窗框进深须为正数'});
      if (f.color !== undefined && (typeof f.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(f.color)))
        errors.push({code:'bad_window_frame', path:P+'.color', message:'窗框颜色须为六位十六进制色值'});
      if (validRatios && isNum(width) && rectOK(w.rect)){
        const length = Math.max(w.rect[2]-w.rect[0], w.rect[3]-w.rect[1]);
        const n = ratios ? ratios.length : Math.max(1, Math.round(length/900));
        if (length <= (n+1)*width) errors.push({code:'bad_window_frame', path:P, message:'窗框分格挤占全部玻璃净宽'});
      }
    });
    m.doors.forEach((d, i) => checkOpening(d, 'doors', i));
    // 门铰点 / 宽度 / 开向
    m.doors.forEach((d, i) => {
      if (d.swing !== 'swing') return;
      const [x0,y0,x1,y1] = d.rect, T = 2;
      const onCorner = d.hinge && Math.min(Math.abs(d.hinge[0]-x0), Math.abs(d.hinge[0]-x1)) <= T
                                   && Math.min(Math.abs(d.hinge[1]-y0), Math.abs(d.hinge[1]-y1)) <= T;
      if (!onCorner) warnings.push({code:'hinge_off', path:d.id, message:`门「${d.name||d.id}」铰点不在洞口角点附近（按原值保留）`});
      const vlen = Math.max(d.rect[2]-d.rect[0], d.rect[3]-d.rect[1]);
      if (!isNum(d.width) || Math.abs(d.width - vlen) > 2 || d.width < 400 || d.width > 2000)
        warnings.push({code:'door_width', path:d.id, message:`门「${d.name||d.id}」宽度异常：${d.width}（洞口 ${Math.round(vlen)}）`});
    });
    // 声明的 BOUNDS 未包含几何
    const b = m.bounds, d = m.meta.declaredBounds;
    if (d && isNum(d.x) && isNum(d.w) && (d.x > b.x || d.y > b.y || d.x+d.w < b.x+b.w || d.y+d.h < b.y+b.h))
      warnings.push({code:'bounds_gap', message:`声明的 BOUNDS 未完全包含几何（几何 [${b.x}, ${b.y}, ${b.x+b.w}, ${b.y+b.h}]）`});
    return {errors, warnings};
  }

  /* ======================= Adapter：原生字段（格式 A / B） =======================
   * WALLS: [[x0,y0,x1,y1,'b'|'e'|'n'|'low'], ...]
   * B（可选 BOUNDS）/ WINDOWS / DOORS{name,rect,h,c,o,len,entry?} / SLIDES{rect,v} / ROOMS{id,name,poly,mat,at?,counted?} / MATS
   * 类型映射：'b'→bearing（保护）'e'→exterior+unknown（保护）'n'→non_bearing+interior
   *           'low'→low（承重未知，保护）其他/缺失→unknown（保守保护，告警）            */
  const NATIVE_KIND = {
    b:   () => ({kind:'interior', bearing:'bearing'}),
    e:   () => ({kind:'exterior', bearing:'unknown'}),
    n:   () => ({kind:'interior', bearing:'non_bearing'}),
    low: () => ({kind:'low',      bearing:'unknown'}),
  };
  function adaptNative(json, fileName){
    const errors = [], warnings = [], defaults = [];
    const m = blankModel();
    m.meta.name = typeof json.NAME === 'string' && json.NAME ? json.NAME : (fileName || '导入户型');
    m.meta.source = {format: json.BOUNDS ? 'B' : 'A', file: fileName || null};
    m.meta.declaredBounds = (json.BOUNDS && isNum(json.BOUNDS.x) && isNum(json.BOUNDS.y) && isNum(json.BOUNDS.w) && isNum(json.BOUNDS.h))
      ? {x:json.BOUNDS.x, y:json.BOUNDS.y, w:json.BOUNDS.w, h:json.BOUNDS.h} : null;
    if (!Array.isArray(json.WALLS) || !json.WALLS.length){
      errors.push({code:'no_walls', message:'缺少墙体数据（WALLS 为空或缺失）'});
      return {model:m, errors, warnings, defaults};
    }
    m.walls = json.WALLS.map((w, i) => {
      const rect = Array.isArray(w) ? w.slice(0,4) : (w && Array.isArray(w.rect) ? w.rect.slice() : null);
      const t = Array.isArray(w) ? w[4] : (w && w.type);
      const map = NATIVE_KIND[t];
      if (!map){
        warnings.push({code:'unknown_wall_type', path:`WALLS[${i}]`, message:`未知墙体类型「${String(t)}」，按 unknown 保守保护`});
        const dflt = map || {kind:'unknown', bearing:'unknown'};
        return {id: w && typeof w.id === 'string' ? w.id : 'w'+i, rect, ...dflt, envelope:false};
      }
      return {id: w && typeof w.id === 'string' ? w.id : 'w'+i, rect, ...map(), envelope:false};
    });
    const winsRaw = Array.isArray(json.WINDOWS) ? json.WINDOWS : (Array.isArray(json.WINS) ? json.WINS : []);   // 原生格式两代键名：WINS（原项目）/ WINDOWS
    m.windows = winsRaw.map((r, i) => ({
      id: 'win'+i, rect: Array.isArray(r) ? r.slice() : (r && Array.isArray(r.rect) ? r.rect.slice() : null),
      wallId: null, kind: 'standard', group: null,
      sillHeight: DEFAULTS.window.sill, height: WINDOW_HEIGHT, sillSource: 'default',
    }));
    defaults.push({path:'windows[*].sillHeight', value:DEFAULTS.window.sill, tag:'默认', reason:'原生格式未声明窗台高度'});
    m.doors = (Array.isArray(json.DOORS) ? json.DOORS : []).map((d, i) => {
      const swing = d && d.h && d.c && d.o;
      if (!swing) warnings.push({code:'door_swing_missing', path:`DOORS[${i}]`, message:`门「${(d && d.name) || i}」缺少铰点/开向，按中性门洞显示`});
      return {
        id:'d'+i, name: d && d.name || '门'+(i+1), rect: d && d.rect && d.rect.slice() || null,
        hinge: swing ? d.h.slice() : null, closeDir: swing ? d.c.slice() : null, openDir: swing ? d.o.slice() : null,
        width: d && isNum(d.len) ? d.len : null, height: DEFAULTS.door.height,
        entry: !!(d && d.entry), lintelHeight: DEFAULTS.door.lintel,
        heightSource: 'default', swing: swing ? 'swing' : 'neutral',
      };
    });
    defaults.push({path:'doors[*].height', value:DEFAULTS.door.height, tag:'默认', reason:'原生格式未声明门扇高度'});
    defaults.push({path:'doors[*].lintelHeight', value:DEFAULTS.door.lintel, tag:'默认', reason:'原生格式未声明过梁高度'});
    m.slides = (Array.isArray(json.SLIDES) ? json.SLIDES : []).map((s, i) => ({
      id:'s'+i, rect: s && s.rect && s.rect.slice() || null, vertical: !!(s && s.v),
      height: DEFAULTS.slide.height, heightSource: 'default',
    }));
    defaults.push({path:'slides[*].height', value:DEFAULTS.slide.height, tag:'默认', reason:'原生格式未声明推拉门高度'});
    m.rooms = (Array.isArray(json.ROOMS) ? json.ROOMS : []).map((r, i) => ({
      id: r && typeof r.id === 'string' ? r.id : 'room'+i,
      name: r && r.name || '房间'+(i+1),
      polygon: r && Array.isArray(r.poly) ? r.poly.map(p => p.slice()) : (r && Array.isArray(r.polygon) ? r.polygon.map(p => p.slice()) : null),
      matId: r && typeof r.mat === 'string' ? r.mat : null,
      labelAt: r && Array.isArray(r.at) ? r.at.slice() : null,
      counted: r ? r.counted !== false : true,
      floorElevation: DEFAULTS.room.floorElevation,
    }));
    if (typeof json.MATS === 'object' && json.MATS) Object.assign(m.materials, json.MATS);
    return {model:m, errors, warnings, defaults};
  }

  /* ======================= Adapter：统一标准格式（格式 C） =======================
   * { schemaVersion:'floorplan.standard/1', metadata:{name,units,ceilingHeight,bounds?},
   *   walls:[{id,rect,kind?,bearing?}], windows:[{id,rect,kind?,group?,sillHeight?,height?,frame?}],
   *   frame?:{panelRatios?:number[],width?:mm,depth?:mm,color?:'#rrggbb'},
   *   doors:[{id,name?,rect,hinge?,closeDir?,openDir?,width?,height?,entry?,lintelHeight?}],
   *   slides:[{id,rect,vertical?,height?}], rooms:[{id,name,polygon,matId?,labelAt?,counted?,floorElevation?}],
   *   materials? }                                                                     */
  const C_KIND = ['exterior','interior','low'];
  const C_BEARING = ['bearing','non_bearing','unknown'];
  const C_WIN_KIND = ['standard','bay','french'];
  function adaptStandard(json, fileName){
    const errors = [], warnings = [], defaults = [];
    const m = blankModel();
    const md = json.metadata || {};
    m.meta.name = md.name || fileName || '导入户型';
    m.meta.source = {format:'C', file: fileName || null};
    m.meta.units = md.units || 'mm';
    if (md.units && md.units !== 'mm') errors.push({code:'bad_units', message:`未知单位：${md.units}（当前仅支持 mm）`});
    m.meta.ceilingHeight = isNum(md.ceilingHeight) ? md.ceilingHeight : DEFAULTS.ceilingHeight;
    if (!isNum(md.ceilingHeight)) defaults.push({path:'metadata.ceilingHeight', value:DEFAULTS.ceilingHeight, tag:'默认', reason:'未声明层高'});
    m.meta.declaredBounds = (Array.isArray(md.bounds) && md.bounds.every(isNum)) ?
      {x:md.bounds[0], y:md.bounds[1], w:md.bounds[2]-md.bounds[0], h:md.bounds[3]-md.bounds[1]} : null;
    if (typeof json.materials === 'object' && json.materials) Object.assign(m.materials, json.materials);

    const walls = Array.isArray(json.walls) ? json.walls : [];
    if (!walls.length) errors.push({code:'no_walls', message:'缺少墙体数据（walls 为空或缺失）'});
    m.walls = walls.map((w, i) => {
      const id = typeof w.id === 'string' ? w.id : 'w'+i;
      if (typeof w.kind === 'string' && !C_KIND.includes(w.kind))
        errors.push({code:'bad_enum', path:`walls[${i}].kind`, message:`非法 kind「${w.kind}」（允许：${C_KIND.join('/')}）`});
      if (typeof w.bearing === 'string' && !C_BEARING.includes(w.bearing))
        errors.push({code:'bad_enum', path:`walls[${i}].bearing`, message:`非法 bearing「${w.bearing}」（允许：${C_BEARING.join('/')}）`});
      const kind = typeof w.kind === 'string' ? w.kind : null;
      const bearing = typeof w.bearing === 'string' ? w.bearing : null;
      if (!kind) defaults.push({path:`walls[${i}].kind`, value:'interior', tag:'默认', reason:'未声明墙体类别'});
      if (!bearing) defaults.push({path:`walls[${i}].bearing`, value:'unknown', tag:'待确认', reason:'未声明承重属性，按承重未知保守保护'});
      return {id, rect: Array.isArray(w.rect) ? w.rect.slice() : null,
              kind: kind || 'interior', bearing: bearing || 'unknown', envelope:false};
    });
    m.windows = (Array.isArray(json.windows) ? json.windows : []).map((w, i) => {
      if (typeof w.kind === 'string' && !C_WIN_KIND.includes(w.kind))
        errors.push({code:'bad_enum', path:`windows[${i}].kind`, message:`非法窗 kind「${w.kind}」（允许：${C_WIN_KIND.join('/')}）`});
      const sill = isNum(w.sillHeight) ? w.sillHeight : null;
      const top = isNum(w.height) ? sill !== null ? sill + w.height : w.height + DEFAULTS.window.sill : null;
      if (sill === null) defaults.push({path:`windows[${i}].sillHeight`, value:DEFAULTS.window.sill, tag:'默认', reason:'未声明窗台高度'});
      if (top === null) defaults.push({path:`windows[${i}].height`, value:WINDOW_HEIGHT, tag:'默认', reason:'未声明窗高'});
      let frame;
      if (w.frame !== undefined){
        if (!w.frame || typeof w.frame !== 'object' || Array.isArray(w.frame))
          errors.push({code:'bad_window_frame', path:`windows[${i}].frame`, message:'窗框分格须为对象'});
        else frame = {...w.frame, ...(Array.isArray(w.frame.panelRatios) ? {panelRatios:w.frame.panelRatios.slice()} : {})};
      }
      return {
        id: typeof w.id === 'string' ? w.id : 'win'+i,
        rect: Array.isArray(w.rect) ? w.rect.slice() : null, wallId: null,
        kind: typeof w.kind === 'string' ? w.kind : 'standard',
        group: typeof w.group === 'string' ? w.group : null,
        sillHeight: sill !== null ? sill : DEFAULTS.window.sill,
        height: top !== null ? top - (sill !== null ? sill : DEFAULTS.window.sill) : WINDOW_HEIGHT,
        sillSource: sill !== null ? 'file' : 'default',
        ...(frame ? {frame} : {}),
      };
    });
    m.doors = (Array.isArray(json.doors) ? json.doors : []).map((d, i) => {
      const full = d.hinge && d.closeDir && d.openDir;
      const partial = !full && (d.hinge || d.closeDir || d.openDir);
      if (partial) warnings.push({code:'door_swing_partial', path:`doors[${i}]`, message:`门「${d.name || d.id || i}」开向信息不完整，按中性门洞显示`});
      const h = isNum(d.height) ? d.height : null, lh = isNum(d.lintelHeight) ? d.lintelHeight : null;
      const wd = isNum(d.width) ? d.width : null;
      if (h === null) defaults.push({path:`doors[${i}].height`, value:DEFAULTS.door.height, tag:'默认', reason:'未声明门扇高度'});
      if (lh === null) defaults.push({path:`doors[${i}].lintelHeight`, value:DEFAULTS.door.lintel, tag:'默认', reason:'未声明过梁高度'});
      if (wd === null) defaults.push({path:`doors[${i}].width`, value:null, tag:'待确认', reason:'未声明门宽，按洞口长边渲染'});
      return {
        id: typeof d.id === 'string' ? d.id : 'd'+i, name: d.name || '门'+(i+1),
        rect: Array.isArray(d.rect) ? d.rect.slice() : null,
        hinge: full ? d.hinge.slice() : null, closeDir: full ? d.closeDir.slice() : null, openDir: full ? d.openDir.slice() : null,
        width: wd !== null ? wd : (Array.isArray(d.rect) ? Math.max(d.rect[2]-d.rect[0], d.rect[3]-d.rect[1]) : null),
        height: h !== null ? h : DEFAULTS.door.height,
        entry: !!d.entry, lintelHeight: lh !== null ? lh : DEFAULTS.door.lintel,
        heightSource: h !== null ? 'file' : 'default',
        swing: full ? 'swing' : 'neutral',
      };
    });
    m.slides = (Array.isArray(json.slides) ? json.slides : []).map((s, i) => {
      const h = isNum(s.height) ? s.height : null;
      if (h === null) defaults.push({path:`slides[${i}].height`, value:DEFAULTS.slide.height, tag:'默认', reason:'未声明推拉门高度'});
      return {id: typeof s.id === 'string' ? s.id : 's'+i,
              rect: Array.isArray(s.rect) ? s.rect.slice() : null,
              vertical: !!s.vertical, height: h !== null ? h : DEFAULTS.slide.height,
              heightSource: h !== null ? 'file' : 'default'};
    });
    m.rooms = (Array.isArray(json.rooms) ? json.rooms : []).map((r, i) => {
      if (r.counted === undefined) defaults.push({path:`rooms[${i}].counted`, value:true, tag:'默认', reason:'未声明是否计入使用面积'});
      const el = isNum(r.floorElevation) ? r.floorElevation : null;
      if (el === null) defaults.push({path:`rooms[${i}].floorElevation`, value:DEFAULTS.room.floorElevation, tag:'默认', reason:'未声明地面高差'});
      const mat = typeof r.matId === 'string' ? r.matId : null;
      return {
        id: typeof r.id === 'string' ? r.id : 'room'+i, name: r.name || '房间'+(i+1),
        polygon: Array.isArray(r.polygon) ? r.polygon.map(p => p.slice()) : null,
        matId: mat, labelAt: Array.isArray(r.labelAt) ? r.labelAt.slice() : null,
        counted: r.counted !== undefined ? !!r.counted : true,
        floorElevation: el !== null ? el : DEFAULTS.room.floorElevation,
      };
    });
    return {model:m, errors, warnings, defaults};
  }

  /* ======================= 格式检测与收尾 ======================= */
  const registry = [
    {id:'C', detect: j => (typeof j.schemaVersion === 'string' && j.schemaVersion.startsWith('floorplan.standard'))
        || (Array.isArray(j.walls) && typeof j.metadata === 'object' && j.metadata),
              adapt: adaptStandard},
    {id:'B', detect: j => Array.isArray(j.WALLS) && j.BOUNDS, adapt: adaptNative},
    {id:'A', detect: j => Array.isArray(j.WALLS), adapt: adaptNative},
  ];
  function detectFormat(json){
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    for (const r of registry) { try { if (r.detect(json)) return r.id; } catch(e) {} }
    return null;
  }

  // 收尾：飘窗组识别（原生）→ 嵌入墙 → 包围盒 → 外围墙 → 标签点 → 材质回退
  function finish(res){
    const m = res.model;
    detectBayGroups(m.windows);
    m.windows.forEach(w => { w.wallId = isRect(w.rect) ? embedWallId(m, w.rect) : null; });
    computeBounds(m);
    markEnvelope(m);
    m.rooms.forEach(r => { if (!r.labelAt && Array.isArray(r.polygon) && r.polygon.length >= 3) r.labelAt = roomLabelAt(r.polygon); });
    m.rooms.forEach(r => {
      if (r.matId && !m.materials[r.matId]){
        res.warnings.push({code:'unknown_mat', path:r.id, message:`房间「${r.name}」未知材质「${r.matId}」，已回退为「橡木地板」`});
        r.matId = 'wood';   // 材质非几何，允许回退；坐标一律不动
      }
    });
    m.defaults = res.defaults;
    return res;
  }

  /**
   * 导入入口：文本 → {ok:true, model, errors, warnings, defaults} | {ok:false, errors, warnings, model:null}
   */
  function importFromText(text, fileName){
    const warnings = [];
    let json;
    try { json = JSON.parse(text); }
    catch(e){ return {ok:false, errors:[{code:'bad_json', message:'JSON 语法错误：' + e.message}], warnings, model:null}; }
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return {ok:false, errors:[{code:'bad_json', message:'顶层必须是 JSON 对象'}], warnings, model:null};
    const fid = detectFormat(json);
    if (!fid) return {ok:false, errors:[{code:'unknown_format', message:'无法识别的户型格式（支持：格式 C 统一标准格式 / 原生字段 WALLS 格式 A·B）'}], warnings, model:null};
    const entry = registry.find(r => r.id === fid);
    const res = entry.adapt(json, fileName);
    if (res.errors.length) return {ok:false, errors:res.errors, warnings:[...warnings, ...res.warnings], model:null};
    finish(res);                                   // 可能追加 unknown_mat 警告
    warnings.push(...res.warnings);
    const v = validateGeometry(res.model);
    warnings.push(...v.warnings);
    if (v.errors.length) return {ok:false, errors:v.errors, warnings, model:null};
    return {ok:true, model:res.model, errors:[], warnings, defaults:res.model.defaults};
  }

  /* ======================= 导出：统一标准格式（Phase 3B 下载用） ======================= */
  function exportStandard(m){
    const out = {
      schemaVersion: STD_VERSION,
      metadata: {name:m.meta.name, units:'mm', coordinateSystem:m.meta.coordinateSystem,
                 ceilingHeight:m.meta.ceilingHeight,
                 bounds: m.bounds ? [m.bounds.x, m.bounds.y, m.bounds.x+m.bounds.w, m.bounds.y+m.bounds.h] : null},
      walls: m.walls.map(w => ({id:w.id, rect:w.rect.slice(), kind:w.kind, bearing:w.bearing})),
      windows: m.windows.map(w => ({id:w.id, rect:w.rect.slice(), kind:w.kind,
        group:w.group || undefined, sillHeight:w.sillHeight, height:w.height,
        ...(w.frame ? {frame:{...w.frame, ...(w.frame.panelRatios ? {panelRatios:w.frame.panelRatios.slice()} : {})}} : {})})),
      doors: m.doors.map(d => ({id:d.id, name:d.name, rect:d.rect.slice(),
        hinge:d.hinge || undefined, closeDir:d.closeDir || undefined, openDir:d.openDir || undefined,
        width:d.width, height:d.height, entry:d.entry || undefined, lintelHeight:d.lintelHeight,
        swing:d.swing})),
      slides: m.slides.map(s => ({id:s.id, rect:s.rect.slice(), vertical:s.vertical, height:s.height})),
      rooms: m.rooms.map(r => ({id:r.id, name:r.name, polygon:r.polygon.map(p => p.slice()),
        matId:r.matId, labelAt:r.labelAt || undefined, counted:r.counted, floorElevation:r.floorElevation})),
      materials: Object.assign({}, m.materials),
    };
    return out;
  }

  /* ======================= 拆墙权限（保守保护） ======================= */
  const canDemolish = w => !!w && w.bearing === 'non_bearing' && w.kind !== 'exterior' && !w.envelope;
  function demolishBlockReason(w){
    if (!w) return 'unknown_wall';
    if (w.bearing !== 'non_bearing') return 'bearing_or_unknown';   // 承重 / 承重未知 → 一律保护
    if (w.kind === 'exterior') return 'exterior';
    if (w.envelope) return 'envelope';
    return null;
  }

  /* ======================= 内置模型 ======================= */
  let builtinCache = null;
  function builtinModel(){
    if (builtinCache) return builtinCache;
    const m = blankModel();
    m.meta.name = BUILTIN.name;
    m.meta.isDefault = true;
    m.meta.source = {format:'builtin', file:null};
    m.meta.declaredBounds = Object.assign({}, BUILTIN.declaredBounds);
    m.walls = BUILTIN.walls.map((w, i) => ({id:'w'+i, rect:[w[0],w[1],w[2],w[3]], ...(NATIVE_KIND[w[4]]()), envelope:false}));
    // 窗：0 号为主卫高窗（台 1400），6-11 为两组飘窗（台 450），其余 900 —— 均为内置已核实值
    m.windows = BUILTIN.wins.map((r, i) => {
      const bay = i >= 6;
      const sill = i === 0 ? 1400 : bay ? 450 : DEFAULTS.window.sill;
      return {id:'win'+i, rect:r.slice(), wallId:null,
              kind: bay ? 'bay' : 'standard', group: bay ? (i < 9 ? 'bay1' : 'bay2') : null,
              sillHeight:sill, height: DEFAULTS.window.top - sill, sillSource:'builtin'};
    });
    m.doors = BUILTIN.doors.map((d, i) => ({
      id:'d'+i, name:d.name, rect:d.rect.slice(), hinge:d.h.slice(), closeDir:d.c.slice(), openDir:d.o.slice(),
      width:d.len, height:DEFAULTS.door.height, entry:!!d.entry, lintelHeight:DEFAULTS.door.lintel,
      heightSource:'builtin', swing:'swing',
    }));
    m.slides = BUILTIN.slides.map((s, i) => ({
      id:'s'+i, rect:s.rect.slice(), vertical:!!s.v,
      height: s.v ? DEFAULTS.slide.tallHeight : DEFAULTS.slide.height, heightSource:'builtin',
    }));
    m.rooms = BUILTIN.rooms.map(r => ({
      id:r.id, name:r.name, polygon:r.poly.map(p => p.slice()), matId:r.mat,
      labelAt:r.at ? r.at.slice() : null, counted:r.counted !== false, floorElevation:0,
    }));
    m.dims = JSON.parse(JSON.stringify(BUILTIN.dims));
    finish({model:m, defaults:m.defaults});
    builtinCache = m;
    return m;
  }

  /* ======================= 房间净轮廓（派生，不修改地板覆盖几何） =======================
   * polygon 可为防白缝而伸入墙体。净轮廓 = polygon 减去现存墙、窗带和门槛。
   * 将边在交点处分段，只保留两侧内外状态不同的段，再连接成外环/洞环。
   * 使用实际坐标，支持凹多边形、斜边、重叠矩形及一个房间分成多个区域。
   * 返回面积 mm²、周长 mm；loops 按内部在右侧定向，洞环反向。
   */
  function roomInterior(model, room, demolished = []){
    const poly = room.polygon, removed = new Set(demolished);
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const rects = [...model.walls.filter(w => !removed.has(w.id)),
                   ...model.windows, ...model.doors, ...model.slides]
      .map(o => o.rect).filter(r => overlap(r, bounds) > 0);
    const inside = (x, y) => ptInPoly(x, y, poly) &&
      !rects.some(r => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
    const segments = [], cross = (a,b) => a[0]*b[1] - a[1]*b[0];
    const addLoop = points => points.forEach((a,i) => {
      const b = points[(i+1)%points.length], v = [b[0]-a[0], b[1]-a[1]];
      if (v[0] || v[1]) segments.push({a, v, cuts:[0,1]});
    });
    addLoop(poly);
    rects.forEach(r => addLoop(R(...r)));
    const cut = (s,t) => { if (t >= -1e-10 && t <= 1+1e-10) s.cuts.push(Math.max(0, Math.min(1,t))); };
    for (let i=0; i<segments.length; i++) for (let j=i+1; j<segments.length; j++){
      const a = segments[i], b = segments[j], d = [b.a[0]-a.a[0], b.a[1]-a.a[1]], c = cross(a.v,b.v);
      if (Math.abs(c) > 1e-10){
        const t = cross(d,b.v)/c, u = cross(d,a.v)/c;
        if (t >= -1e-10 && t <= 1+1e-10 && u >= -1e-10 && u <= 1+1e-10){ cut(a,t); cut(b,u); }
      } else if (Math.abs(cross(d,a.v)) < 1e-7){
        // 共线边也需在彼此端点处分段，避免重复墙块或墙面部分重叠时留下假边。
        const axis = Math.abs(a.v[0]) >= Math.abs(a.v[1]) ? 0 : 1;
        cut(a, d[axis]/a.v[axis]); cut(a, (d[axis]+b.v[axis])/a.v[axis]);
        cut(b, -d[axis]/b.v[axis]); cut(b, (a.v[axis]-d[axis])/b.v[axis]);
      }
    }
    const point = (s,t) => s.a.map((v,i) => Math.round((v+s.v[i]*t)*1e7)/1e7);
    const key = p => p.join(','), edges = new Map();
    for (const s of segments){
      const cuts = s.cuts.sort((a,b) => a-b).filter((t,i,a) => !i || t-a[i-1] > 1e-10);
      for (let i=1; i<cuts.length; i++){
        let a = point(s,cuts[i-1]), b = point(s,cuts[i]);
        const dx = b[0]-a[0], dy = b[1]-a[1], len = Math.hypot(dx,dy);
        if (len < 1e-7) continue;
        const x = (a[0]+b[0])/2, y = (a[1]+b[1])/2, step = Math.min(1e-4,len*1e-4);
        const nx = -dy/len*step, ny = dx/len*step;
        const right = inside(x+nx,y+ny), left = inside(x-nx,y-ny);
        if (right === left) continue;
        if (!right) [a,b] = [b,a];
        edges.set(key(a)+'>'+key(b), {a,b});
      }
    }
    const outgoing = new Map();
    for (const e of edges.values()){
      const k = key(e.a);
      if (!outgoing.has(k)) outgoing.set(k,[]);
      outgoing.get(k).push(e);
    }
    const loops = [];
    for (const first of edges.values()){
      if (first.used) continue;
      const loop = []; let e = first;
      while (e && !e.used){
        e.used = true; loop.push(e.a);
        if (key(e.b) === key(first.a)) break;
        const candidates = (outgoing.get(key(e.b)) || []).filter(n => !n.used);
        const dx = e.b[0]-e.a[0], dy = e.b[1]-e.a[1];
        // 点接触的两块区域各自闭合：优先沿内侧右转，不能跨接成自交环。
        const turn = n => Math.atan2(dx*(n.b[1]-n.a[1])-dy*(n.b[0]-n.a[0]),
                                    dx*(n.b[0]-n.a[0])+dy*(n.b[1]-n.a[1]));
        e = candidates.sort((a,b) => turn(b)-turn(a))[0];
      }
      // 只删除同向共线的中间点，保留真实凹角和洞。
      const clean = loop.filter((p,i) => {
        const a = loop[(i+loop.length-1)%loop.length], b = loop[(i+1)%loop.length];
        const u = [p[0]-a[0],p[1]-a[1]], v = [b[0]-p[0],b[1]-p[1]];
        return Math.abs(cross(u,v)) > 1e-7 || u[0]*v[0]+u[1]*v[1] < 0;
      });
      if (clean.length >= 3) loops.push(clean);
    }
    let area = 0, perimeter = 0;
    for (const loop of loops) for (let i=0; i<loop.length; i++){
      const a = loop[i], b = loop[(i+1)%loop.length];
      area += (a[0]*b[1]-b[0]*a[1])/2;
      perimeter += Math.hypot(b[0]-a[0],b[1]-a[1]);
    }
    const points = loops.flat();
    return {loops, area:Math.max(0,area), perimeter,
      bounds:points.length ? [Math.min(...points.map(p=>p[0])), Math.min(...points.map(p=>p[1])),
                              Math.max(...points.map(p=>p[0])), Math.max(...points.map(p=>p[1]))] : bounds};
  }

  // 自动尺寸取房间净轮廓。墙短端面只是墙厚回折，不生成尺寸；洞口只量长轴。
  function planDimensions(model, demolished = [], interiors = {}){
    const walls = model.walls.filter(w => !demolished.includes(w.id));
    const rooms = model.rooms.map(r => ({room:r, geometry:interiors[r.id] || roomInterior(model,r,demolished)}));
    const result = [];
    for (const {room,geometry} of rooms) geometry.loops.forEach((loop,k) => {
      loop.forEach((a,i) => {
        const b = loop[(i+1)%loop.length], dx=b[0]-a[0], dy=b[1]-a[1], length=Math.hypot(dx,dy);
        if (length < 1e-6) return;
        const wallEnd = walls.some(w => {
          const [x0,y0,x1,y1]=w.rect;
          return (dx===0 && x1-x0>y1-y0 && (a[0]===x0 || a[0]===x1) && Math.min(a[1],b[1])>=y0 && Math.max(a[1],b[1])<=y1) ||
                 (dy===0 && y1-y0>x1-x0 && (a[1]===y0 || a[1]===y1) && Math.min(a[0],b[0])>=x0 && Math.max(a[0],b[0])<=x1);
        });
        if (!wallEnd) result.push({id:`${room.id}:${k}:${i}`,kind:'room',roomId:room.id,a:a.slice(),b:b.slice(),
                                  normal:[-dy/length,dx/length],value:length});
      });
    });
    const roomAt = p => rooms.find(({geometry}) => geometry.loops.reduce((hit,loop) => hit !== ptInPoly(p[0],p[1],loop),false));
    for (const [kind,objects] of [['window',model.windows],['door',model.doors],['slide',model.slides]]){
      objects.forEach(o => {
        const [x0,y0,x1,y1]=o.rect, horizontal=x1-x0>=y1-y0, cx=(x0+x1)/2,cy=(y0+y1)/2;
        const a=horizontal ? [x0,cy] : [cx,y0], b=horizontal ? [x1,cy] : [cx,y1];
        const negative=roomAt(horizontal ? [cx,y0-2] : [x0-2,cy]);
        const positive=roomAt(horizontal ? [cx,y1+2] : [x1+2,cy]);
        let sign;
        if (kind==='window'){
          if (positive && !negative) sign=-1;
          else if (negative && !positive) sign=1;
          else sign=horizontal ? Math.sign(cy-(model.bounds.y+model.bounds.h/2)) || 1
                               : Math.sign(cx-(model.bounds.x+model.bounds.w/2)) || 1;
        } else sign=(positive?.geometry.area || 0)>=(negative?.geometry.area || 0) ? 1 : -1;
        const normal=horizontal ? [0,sign] : [sign,0];
        result.push({id:o.id,kind,openingId:o.id,a,b,normal,
                     ...(kind!=='window' && negative && positive ? {alternateNormal:normal.map(v=>-v)} : {}),
                     value:horizontal ? x1-x0 : y1-y0});
      });
    }
    return result;
  }

  // 墙段轴向优先沿相邻洞口/连续墙带确定，短墙垛的长度可能小于墙厚。
  // 沿房间净轮廓裁出实际外露墙面，交接墙/柱占地不进入长度；两侧分别量取。
  function wallDimensions(model, demolished = [], interiors = {}){
    const walls=model.walls.filter(w=>!demolished.includes(w.id));
    const openings=[...model.windows,...model.doors,...model.slides];
    const eps=1e-6,near=(a,b)=>Math.abs(a-b)<eps;
    const along=(r,s,axis)=>near(r[1-axis],s[1-axis])&&near(r[3-axis],s[3-axis])&&
      (near(r[axis],s[axis+2])||near(r[axis+2],s[axis]));
    const thicknesses=[...walls,...openings].filter(o=>{
      const r=o.rect,w=r[2]-r[0],h=r[3]-r[1];return Math.max(w,h)>=2*Math.min(w,h);
    }).map(o=>Math.min(o.rect[2]-o.rect[0],o.rect[3]-o.rect[1]));
    const rooms=model.rooms.map(room=>({id:room.id,geometry:interiors[room.id]||roomInterior(model,room,demolished)}));
    const contains=(p,geometry)=>geometry.loops.reduce((inside,loop)=>inside!==ptInPoly(p[0],p[1],loop),false);
    return walls.flatMap(w=>{
      const r=w.rect,width=r[2]-r[0],height=r[3]-r[1];
      const openingAxes=[0,1].filter(axis=>openings.some(o=>{
        const s=o.rect,openingAxis=s[2]-s[0]>=s[3]-s[1]?0:1;
        return openingAxis===axis&&along(r,s,axis);
      }));
      const wallAxes=[0,1].filter(axis=>walls.some(o=>o.id!==w.id&&along(r,o.rect,axis)));
      let axis;
      if(openingAxes.length===1) axis=openingAxes[0];
      else if(openingAxes.length===2) return [];
      else if(wallAxes.length===1) axis=wallAxes[0];
      else {
        const widthIsThickness=thicknesses.some(v=>near(v,width)),heightIsThickness=thicknesses.some(v=>near(v,height));
        if(widthIsThickness!==heightIsThickness) axis=widthIsThickness?1:0;
        else if(!near(width,height)&&!(widthIsThickness&&heightIsThickness)) axis=width>height?0:1;
        else return [];
      }
      const perp=1-axis,point=(v,face)=>axis===0?[v,face]:[face,v];
      return [-1,1].flatMap((sign,side)=>{
        const face=r[perp+(side?2:0)],sample=face+sign*.001;
        let intervals=[];
        if(rooms.length){
          for(const room of rooms) for(const loop of room.geometry.loops) loop.forEach((p,i)=>{
            const q=loop[(i+1)%loop.length];
            if(!near(p[perp],face)||!near(q[perp],face)) return;
            const lo=Math.max(r[axis],Math.min(p[axis],q[axis])),hi=Math.min(r[axis+2],Math.max(p[axis],q[axis]));
            if(hi-lo>eps&&contains(point((lo+hi)/2,sample),room.geometry)) intervals.push({lo,hi,roomId:room.id});
          });
        } else {
          // 无房间轮廓的导入图仍可量可见墙面；先扣去同侧相交建筑占地。
          intervals=[{lo:r[axis],hi:r[axis+2]}];
          for(const o of [...walls.filter(o=>o.id!==w.id),...openings]){
            const s=o.rect;
            if(sample<=s[perp]||sample>=s[perp+2]) continue;
            intervals=intervals.flatMap(v=>{
              const lo=Math.max(v.lo,s[axis]),hi=Math.min(v.hi,s[axis+2]);
              if(hi-lo<=eps) return [v];
              return [...(lo-v.lo>eps?[{lo:v.lo,hi:lo}]:[]),...(v.hi-hi>eps?[{lo:hi,hi:v.hi}]:[])];
            });
          }
        }
        // 净轮廓上相邻的共线点只产生一条量取项。
        intervals.sort((a,b)=>String(a.roomId).localeCompare(String(b.roomId))||a.lo-b.lo||a.hi-b.hi);
        const merged=[];
        for(const v of intervals){
          const prev=merged[merged.length-1];
          if(prev&&prev.roomId===v.roomId&&v.lo<=prev.hi+eps) prev.hi=Math.max(prev.hi,v.hi);
          else merged.push({...v});
        }
        return merged.map((v,i)=>({id:`wall:${w.id}:${side}:${i}`,kind:'wall',wallId:w.id,...(v.roomId?{roomId:v.roomId}:{}),
          a:point(v.lo,face),b:point(v.hi,face),normal:axis===0?[0,sign]:[sign,0],value:v.hi-v.lo}));
      });
    });
  }

  // 用屏幕容差换算后的净距拾取测量段；同距时优先当前房间，禁止按数值关联。
  function hitPlanDimension(dimensions, point, tolerance, roomId=null){
    let hit=null,score=Infinity;
    for(const d of dimensions){
      const distance=distToSeg(point[0],point[1],d.a,d.b);
      if(distance>tolerance) continue;
      const candidate=distance+(roomId&&d.kind==='room'&&d.roomId!==roomId?tolerance*.25:0);
      if(candidate<score||(Math.abs(candidate-score)<1e-6&&d.kind==='wall'&&hit?.kind==='wall'&&d.value<hit.value)){hit=d;score=candidate;}
    }
    return hit;
  }

  // 同方向、同量取区间的两侧尺寸合并；不同洞口及异位同值尺寸分别保留。
  // 保留所有原量取项的 sourceIds，排版只把代表尺寸投影到建筑外侧。
  function exteriorDimensionLayout(model, dimensions, {fontSize=180, gap=450, step=440, pad=50} = {}){
    const b=model.bounds, edges={top:b.y,bottom:b.y+b.h,left:b.x,right:b.x+b.w};
    const lanes={top:[],bottom:[],left:[],right:[]}, items=[];
    const bounds=[b.x,b.y,b.x+b.w,b.y+b.h];
    const groups=new Map(), rounded=v=>Math.round(v*1e6)/1e6;
    dimensions.forEach((d,index)=>{
      const dx=d.b[0]-d.a[0],dy=d.b[1]-d.a[1],length=Math.hypot(dx,dy);
      if(length<1e-6) return;
      const horizontal=Math.abs(dx)>=Math.abs(dy), axis=horizontal?1:0, along=1-axis;
      const mid=d.a.map((v,i)=>(v+d.b[i])/2), center=axis===1 ? b.y+b.h/2 : b.x+b.w/2;
      let normal=[-dy/length,dx/length];
      const desired=d.kind==='room' ? -d.normal[axis] : d.kind==='window' ? d.normal[axis] : Math.sign(mid[axis]-center)||1;
      const sign=desired<0 ? -1 : 1;
      if(normal[axis]*sign<0) normal=normal.map(v=>-v);
      const side=horizontal ? (sign<0?'top':'bottom') : (sign<0?'left':'right');
      const directionSign=(horizontal?dx:dy)<0?-1:1;
      const u=[dx/length*directionSign,dy/length*directionSign];
      const project=p=>p[0]*u[0]+p[1]*u[1],ends=[project(d.a),project(d.b)].sort((a,b)=>a-b);
      const key=d.kind==='room' ? JSON.stringify(['room',...u.map(rounded),...ends.map(rounded)])
                              : JSON.stringify([d.kind,d.openingId??d.id??index]);
      const distance=Math.abs((sign<0?Math.max(d.a[axis],d.b[axis]):Math.min(d.a[axis],d.b[axis]))-edges[side]);
      const candidate={d,index,dx,dy,length,axis,along,mid,normal,sign,side,distance};
      const group=groups.get(key);
      if(!group) groups.set(key,{candidate,sourceIds:[d.id],roomIds:d.roomId?[d.roomId]:[]});
      else {
        group.sourceIds.push(d.id);
        if(d.roomId&&!group.roomIds.includes(d.roomId)) group.roomIds.push(d.roomId);
        // 保留离建筑外缘更近的一侧，减少投影距离和外围尺寸层数。
        if(distance<group.candidate.distance) group.candidate=candidate;
      }
    });
    const ordered=[...groups.values()].sort((a,b)=>
      (a.candidate.d.kind==='room')-(b.candidate.d.kind==='room') || a.candidate.d.value-b.candidate.d.value || a.candidate.index-b.candidate.index);
    for(const {candidate,sourceIds,roomIds} of ordered){
      const {d,dx,dy,axis,along,mid,normal,sign,side}=candidate;
      let angle=Math.atan2(dy,dx)*180/Math.PI;
      if(angle>=90) angle-=180;
      if(angle < -90) angle+=180;
      const text=d.text??String(Math.round(d.value));
      const tw=[...text].reduce((sum,c)=>sum+fontSize*(c.charCodeAt(0)<128?.62:1),0)+2*pad, th=fontSize+2*pad;
      const rad=angle*Math.PI/180,bw=Math.abs(Math.cos(rad))*tw+Math.abs(Math.sin(rad))*th,bh=Math.abs(Math.sin(rad))*tw+Math.abs(Math.cos(rad))*th;
      let placed;
      for(let lane=0;!placed;lane++){
        const target=edges[side]+sign*(gap+lane*step);
        const extreme=sign<0?Math.max(d.a[axis],d.b[axis]):Math.min(d.a[axis],d.b[axis]);
        const offset=(target-extreme)/normal[axis];
        const move=p=>p.map((v,i)=>v+normal[i]*offset),p=move(d.a),q=move(d.b),c=move(mid);
        const box=[c[0]-bw/2,c[1]-bh/2,c[0]+bw/2,c[1]+bh/2];
        const interval=[Math.min(p[along],q[along],box[along])-100,Math.max(p[along],q[along],box[along+2])+100];
        const row=lanes[side][lane]||[];
        if(row.some(r=>interval[0]<r[1]&&interval[1]>r[0])) continue;
        (lanes[side][lane]??=[]).push(interval);
        // 界线从外轮廓之外开始，避免穿过户型内部。
        const witness=[d.a,d.b].map(v=>v.map((x,i)=>x+normal[i]*(edges[side]+sign*60-v[axis])/normal[axis]));
        placed={...d,sourceIds,roomIds,p,q,c,normal,side,lane,angle,box,tw,th,witness,text};
      }
      items.push(placed);
      const points=[placed.p,placed.q,...placed.witness,[placed.box[0],placed.box[1]],[placed.box[2],placed.box[3]]];
      for(const p of points){bounds[0]=Math.min(bounds[0],p[0]-100);bounds[1]=Math.min(bounds[1],p[1]-100);bounds[2]=Math.max(bounds[2],p[0]+100);bounds[3]=Math.max(bounds[3],p[1]+100);}
    }
    return {items,bounds};
  }

  return {VERSION, MODEL_VERSION, STD_VERSION, DEFAULTS, registry,
          detectFormat, importFromText, exportStandard,
          builtinModel, blankModel, canDemolish, demolishBlockReason, roomLabelAt, windowFrameLayout, roomInterior, openingFloor, planDimensions, wallDimensions, exteriorDimensionLayout, hitPlanDimension,
          _internal: {computeBounds, markEnvelope, validateGeometry, detectBayGroups, BUILTIN}};
});
