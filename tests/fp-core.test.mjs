/* ============================================================
 * fp-core 单元测试（node --test tests/fp-core.test.mjs）
 * 依赖隐私样例的用例在文件缺席时自动跳过（见 samples/README.md）。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FPCore = require('../fp-core.js');

const PRIV = new URL('../samples/最终改图_v13_原生字段.json', import.meta.url);
const HAS_PRIV = existsSync(PRIV);
const privJSON = () => JSON.parse(readFileSync(PRIV, 'utf8'));
const twoRoom = () => readFileSync(new URL('../samples/two-room-c.json', import.meta.url), 'utf8');

/* 净轮廓独立于地板覆盖 polygon，防止高亮线和面积重新伸入墙体。 */
const rectPoly = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d]];
test('房间净轮廓：扣除各类建筑占地，原模型及导出几何不变', () => {
  const m = FPCore.blankModel(), room = {id:'r', polygon:rectPoly(0,0,1000,1000)};
  m.walls = [{id:'wall', rect:[0,0,100,1000]}];
  m.windows = [{rect:[100,0,1000,80]}];
  m.doors = [{rect:[100,900,500,1000]}];
  m.slides = [{rect:[500,900,1000,1000]}];
  m.rooms = [room];
  const before = JSON.stringify(m), g = FPCore.roomInterior(m,room);
  assert.equal(g.area, 900*820);
  assert.equal(g.perimeter, 2*(900+820));
  assert.deepEqual(g.bounds,[100,80,1000,900]);
  assert.equal(g.loops.length,1);
  assert.deepEqual(g.loops[0].map(p=>p.join(',')).sort(),rectPoly(100,80,1000,900).map(p=>p.join(',')).sort());
  assert.equal(JSON.stringify(m),before);
  assert.deepEqual(FPCore.exportStandard(m).rooms[0].polygon,room.polygon);
  assert.equal(FPCore.roomInterior(m,room,['wall']).area, g.area+100*1000);
});

test('房间净轮廓：重叠墙块形成的洞不重复扣面积，分离区域各自闭合', () => {
  const m = FPCore.blankModel(), room = {polygon:rectPoly(0,0,100,100)};
  m.walls = [{id:'a',rect:[20,20,70,70]}, {id:'b',rect:[40,40,80,80]}, {id:'dup',rect:[20,20,70,70]}];
  const g = FPCore.roomInterior(m,room);
  assert.equal(g.loops.length,2);
  assert.equal(g.area,10000-(2500+1600-900));
  assert.equal(g.perimeter,640);
  m.walls = [{id:'split',rect:[40,-5,60,110]}];
  const split = FPCore.roomInterior(m,room);
  assert.equal(split.loops.length,2);
  assert.equal(split.area,8000);
  assert.equal(split.perimeter,560);
  m.walls = [{id:'a',rect:[0,50,50,100]},{id:'b',rect:[50,0,100,50]}];
  assert.equal(FPCore.roomInterior(m,room).loops.length,2, '点接触不能跨接成自交环');
  m.walls = [{id:'all',rect:[-1,-1,101,101]}];
  assert.deepEqual(FPCore.roomInterior(m,room).loops,[]);
  assert.equal(FPCore.roomInterior(m,room).area,0);
});

test('房间净轮廓：斜边、反向顶点及凹角不被栅格化', () => {
  const m = FPCore.blankModel();
  m.walls = [{id:'a',rect:[0,0,50,100]}];
  for (const polygon of [[[0,0],[100,0],[0,100]], [[0,100],[100,0],[0,0]]]){
    const g = FPCore.roomInterior(m,{polygon});
    assert.equal(g.area,1250);
    assert.deepEqual(g.bounds,[50,0,100,50]);
    assert.ok(Math.abs(g.perimeter-(100+Math.hypot(50,50))) < 1e-8);
  }
  const polygon = [[0,0],[100,0],[100,40],[40,40],[40,100],[0,100]];
  m.walls = [];
  assert.equal(FPCore.roomInterior(m,{polygon}).area,6400);
});

test('当前户型：六房间贴内墙净轮廓，阳台玻璃及原地板覆盖不变', () => {
  const src = readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8');
  const {model:m,ok} = FPCore.importFromText(src,'current.json');
  assert.equal(ok,true);
  const before = JSON.stringify(FPCore.exportStandard(m));
  const gs = m.rooms.map(r => FPCore.roomInterior(m,r));
  // 由各房间墙内尺寸独立计算；开放区和西南卧室是凹形。
  assert.deepEqual(gs.map(g => g.area),[64967828,1652*1508,2738*3322,1499*2571,3442*4991,2998*3490-627*712]);
  assert.equal(gs.reduce((a,g)=>a+g.area,0),107604227);
  assert.deepEqual(gs[4].bounds,[10033,3449,13475,8440]);
  assert.ok(gs.every(g => g.loops.length === 1));
  assert.equal(JSON.stringify(FPCore.exportStandard(m)),before);
  assert.deepEqual(m.windows.find(w=>w.id==='win3').frame.panelRatios,[1,3.75,3.75,1]);
  assert.deepEqual(m.windows.filter(w=>w.kind==='french').map(w=>w.id),['win1','win3','win6']);
  const northLiving = m.windows.find(w=>w.id==='win4');
  assert.deepEqual([northLiving.kind,northLiving.sillHeight,northLiving.height],['standard',900,1500]);
});

test('规范修复：只移除冗余点，逐区域覆盖、面积及建筑坐标均不变', () => {
  const before = JSON.parse(readFileSync(new URL('../docs/review-2026-10-22/JSON规范修复前.json',import.meta.url),'utf8'));
  const after = JSON.parse(readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8'));
  for (const k of ['metadata','windows','doors','slides','materials']) assert.deepEqual(after[k],before[k],k);
  const inPoly = (x,y,p) => {
    let hit = false;
    for (let i=0,j=p.length-1;i<p.length;j=i++)
      if ((p[i][1]>y)!==(p[j][1]>y) && x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0]) hit=!hit;
    return hit;
  };
  const polyArea = p => Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
  assert.deepEqual(after.rooms.map(r=>r.polygon.length),[26,10,12,4,6,12]);
  after.rooms.forEach((r,n)=>{
    const old = before.rooms[n], p = r.polygon;
    assert.deepEqual({...r,polygon:null},{...old,polygon:null});
    assert.equal(polyArea(p),polyArea(old.polygon));
    assert.equal(new Set(p.map(a=>a.join(','))).size,p.length);
    p.forEach((b,i)=>{
      const a=p[(i+p.length-1)%p.length],c=p[(i+1)%p.length];
      assert.notEqual((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]),0,`${r.id} 不应有零边、共线中间点或折返`);
    });
    const all=p.concat(old.polygon), xs=[...new Set(all.map(a=>a[0]))].sort((a,b)=>a-b),ys=[...new Set(all.map(a=>a[1]))].sort((a,b)=>a-b);
    for(let i=1;i<xs.length;i++) for(let j=1;j<ys.length;j++){
      const x=(xs[i-1]+xs[i])/2,y=(ys[j-1]+ys[j])/2;
      assert.equal(inPoly(x,y,p),inPoly(x,y,old.polygon),`${r.id} 覆盖范围改变 ${x},${y}`);
    }
  });
  after.walls.forEach((w,i)=>assert.deepEqual({...w,kind:null},{...before.walls[i],kind:null}));
});

test('规范修复：14 段外围墙受保护，保留普通内墙的编辑能力', () => {
  const m=FPCore.importFromText(readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8'),'current.json').model;
  const ids=['w1','w7','w9','w10','w17','w21','w22','w23','w24','w25','w26','w27','w31','w33'];
  ids.forEach(id=>{
    const w=m.walls.find(w=>w.id===id);
    assert.equal(w.kind,'exterior',id);
    assert.equal(FPCore.canDemolish(w),false,id);
  });
  assert.equal(FPCore.canDemolish(m.walls.find(w=>w.id==='w41')),true);
});

test('净尺寸：六房间 39 段及全部 15 个洞口齐全，不包含墙厚和外包总尺寸', () => {
  const m=FPCore.importFromText(readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8')).model;
  const before=JSON.stringify(m),dims=FPCore.planDimensions(m);
  assert.equal(dims.length,54);
  assert.deepEqual(m.rooms.map(r=>dims.filter(d=>d.roomId===r.id).length),[17,4,4,4,4,6]);
  assert.deepEqual(dims.filter(d=>d.roomId==='R05').map(d=>d.value).sort((a,b)=>a-b),[3442,3442,4991,4991]);
  assert.deepEqual(dims.filter(d=>d.roomId==='R04').map(d=>d.value).sort((a,b)=>a-b),[1499,1499,2571,2571]);
  assert.ok(dims.some(d=>d.roomId==='R01' && d.value===4513));
  assert.ok(dims.every(d=>![245,123,122,13960,10563].includes(d.value)));
  for(const [kind,objects] of [['window',m.windows],['door',m.doors],['slide',m.slides]])
    for(const o of objects){
      const found=dims.filter(d=>d.kind===kind && d.openingId===o.id);
      assert.equal(found.length,1,o.id);
      assert.equal(found[0].value,Math.max(o.rect[2]-o.rect[0],o.rect[3]-o.rect[1]));
    }
  assert.equal(JSON.stringify(m),before);
});

test('净尺寸：即使地板覆盖整幅外包，仍量内墙面之间的净距', () => {
  const r=FPCore.importFromText(JSON.stringify({schemaVersion:'floorplan.standard/1',metadata:{units:'mm'},
    walls:[{id:'n',rect:[0,0,5000,500]},{id:'s',rect:[0,3500,5000,4000]},
           {id:'w',rect:[0,500,500,3500]},{id:'e',rect:[4500,500,5000,3500]}],
    rooms:[{id:'room',name:'房间',polygon:rectPoly(0,0,5000,4000),matId:'tile800'}]}));
  assert.equal(r.ok,true);
  const dims=FPCore.planDimensions(r.model);
  assert.deepEqual(dims.map(d=>d.value).sort((a,b)=>a-b),[3000,3000,4000,4000]);
  assert.ok(dims.every(d=>d.a[0]>=500 && d.b[0]<=4500 && d.a[1]>=500 && d.b[1]<=3500));
});

test('瓷砖通铺：三卧室门口连续，入户与卫浴保留；换材质或高差时不通铺', () => {
  const src = readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8');
  const m = FPCore.importFromText(src,'current.json').model;
  const rooms = Object.fromEntries(m.rooms.map(r=>[r.id,{name:r.name,mat:'tile800'}]));
  const before = JSON.stringify(m);
  assert.deepEqual(m.doors.map(d=>FPCore.openingFloor(m,d,rooms).continuous),[false,true,true,false,true]);
  assert.deepEqual(m.doors.map(d=>FPCore.openingFloor(m,d).continuous),[false,true,true,false,true], '最新版 JSON 独立导入也应通铺');
  assert.equal(FPCore.openingFloor(m,m.slides[0],rooms).continuous,false);
  const door = m.doors.find(d=>d.id==='d2');
  assert.deepEqual(FPCore.openingFloor(m,door,rooms),{continuous:true,matId:'tile800',roomIds:['R01','R05']});
  assert.equal(JSON.stringify(m),before);
  rooms.R05.mat = 'wood';
  assert.equal(FPCore.openingFloor(m,door,rooms).continuous,false);
  rooms.R05.mat = rooms.R01.mat = 'wood';
  assert.equal(FPCore.openingFloor(m,door,rooms).continuous,false);
  rooms.R05.mat = rooms.R01.mat = 'tile800';
  m.rooms.find(r=>r.id==='R05').floorElevation = 20;
  assert.equal(FPCore.openingFloor(m,door,rooms).continuous,false);
});

const nativeOf = (model) => ({   // 由模型反造原生格式（用于铁律测试）
  NAME: model.meta.name, BOUNDS: model.meta.declaredBounds,
  WALLS: model.walls.map(w => [...w.rect, w.bearing === 'bearing' ? 'b' : w.kind === 'exterior' ? 'e' : w.kind === 'low' ? 'low' : 'n']),
  WINDOWS: model.windows.map(w => w.rect),
  DOORS: model.doors.map(d => ({name:d.name, rect:d.rect, h:d.hinge, c:d.closeDir, o:d.openDir, len:d.width, ...(d.entry ? {entry:true} : {})})),
  SLIDES: model.slides.map(s => ({rect:s.rect, v:s.vertical})),
  ROOMS: model.rooms.map(r => ({id:r.id, name:r.name, poly:r.polygon, mat:r.matId, ...(r.labelAt ? {at:r.labelAt} : {}), ...(r.counted ? {} : {counted:false})})),
});

test('外侧尺寸：54 处量取合并为 44 处标注，完整覆盖原始尺寸且均在建筑外侧', () => {
  const src=readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8');
  const model=FPCore.importFromText(src,'current.json').model;
  const dims=FPCore.planDimensions(model).map(d=>({...d,text:(d.kind==='window'?'窗':d.kind==='door'?'门':d.kind==='slide'?'推拉门':'')+Math.round(d.value)}));
  const before=JSON.stringify({model,dims}),layout=FPCore.exteriorDimensionLayout(model,dims);
  assert.equal(layout.items.length,44);
  assert.deepEqual(layout.items.flatMap(d=>d.sourceIds).sort(),dims.map(d=>d.id).sort());
  assert.equal(layout.items.filter(d=>d.kind!=='room').length,15,'不同门窗洞口全部保留');
  const b=model.bounds,edge={top:b.y,bottom:b.y+b.h,left:b.x,right:b.x+b.w};
  for(const d of layout.items){
    const original=dims.find(s=>s.id===d.id),axis=['top','bottom'].includes(d.side)?1:0;
    const sign=['top','left'].includes(d.side)?-1:1;
    assert.equal(d.value,original.value);
    assert.deepEqual(d.a,original.a); assert.deepEqual(d.b,original.b);
    assert.ok(Math.abs(Math.hypot(d.p[0]-d.q[0],d.p[1]-d.q[1])-d.value)<1e-6);
    const labelCorners=[[d.box[0],d.box[1]],[d.box[2],d.box[3]]];
    for(const p of [d.p,d.q,...d.witness,...labelCorners]){
      assert.ok(sign*(p[axis]-edge[d.side])>0,`${d.id} 必须在 ${d.side} 外侧`);
      assert.ok(p[0]>=layout.bounds[0]&&p[0]<=layout.bounds[2]&&p[1]>=layout.bounds[1]&&p[1]<=layout.bounds[3]);
    }
  }
  for(let i=0;i<layout.items.length;i++) for(let j=i+1;j<layout.items.length;j++){
    const a=layout.items[i].box,b=layout.items[j].box;
    assert.ok(Math.min(a[2],b[2])<=Math.max(a[0],b[0])||Math.min(a[3],b[3])<=Math.max(a[1],b[1]),'尺寸文字不得重叠');
  }
  assert.equal(JSON.stringify({model,dims}),before);
});

test('尺寸去重：反向端点和两侧同区间合并，异位同值、异向及不同门窗不误删', () => {
  const model=FPCore.blankModel(); model.bounds={x:0,y:0,w:10000,h:8000};
  const dims=[
    {id:'top',kind:'room',roomId:'r1',a:[1000,100],b:[4000,100],normal:[0,1],value:3000},
    {id:'bottom',kind:'room',roomId:'r1',a:[4000,6000],b:[1000,6000],normal:[0,-1],value:3000},
    {id:'aligned',kind:'room',roomId:'r2',a:[1000,400],b:[4000,400],normal:[0,1],value:3000},
    {id:'shifted',kind:'room',roomId:'r3',a:[5000,100],b:[8000,100],normal:[0,1],value:3000},
    {id:'vertical',kind:'room',roomId:'r1',a:[1000,1000],b:[1000,4000],normal:[1,0],value:3000},
    {id:'win1',openingId:'w1',kind:'window',a:[1000,0],b:[4000,0],normal:[0,-1],value:3000},
    {id:'win2',openingId:'w2',kind:'window',a:[1000,7000],b:[4000,7000],normal:[0,1],value:3000},
    {id:'door1',openingId:'d1',kind:'door',a:[1000,2000],b:[4000,2000],normal:[0,1],value:3000}
  ];
  const {items}=FPCore.exteriorDimensionLayout(model,dims);
  assert.equal(items.length,6);
  const combined=items.find(d=>d.id==='top');
  assert.deepEqual(combined.sourceIds,['top','bottom','aligned']);
  assert.deepEqual(combined.roomIds,['r1','r2']);
  assert.equal(combined.side,'top','重复项保留离外缘最近的一侧');
  assert.deepEqual(items.filter(d=>d.id!=='top').map(d=>d.id).sort(),['shifted','vertical','win1','win2','door1'].sort());
});

test('外侧尺寸：斜边投影保持实际长度，反向端点和空列表均可处理', () => {
  const m=FPCore.blankModel(); m.bounds={x:0,y:0,w:4000,h:3000};
  const dimensions=[
    {id:'slope1',kind:'room',a:[500,500],b:[2500,1500],normal:[-1/Math.sqrt(5),2/Math.sqrt(5)],value:Math.hypot(2000,1000)},
    {id:'slope2',kind:'room',a:[3500,2500],b:[2500,500],normal:[2/Math.sqrt(5),-1/Math.sqrt(5)],value:Math.hypot(1000,2000)}
  ];
  for(const d of FPCore.exteriorDimensionLayout(m,dimensions).items){
    assert.ok(Math.abs(Math.hypot(d.p[0]-d.q[0],d.p[1]-d.q[1])-d.value)<1e-6);
    assert.ok(d.side==='top' ? Math.max(d.p[1],d.q[1],d.box[3])<0 : Math.max(d.p[0],d.q[0],d.box[2])<0);
  }
  assert.deepEqual(FPCore.exteriorDimensionLayout(m,[]),{items:[],bounds:[0,0,4000,3000]});
});

test('尺寸悬停：拾取真实有限边段，同距优先所在房间，异位同值不串联', () => {
  const dims=[
    {id:'edge1',kind:'room',roomId:'r1',a:[0,0],b:[1000,0],value:1000},
    {id:'edge2',kind:'room',roomId:'r2',a:[0,100],b:[1000,100],value:1000},
    {id:'shifted',kind:'room',roomId:'r3',a:[2000,0],b:[3000,0],value:1000},
    {id:'slope',kind:'room',roomId:'r1',a:[0,500],b:[500,1000],value:Math.hypot(500,500)},
    {id:'win',kind:'window',a:[1200,0],b:[1400,0],value:200}
  ];
  const before=JSON.stringify(dims);
  assert.equal(FPCore.hitPlanDimension(dims,[500,4],10)?.id,'edge1');
  assert.equal(FPCore.hitPlanDimension(dims,[500,50],60,'r2')?.id,'edge2');
  assert.equal(FPCore.hitPlanDimension(dims,[2500,3],10)?.id,'shifted');
  assert.equal(FPCore.hitPlanDimension(dims,[200,700],10)?.id,'slope');
  assert.equal(FPCore.hitPlanDimension(dims,[1300,2],10)?.id,'win');
  assert.equal(FPCore.hitPlanDimension(dims,[1100,0],50),null,'不能把边段延长线当作实际尺寸');
  assert.equal(FPCore.hitPlanDimension(dims,[500,300],10),null,'移开边段应隐藏提示');
  assert.equal(FPCore.hitPlanDimension([], [0,0],10),null);
  assert.equal(JSON.stringify(dims),before);
});

test('小墙段：补齐窗边及门边短墙垛的轴向长度，保留墙厚不作为量取项', () => {
  const src=readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8');
  const model=FPCore.importFromText(src,'current.json').model,before=JSON.stringify(model);
  const dims=FPCore.wallDimensions(model);
  assert.equal(new Set(dims.map(d=>d.wallId)).size,42);
  assert.equal(new Set(dims.map(d=>d.id)).size,dims.length);
  for(const [id,value] of [['w7',138],['w12',46],['w14',62],['w19',61],['w22',92]]){
    const faces=dims.filter(d=>d.wallId===id);
    assert.ok(faces.length>0,id);
    for(const d of faces){
      assert.equal(d.value,value,id);
      assert.ok(Math.abs(Math.hypot(d.b[0]-d.a[0],d.b[1]-d.a[1])-value)<1e-6);
      assert.equal(FPCore.hitPlanDimension(dims,[(d.a[0]+d.b[0])/2,(d.a[1]+d.b[1])/2],1)?.id,d.id);
    }
  }
  assert.equal(dims.some(d=>d.wallId==='w42'),false,'方形角柱不冒充轴向墙长');
  assert.equal(dims.some(d=>d.wallId==='w43'),false,'角柱内部方块不重复量取');
  assert.equal(FPCore.wallDimensions(model,['w12']).some(d=>d.wallId==='w12'),false);
  assert.equal(JSON.stringify(model),before);
});

test('小墙段：长度小于墙厚时沿相邻洞口方向量取，不能直接取矩形最长边', () => {
  const model=FPCore.blankModel();
  model.walls=[{id:'shortV',rect:[0,0,245,80]},{id:'shortH',rect:[1000,0,1080,245]},{id:'corner',rect:[3000,0,3245,245]}];
  model.windows=[{id:'winV',rect:[0,80,245,1080]},{id:'winH',rect:[1080,0,2080,245]}];
  model.rooms=[{id:'v',polygon:rectPoly(245,0,800,1080)},{id:'h',polygon:rectPoly(1000,245,2080,1000)}];
  const dims=FPCore.wallDimensions(model);
  assert.equal(dims.length,2);
  assert.deepEqual(dims.map(d=>[d.wallId,d.value]),[['shortV',80],['shortH',80]]);
  assert.deepEqual(dims[0].a,[245,0]);assert.deepEqual(dims[0].b,[245,80]);
  assert.deepEqual(dims[1].a,[1000,245]);assert.deepEqual(dims[1].b,[1080,245]);
});

test('墙面净长度：北窗交接墙扣除245毫米，其余墙面均不跨入相交建筑占地', () => {
  const src=readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8');
  const model=FPCore.importFromText(src,'current.json').model,before=JSON.stringify(model),dims=FPCore.wallDimensions(model);
  const north=dims.filter(d=>d.wallId==='w6');
  assert.equal(north.length,1);
  assert.equal(north[0].value,336,'581毫米原墙块应扣除交接墙245毫米');
  assert.deepEqual(north[0].a,[6637,5]);assert.deepEqual(north[0].b,[6973,5]);
  assert.deepEqual(dims.filter(d=>d.wallId==='w5').map(d=>d.value).sort((a,b)=>a-b),[160,321],'中间123毫米交接墙应拆分两侧净墙面');
  for(const d of dims){
    const axis=Math.abs(d.b[0]-d.a[0])>1e-6?0:1,perp=1-axis;
    const probe=d.a[perp]+d.normal[perp]*.001;
    const lo=Math.min(d.a[axis],d.b[axis]),hi=Math.max(d.a[axis],d.b[axis]);
    for(const o of [...model.walls,...model.windows,...model.doors,...model.slides]){
      const r=o.rect;
      if(probe>r[perp]&&probe<r[perp+2]){
        assert.ok(Math.min(hi,r[axis+2])-Math.max(lo,r[axis])<=1e-6,`${d.id} 的净墙面不能跨入 ${o.id}`);
      }
    }
  }
  assert.equal(JSON.stringify(model),before);
});

test('墙面净长度：T形交接把同一墙块拆成两段，并按鼠标位置选择对应侧', () => {
  const model=FPCore.blankModel();
  model.walls=[{id:'top',rect:[0,0,2000,200]},{id:'branch',rect:[1500,200,1700,1200]}];
  model.rooms=[{id:'r',polygon:rectPoly(0,200,3000,2000)}];
  const faces=FPCore.wallDimensions(model).filter(d=>d.wallId==='top');
  assert.deepEqual(faces.map(d=>[d.a,d.b,d.value]),[[[0,200],[1500,200],1500],[[1700,200],[2000,200],300]]);
  assert.equal(FPCore.hitPlanDimension(faces,[1000,100],Infinity)?.value,1500);
  assert.equal(FPCore.hitPlanDimension(faces,[1800,100],Infinity)?.value,300);
  const withoutRooms=FPCore.wallDimensions({...model,rooms:[]}).filter(d=>d.wallId==='top'&&d.a[1]===200);
  assert.deepEqual(withoutRooms.map(d=>d.value),[1500,300],'无房间时同样扣除相交占地');
});

test('墙面净长度：L形转角两边分别排除墙厚，拆除交接墙后重新派生', () => {
  const model=FPCore.blankModel();
  model.walls=[{id:'top',rect:[0,0,1000,200]},{id:'side',rect:[800,200,1000,1000]}];
  model.rooms=[{id:'r',polygon:rectPoly(0,200,1000,1000)}];
  const dims=FPCore.wallDimensions(model);
  assert.deepEqual(dims.filter(d=>d.wallId==='top').map(d=>d.value),[800]);
  assert.deepEqual(dims.filter(d=>d.wallId==='side').map(d=>d.value),[800]);
  assert.deepEqual(FPCore.wallDimensions(model,['side']).map(d=>d.value),[1000]);
});

/* ======================= 1. 内置模型 ======================= */
test('内置模型：结构与数量', () => {
  const m = FPCore.builtinModel();
  assert.equal(m.version, 'fp.model/1');
  assert.equal(m.meta.isDefault, true);
  assert.equal(m.meta.source.format, 'builtin');
  assert.equal(m.meta.units, 'mm');
  assert.ok(m.walls.length >= 40, `墙数 ${m.walls.length}`);
  assert.equal(m.windows.length, 12);
  assert.equal(m.doors.length, 6);
  assert.equal(m.slides.length, 2);
  assert.equal(m.rooms.length, 13);
  assert.equal(Object.keys(m.materials).length, 8);
  assert.equal(m.dims.chains.length, 8);
  assert.ok(m.bounds && m.bounds.w > 0);
  m.walls.forEach((w, i) => assert.equal(w.id, 'w' + i));   // 与 v1 存档 demolished 索引 id 兼容
});
test('内置模型：id 唯一', () => {
  const m = FPCore.builtinModel();
  for (const key of ['walls','windows','doors','slides','rooms']){
    const ids = m[key].map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, key);
  }
});
test('内置模型：飘窗/高窗 provenance 与分组', () => {
  const m = FPCore.builtinModel();
  assert.equal(m.windows[0].sillHeight, 1400);
  assert.equal(m.windows[1].sillHeight, 900);
  assert.equal(m.windows[6].sillHeight, 450);
  assert.equal(m.windows[6].kind, 'bay');
  assert.equal(m.windows[6].group, 'bay1');
  assert.equal(m.windows[9].group, 'bay2');
  m.windows.forEach(w => assert.equal(w.sillSource, 'builtin'));
  m.windows.forEach(w => assert.equal(w.sillHeight + w.height, 2400));
});
test('内置模型：外围墙 envelope 派生', () => {
  const m = FPCore.builtinModel();
  const env = m.walls.filter(w => w.envelope);
  assert.ok(env.length >= 10, `外围墙 ${env.length}`);   // 口径：贴几何包围盒 ±25mm 的最外层墙
  // 顶部外墙段贴包围盒上缘 → 标记
  assert.equal(m.walls.find(w => w.rect[0] === 2120 && w.rect[1] === -240).envelope, true);
  // 内墙 [2420,4950,4580,5190] 远离包围盒，不该被标记（外墙另有 kind=exterior 保护）
  const inner = m.walls.find(w => w.rect[0] === 2420 && w.rect[1] === 4950);
  assert.equal(inner.envelope, false);
  // 右侧外墙段因阳台更凸出不贴包围盒，但 kind=exterior 仍受保护
  const right = m.walls.find(w => w.rect[0] === 10270 && w.rect[1] === 300);
  assert.equal(right.envelope, false);
  assert.equal(FPCore.canDemolish(right), false);
});

/* ======================= 2. 铁律：不修改用户几何 ======================= */
test('铁律：原生导入逐坐标保留（内置数据反造）', () => {
  const src = FPCore.builtinModel();
  const nat = nativeOf(src);
  const r = FPCore.importFromText(JSON.stringify(nat), 'iron.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  r.model.walls.forEach((w, i) => assert.deepEqual(w.rect, nat.WALLS[i].slice(0,4), `wall ${i}`));
  r.model.windows.forEach((w, i) => assert.deepEqual(w.rect, nat.WINDOWS[i]));
  r.model.doors.forEach((d, i) => assert.deepEqual(d.rect, nat.DOORS[i].rect));
  r.model.rooms.forEach((room, i) => assert.deepEqual(room.polygon, nat.ROOMS[i].poly));
});

/* ======================= 3. 格式检测 ======================= */
test('detectFormat：C / B / A / 未知', () => {
  assert.equal(FPCore.detectFormat({schemaVersion:'floorplan.standard/1'}), 'C');
  assert.equal(FPCore.detectFormat({walls:[], metadata:{}}), 'C');
  assert.equal(FPCore.detectFormat({WALLS:[[0,0,1,1,'n']], BOUNDS:{x:0,y:0,w:1,h:1}}), 'B');
  assert.equal(FPCore.detectFormat({WALLS:[[0,0,1,1,'n']]}), 'A');
  assert.equal(FPCore.detectFormat({}), null);
  assert.equal(FPCore.detectFormat({foo:1}), null);
});

/* ======================= 4. 原生 Adapter ======================= */
test('原生类型映射 b/e/n/low/未知', () => {
  const r = FPCore.importFromText(JSON.stringify({
    WALLS: [[0,0,100,100,'b'],[0,0,100,100,'e'],[0,0,100,100,'n'],[0,0,100,100,'low'],[0,0,100,100,'x'],[0,0,100,100]],
  }), 't.json');
  assert.equal(r.ok, true);
  assert.deepEqual([r.model.walls[0].bearing, r.model.walls[0].kind], ['bearing','interior']);
  assert.deepEqual([r.model.walls[1].bearing, r.model.walls[1].kind], ['unknown','exterior']);
  assert.deepEqual([r.model.walls[2].bearing, r.model.walls[2].kind], ['non_bearing','interior']);
  assert.deepEqual([r.model.walls[3].bearing, r.model.walls[3].kind], ['unknown','low']);
  assert.deepEqual([r.model.walls[4].bearing, r.model.walls[4].kind], ['unknown','unknown']);
  assert.deepEqual([r.model.walls[5].bearing, r.model.walls[5].kind], ['unknown','unknown']);
  assert.ok(r.warnings.some(w => w.code === 'unknown_wall_type'));
});
test('原生 Adapter：默认值 provenance 与 BOUNDS', () => {
  const r = FPCore.importFromText(JSON.stringify({
    NAME:'测试', BOUNDS:{x:-100, y:-100, w:400, h:400},
    WALLS:[[0,0,100,100,'n'],[100,0,300,300,'e']],
    WINDOWS:[[0,0,100,100]],
    DOORS:[{name:'门', rect:[0,0,50,100], h:[0,100], c:[1,0], o:[0,-1], len:100}],
  }), 't.json');
  assert.equal(r.ok, true);
  assert.equal(r.model.meta.source.format, 'B');
  assert.deepEqual(r.model.meta.declaredBounds, {x:-100, y:-100, w:400, h:400});
  assert.ok(r.model.defaults.some(d => d.path === 'windows[*].sillHeight' && d.tag === '默认'));
  assert.ok(r.model.defaults.some(d => d.path.startsWith('doors[')));
  assert.equal(r.model.windows[0].sillHeight, 900);
  assert.equal(r.model.windows[0].height, 1500);
  assert.equal(r.model.doors[0].height, 2050);
  assert.equal(r.model.doors[0].lintelHeight, 2100);
});
test('原生 Adapter：门开向缺失 → 中性门洞', () => {
  const r = FPCore.importFromText(JSON.stringify({
    WALLS:[[0,0,100,100,'n']], DOORS:[{name:'A', rect:[0,0,50,100]}],
  }), 't.json');
  assert.equal(r.ok, true);
  assert.equal(r.model.doors[0].swing, 'neutral');
  assert.equal(r.model.doors[0].hinge, null);
  assert.ok(r.warnings.some(w => w.code === 'door_swing_missing'));
});
test('原生 Adapter：SLIDES 方向与默认高度', () => {
  const r = FPCore.importFromText(JSON.stringify({
    WALLS:[[0,0,100,100,'n']], SLIDES:[{rect:[0,0,50,100], v:true}],
  }), 't.json');
  assert.equal(r.model.slides[0].vertical, true);
  assert.equal(r.model.slides[0].height, 2100);
  assert.equal(r.model.slides[0].heightSource, 'default');
});
test('原生 Adapter：WINS 旧键名兼容（真实文件使用 WINS）', () => {
  const r = FPCore.importFromText(JSON.stringify({
    WALLS:[[0,0,1000,240,'e']],
    WINS:[[200,0,800,240]],                        // 旧键名（原项目 / convert_plan 产物）
  }), 't.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.model.windows.length, 1);
  assert.deepEqual(r.model.windows[0].rect, [200,0,800,240]);
});

/* ======================= 5. 格式 C Adapter ======================= */
test('格式 C：两室一厅样例可导入且数量正确', () => {
  const r = FPCore.importFromText(twoRoom(), 'two-room-c.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.model.meta.source.format, 'C');
  assert.equal(r.model.walls.length, 8);
  assert.equal(r.model.windows.length, 3);
  assert.equal(r.model.doors.length, 3);
  assert.equal(r.model.rooms.length, 3);
  assert.equal(r.model.walls.find(w => w.id === 'w5').bearing, 'bearing');
  assert.equal(r.model.doors.find(d => d.entry).id, 'd1');
});
test('格式 C：开向可缺省 → 中性门洞；显式高度不覆盖', () => {
  const r = FPCore.importFromText(JSON.stringify({
    schemaVersion:'floorplan.standard/1',
    metadata:{units:'mm'},
    walls:[{id:'w1', rect:[0,0,100,100]}],
    windows:[{id:'win1', rect:[0,0,50,100], sillHeight:1200, height:800}],
    doors:[{id:'d1', rect:[0,0,50,100]}],
  }), 't.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.model.doors[0].swing, 'neutral');
  assert.equal(r.model.windows[0].sillHeight, 1200);
  assert.equal(r.model.windows[0].height, 800);
  assert.equal(r.model.windows[0].sillSource, 'file');
  assert.ok(r.model.defaults.some(d => d.tag === '待确认' && d.path === 'walls[0].bearing'));
});
test('格式 C：材质合并与未知材质回退', () => {
  const r = FPCore.importFromText(JSON.stringify({
    schemaVersion:'floorplan.standard/1',
    metadata:{units:'mm'},
    walls:[{id:'w1', rect:[0,0,100,100], bearing:'non_bearing'}],
    rooms:[{id:'r1', name:'X', polygon:[[0,0],[10,0],[10,10],[0,10]], matId:'custom-mat'}],
    materials:{'custom-mat':{name:'自定义', price:99, sw:'#123456'}},
  }), 't.json');
  assert.equal(r.ok, true);
  assert.equal(r.model.materials['custom-mat'].price, 99);
  assert.equal(r.model.rooms[0].matId, 'custom-mat');
  const r2 = FPCore.importFromText(JSON.stringify({
    schemaVersion:'floorplan.standard/1', metadata:{units:'mm'},
    walls:[{id:'w1', rect:[0,0,100,100], bearing:'non_bearing'}],
    rooms:[{id:'r1', name:'X', polygon:[[0,0],[10,0],[10,10],[0,10]], matId:'nope'}],
  }), 't.json');
  assert.equal(r2.ok, true);
  assert.ok(r2.warnings.some(w => w.code === 'unknown_mat'));
  assert.equal(r2.model.rooms[0].matId, 'wood');   // 回退，不悬空
});

/* ======================= 6. Validator：错误（拒绝导入） ======================= */
test('窗框分格：导入导出保留比例和样式，且不改变窗洞', () => {
  const src = JSON.parse(twoRoom());
  src.windows[0].frame = {panelRatios:[1,3.75,3.75,1], width:30, depth:60, color:'#202020'};
  const original = structuredClone(src), r = FPCore.importFromText(JSON.stringify(src));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const out = FPCore.exportStandard(r.model);
  assert.deepEqual(out.windows[0].frame, original.windows[0].frame);
  assert.deepEqual(out.windows[0].rect, original.windows[0].rect);
  assert.deepEqual(src, original);
  out.windows[0].frame.panelRatios[0] = 99;
  assert.equal(r.model.windows[0].frame.panelRatios[0], 1);
});

test('窗框分格：两窄两宽，框料和玻璃都位于窗洞内，短边可整片', () => {
  const w = {rect:[0,0,6000,240], height:2200, frame:{panelRatios:[1,4,4,1], width:60}};
  const f = FPCore.windowFrameLayout(w);
  assert.equal(f.panels.length, 4);
  assert.equal(f.bars.length, 5);
  assert.equal(f.bars[0].start, 0);
  assert.equal(f.bars.at(-1).end, 6000);
  const widths = f.panels.map(p => p.end-p.start);
  assert.equal(widths[0], widths[3]);
  assert.equal(widths[1], widths[2]);
  assert.equal(widths[1], 4*widths[0]);
  const short = FPCore.windowFrameLayout({rect:[0,0,240,1500], frame:{panelRatios:[1], width:60}});
  assert.deepEqual(short.panels, [{start:60, end:1440}]);
  assert.equal(FPCore.windowFrameLayout({rect:[0,0,6000,240]}), null);
});

test('窗框分格：拒绝非法比例、颜色和挤占玻璃的框宽', () => {
  for (const frame of [null, [], {panelRatios:[]}, {panelRatios:[1,0]}, {panelRatios:[1,'2']},
    {panelRatios:Array(33).fill(1)}, {color:'red'}, {width:-1}, {depth:0}, {panelRatios:[1,1], width:10000}]){
    const src = JSON.parse(twoRoom()); src.windows[0].frame = frame;
    const r = FPCore.importFromText(JSON.stringify(src));
    assert.equal(r.ok, false, JSON.stringify(frame));
    assert.ok(r.errors.some(e => e.code === 'bad_window_frame'));
  }
});

test('错误：JSON 语法 / 未知格式 / 空墙体', () => {
  assert.equal(FPCore.importFromText('{oops', 'a.json').errors[0].code, 'bad_json');
  assert.equal(FPCore.importFromText('[]', 'a.json').errors[0].code, 'bad_json');
  assert.equal(FPCore.importFromText('{}', 'a.json').errors[0].code, 'unknown_format');
  const e = FPCore.importFromText(JSON.stringify({WALLS:[]}), 'a.json');
  assert.equal(e.ok, false);
  assert.equal(e.model, null);
  assert.equal(e.errors[0].code, 'no_walls');
});
test('错误：墙体矩形非法（负向 / 零面积 / 非数值）', () => {
  for (const rect of [[100,100,50,200], [0,0,0,100], [0,0,100,'x']]){
    const r = FPCore.importFromText(JSON.stringify({WALLS:[rect]}), 'a.json');
    assert.equal(r.ok, false, JSON.stringify(rect));
    assert.equal(r.errors[0].code, 'bad_wall');
  }
});
test('错误：房间多边形无效（<3 点 / 零面积 / 自相交）', () => {
  const mk = poly => JSON.stringify({
    schemaVersion:'floorplan.standard/1', metadata:{units:'mm'},
    walls:[{id:'w1', rect:[0,0,100,100], bearing:'non_bearing'}], rooms:[{id:'r1', polygon:poly}],
  });
  assert.equal(FPCore.importFromText(mk([[0,0],[1,1]]), 'a.json').errors[0].code, 'bad_poly');
  assert.equal(FPCore.importFromText(mk([[0,0],[10,0],[20,0]]), 'a.json').errors[0].code, 'bad_poly');   // 共线 → 零面积
  assert.equal(FPCore.importFromText(mk([[0,0],[100,100],[100,0],[0,100]]), 'a.json').errors[0].code, 'bad_poly');
});
test('错误：id 重复 / 非法枚举 / 未知单位', () => {
  const dup = FPCore.importFromText(JSON.stringify({
    schemaVersion:'floorplan.standard/1', metadata:{units:'mm'},
    walls:[{id:'w1', rect:[0,0,10,10], bearing:'non_bearing'}, {id:'w1', rect:[20,0,30,10], bearing:'non_bearing'}],
  }), 'a.json');
  assert.ok(dup.errors.some(e => e.code === 'dup_id'));
  const en = FPCore.importFromText(JSON.stringify({
    schemaVersion:'floorplan.standard/1', metadata:{units:'mm'},
    walls:[{id:'w1', rect:[0,0,10,10], kind:'weird'}],
  }), 'a.json');
  assert.ok(en.errors.some(e => e.code === 'bad_enum'));
  const un = FPCore.importFromText(JSON.stringify({
    schemaVersion:'floorplan.standard/1', metadata:{units:'cm'},
    walls:[{id:'w1', rect:[0,0,10,10]}],
  }), 'a.json');
  assert.ok(un.errors.some(e => e.code === 'bad_units'));
});

/* ======================= 7. Validator：警告（放行） ======================= */
test('警告：完全重复墙体不去重 / 悬浮门 / 铰点偏移 / 门宽异常', () => {
  const r = FPCore.importFromText(JSON.stringify({
    WALLS:[[0,0,100,100,'n'],[0,0,100,100,'n'],[500,500,600,700,'n']],
    DOORS:[{name:'悬浮门', rect:[900,900,1000,1800], h:[900,1800], c:[0,-1], o:[1,0], len:900},
           {name:'歪铰门', rect:[0,20,50,100], h:[10,20], c:[1,0], o:[0,1], len:80},
           {name:'宽异常', rect:[0,0,50,100], h:[0,100], c:[1,0], o:[0,-1], len:500}],
  }), 'a.json');
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => w.code === 'dup_wall'));
  assert.ok(r.warnings.some(w => w.code === 'floating'));
  assert.ok(r.warnings.some(w => w.code === 'hinge_off'));
  assert.ok(r.warnings.some(w => w.code === 'door_width'));
});
test('警告：BOUNDS 未包含几何', () => {
  const r = FPCore.importFromText(JSON.stringify({
    BOUNDS:{x:0, y:0, w:10, h:10},
    WALLS:[[0,0,100,100,'n']],
  }), 'a.json');
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => w.code === 'bounds_gap'));
});

/* ======================= 8. 拆墙权限 ======================= */
test('canDemolish / demolishBlockReason 矩阵', () => {
  const mk = (kind, bearing, envelope) => ({kind, bearing, envelope});
  assert.equal(FPCore.canDemolish(mk('interior','non_bearing',false)), true);
  assert.equal(FPCore.canDemolish(mk('interior','bearing',false)), false);
  assert.equal(FPCore.canDemolish(mk('interior','unknown',false)), false);
  assert.equal(FPCore.canDemolish(mk('exterior','non_bearing',false)), false);
  assert.equal(FPCore.canDemolish(mk('interior','non_bearing',true)), false);
  assert.equal(FPCore.canDemolish(mk('low','unknown',false)), false);
  assert.equal(FPCore.demolishBlockReason(mk('interior','bearing',false)), 'bearing_or_unknown');
  assert.equal(FPCore.demolishBlockReason(mk('exterior','non_bearing',false)), 'exterior');
  assert.equal(FPCore.demolishBlockReason(mk('interior','non_bearing',true)), 'envelope');
  assert.equal(FPCore.demolishBlockReason(mk('interior','non_bearing',false)), null);
  // 内置模型：可拆墙均为 non_bearing 内墙且非外围
  const m = FPCore.builtinModel();
  const can = m.walls.filter(w => FPCore.canDemolish(w));
  assert.ok(can.length > 0);
  can.forEach(w => { assert.equal(w.bearing, 'non_bearing'); assert.notEqual(w.kind, 'exterior'); assert.equal(w.envelope, false); });
});

/* ======================= 9. 导出与往返一致 ======================= */
test('exportStandard：内置户型导出→再导入几何一致', () => {
  const m = FPCore.builtinModel();
  const out = FPCore.exportStandard(m);
  assert.equal(out.schemaVersion, 'floorplan.standard/1');
  const r = FPCore.importFromText(JSON.stringify(out), 'roundtrip.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const g = r.model;
  assert.equal(g.walls.length, m.walls.length);
  g.walls.forEach((w, i) => assert.deepEqual(w.rect, m.walls[i].rect, `wall ${i}`));
  g.windows.forEach((w, i) => { assert.deepEqual(w.rect, m.windows[i].rect); assert.equal(w.sillHeight, m.windows[i].sillHeight); assert.equal(w.height, m.windows[i].height); });
  g.doors.forEach((d, i) => { assert.deepEqual(d.rect, m.doors[i].rect); assert.deepEqual(d.hinge, m.doors[i].hinge); assert.equal(d.swing, 'swing'); assert.equal(d.entry, m.doors[i].entry); });
  g.rooms.forEach((room, i) => assert.deepEqual(room.polygon, m.rooms[i].polygon, `room ${i}`));
  assert.equal(g.windows.find(w => w.group === 'bay1').kind, 'bay');
});
test('exportStandard：两室一厅导入→导出→再导入一致', () => {
  const r1 = FPCore.importFromText(twoRoom(), 'two-room-c.json');
  const out = FPCore.exportStandard(r1.model);
  const r2 = FPCore.importFromText(JSON.stringify(out), 'rt.json');
  assert.equal(r2.ok, true);
  r2.model.walls.forEach((w, i) => assert.deepEqual(w.rect, r1.model.walls[i].rect));
  r2.model.doors.forEach((d, i) => assert.deepEqual(d.hinge, r1.model.doors[i].hinge));
});

/* ======================= 10. 标签点推导 ======================= */
test('roomLabelAt：矩形取质心；凹形取内部点', () => {
  const sq = [[0,0],[100,0],[100,100],[0,100]];
  assert.deepEqual(FPCore.roomLabelAt(sq), [50, 50]);
  const u = [[0,0],[300,0],[300,300],[200,300],[200,100],[100,100],[100,300],[0,300]];   // U 形，质心在空洞外
  const at = FPCore.roomLabelAt(u);
  assert.ok(at, '应返回内部点');
  // 点在多边形内的独立校验
  let inside = false;
  for (let i = 0, j = u.length - 1; i < u.length; j = i++){
    if ((u[i][1] > at[1]) !== (u[j][1] > at[1]) && at[0] < (u[j][0]-u[i][0])*(at[1]-u[i][1])/(u[j][1]-u[i][1]) + u[i][0]) inside = !inside;
  }
  assert.ok(inside, '标签点应落在多边形内');
});

/* ======================= 11. 真实户型回归（隐私文件，缺席时跳过） ======================= */
test('真实户型（格式 B）：导入 / 数量 / 铁律', {skip: !HAS_PRIV && '隐私样例不在本地'}, () => {
  const j = privJSON();
  const r = FPCore.importFromText(JSON.stringify(j), '最终改图_v13_原生字段.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const m = r.model;
  assert.equal(m.walls.length, 66);
  assert.equal(m.windows.length, 11);
  assert.equal(m.doors.length, 7);
  assert.equal(m.slides.length, 0);
  assert.equal(m.rooms.length, 9);
  assert.equal(m.meta.source.format, 'B');
  // 铁律：几何逐坐标保留
  m.walls.forEach((w, i) => assert.deepEqual(w.rect, j.WALLS[i].slice(0,4), `wall ${i}`));
  m.windows.forEach((w, i) => assert.deepEqual(w.rect, j.WINDOWS[i]));
  m.doors.forEach((d, i) => assert.deepEqual(d.rect, j.DOORS[i].rect));
  // 结构
  assert.equal(m.doors.filter(d => d.swing === 'swing').length, 7);
  assert.equal(m.doors.find(d => d.entry).name, '入户门');
  m.rooms.forEach(room => assert.ok(room.labelAt, `房间 ${room.name} 有标签点`));
  assert.equal(m.meta.declaredBounds.x, j.BOUNDS.x);
  // 承重保护：存在承重墙且不可拆
  const bearing = m.walls.filter(w => w.bearing === 'bearing');
  assert.ok(bearing.length > 0);
  bearing.forEach(w => assert.equal(FPCore.canDemolish(w), false));
  // 可拆墙存在（内墙 n）
  assert.ok(m.walls.some(w => FPCore.canDemolish(w)));
  // 往返：导出→再导入一致
  const rt = FPCore.importFromText(JSON.stringify(FPCore.exportStandard(m)), 'rt.json');
  assert.equal(rt.ok, true, JSON.stringify(rt.errors));
  rt.model.walls.forEach((w, i) => assert.deepEqual(w.rect, m.walls[i].rect));
});
test('真实户型（格式 B）：自动尺寸链为外包两条', {skip: !HAS_PRIV && '隐私样例不在本地'}, () => {
  const r = FPCore.importFromText(JSON.stringify(privJSON()), 'a.json');
  assert.equal(r.model.dims, null);   // 导入户型 dims 为空 → 渲染层自动生成两条
});
test('用户 V15 重绘图（格式 B）：导入 / 铰点偏移告警 / 空窗列表', {skip: !existsSync(new URL('../samples/最终改图_V15_独立重绘_原生字段.json', import.meta.url)) && 'V15 样例不在本地'}, () => {
  const j = JSON.parse(readFileSync(new URL('../samples/最终改图_V15_独立重绘_原生字段.json', import.meta.url), 'utf8'));
  const r = FPCore.importFromText(JSON.stringify(j), 'V15.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.model.walls.length, 48);
  assert.equal(r.model.windows.length, j.WINS.length);   // WINS 旧键名 → 正常识别
  assert.equal(r.model.doors.length, 6);
  assert.equal(r.model.rooms.length, 9);
  // 入户门铰点在洞口长边中部（非角点）→ 触发铰点偏移警告，几何原样保留
  assert.ok(r.warnings.some(w => w.code === 'hinge_off'), JSON.stringify(r.warnings));
  const entry = r.model.doors.find(d => d.entry);
  assert.deepEqual(entry.rect, j.DOORS.find(d => d.entry).rect);
  assert.equal(entry.swing, 'swing');
  // 承重保护照常
  r.model.walls.forEach(w => { if (w.bearing === 'bearing') assert.equal(FPCore.canDemolish(w), false); });
});

/* ======================= 12. API 形状 ======================= */
test('importFromText 返回形状 / registry 可扩展', () => {
  const r = FPCore.importFromText(twoRoom(), 'a.json');
  for (const k of ['ok','model','errors','warnings','defaults']) assert.ok(k in r, k);
  assert.deepEqual(r.errors, []);
  const before = FPCore.registry.length;
  FPCore.registry.unshift({id:'X', detect: j => j.__x, adapt: () => ({model:FPCore.blankModel(), errors:[], warnings:[], defaults:[]})});
  assert.equal(FPCore.detectFormat({__x:1}), 'X');
  FPCore.registry.shift();
  assert.equal(FPCore.registry.length, before);
});
test('blankModel：骨架字段齐全', () => {
  const m = FPCore.blankModel();
  assert.equal(m.version, 'fp.model/1');
  assert.equal(m.meta.coordinateSystem, 'top-left-inner-y-down');
  for (const k of ['walls','windows','doors','slides','rooms','furniture','defaults']) assert.deepEqual(m[k], []);
  assert.equal(m.dims, null);
});
