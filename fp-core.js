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

  return {VERSION, MODEL_VERSION, STD_VERSION, DEFAULTS, registry,
          detectFormat, importFromText, exportStandard,
          builtinModel, blankModel, canDemolish, demolishBlockReason, roomLabelAt, windowFrameLayout,
          _internal: {computeBounds, markEnvelope, validateGeometry, detectBayGroups, BUILTIN}};
});
