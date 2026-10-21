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

const nativeOf = (model) => ({   // 由模型反造原生格式（用于铁律测试）
  NAME: model.meta.name, BOUNDS: model.meta.declaredBounds,
  WALLS: model.walls.map(w => [...w.rect, w.bearing === 'bearing' ? 'b' : w.kind === 'exterior' ? 'e' : w.kind === 'low' ? 'low' : 'n']),
  WINDOWS: model.windows.map(w => w.rect),
  DOORS: model.doors.map(d => ({name:d.name, rect:d.rect, h:d.hinge, c:d.closeDir, o:d.openDir, len:d.width, ...(d.entry ? {entry:true} : {})})),
  SLIDES: model.slides.map(s => ({rect:s.rect, v:s.vertical})),
  ROOMS: model.rooms.map(r => ({id:r.id, name:r.name, poly:r.polygon, mat:r.matId, ...(r.labelAt ? {at:r.labelAt} : {}), ...(r.counted ? {} : {counted:false})})),
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
