import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),P=require('../fp-projects.js'),F=require('../fp-core.js');
const model=()=>F.importFromText(readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8')).model;
const snapshot=()=>({model:model(),state:{furniture:[],rooms:{R05:{name:'主卧室',mat:'tile800',future:{curtain:'double'}}},demolished:[],measures:[],decoration:{electrical:[{x:1,y:2,z:1200}],lighting:{temperature:3000}}}});
class MemoryStorage{
  constructor(){this.values=new Map();this.fail=false;}
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){if(this.fail)throw new Error('quota');this.values.set(key,value);}
}
test('完整方案：导出再导入保留每个几何坐标、布置、未来装修字段及历史版本',()=>{
  const original=snapshot(),p=P.create('方案 A',original),before=JSON.stringify(original);
  const decoded=P.decode(P.encode(p));
  assert.equal(decoded.kind,'complete');assert.deepEqual(decoded.project,p);
  assert.deepEqual(decoded.project.model.walls,original.model.walls);
  assert.deepEqual(decoded.project.state.decoration,original.state.decoration);
  assert.equal(JSON.stringify(original),before);
  decoded.project.state.decoration.lighting.temperature=4000;
  assert.equal(p.state.decoration.lighting.temperature,3000);
});
test('迁移：保留旧存档键，初始化仅一次，重开后恢复最近使用方案',()=>{
  const storage=new MemoryStorage(),old=JSON.stringify(snapshot());storage.setItem('huxing-design-v2',old);
  const lib=new P.Library(storage),first=lib.bootstrap('当前方案',snapshot());
  lib.bootstrap('不得重复',snapshot());assert.equal(lib.list().length,1);
  const second=lib.add('方案B',snapshot());
  assert.equal(new P.Library(storage).active().id,second.id);
  lib.activate(first.id);assert.equal(new P.Library(storage).active().id,first.id);
  assert.equal(storage.getItem('huxing-design-v2'),old);
});
test('多方案：复制、命名、切换与内容相互独立',()=>{
  const lib=new P.Library(new MemoryStorage()),one=lib.add('方案',snapshot()),two=lib.add('方案',one);
  assert.equal(two.name,'方案 (2)');
  two.state.rooms.R05.name='方案B主卧';lib.save(two);
  lib.activate(one.id);assert.equal(lib.active().state.rooms.R05.name,'主卧室');
  lib.rename(two.id,'方案 B');assert.equal(lib.list().find(p=>p.id===two.id).name,'方案 B');
  assert.throws(()=>lib.rename(two.id,'方案'),/同名/);
  assert.throws(()=>lib.add('  ',snapshot()),/名称/);
});
test('版本：普通自动保存不堆积历史，手动检查点可恢复，并保留恢复前内容',()=>{
  const lib=new P.Library(new MemoryStorage());lib.add('A',snapshot());
  const initial=lib.active().versions[0].id,edited=lib.active();edited.state.rooms.R05.name='修改后的主卧';
  lib.save(edited);assert.equal(lib.active().versions.length,1);
  lib.save(edited,{checkpoint:true});assert.equal(lib.active().versions.length,2);
  lib.save(edited,{checkpoint:true});assert.equal(lib.active().versions.length,2,'相同内容不重复建版本');
  lib.restore(lib.active().id,initial);
  assert.equal(lib.active().state.rooms.R05.name,'主卧室');
  assert.ok(lib.active().versions.some(v=>v.state.rooms.R05.name==='修改后的主卧'));
  for(let i=0;i<15;i++){const s=lib.active();s.state.rooms.R05.name='第'+i+'次';lib.save(s,{checkpoint:true});}
  assert.equal(lib.active().versions.length,P.MAX_VERSIONS);
});
test('完整导入：同编号不覆盖已有方案，保留文件中的版本历史',()=>{
  const lib=new P.Library(new MemoryStorage());const first=lib.add('原方案',snapshot()),edit=lib.active();
  edit.state.rooms.R05.name='新版';lib.save(edit,{checkpoint:true});const exported=lib.active();
  const imported=lib.importProject(P.decode(P.encode(exported)).project);
  assert.notEqual(imported.id,first.id);assert.equal(lib.list().length,2);
  assert.deepEqual(imported.versions,exported.versions);
  assert.equal(lib.list().find(p=>p.id===first.id).state.rooms.R05.name,'新版');
});
test('兼容：旧版布置配对当前户型，旧版模型加布置包完整导入',()=>{
  const s=snapshot();
  const old=P.decode(JSON.stringify(s.state),{model:s.model,name:'旧方案'});
  assert.equal(old.kind,'legacy-state');assert.deepEqual(old.project.model,s.model);assert.deepEqual(old.project.state,s.state);
  assert.equal(P.decode(JSON.stringify(s),{name:'v2'}).kind,'legacy-complete');
  assert.throws(()=>P.decode(JSON.stringify(s.state)),/不包含/);
});
test('回收站：移出当前方案后切换，重开可恢复，不能移走最后一个方案',()=>{
  const storage=new MemoryStorage(),lib=new P.Library(storage),one=lib.add('A',snapshot()),two=lib.add('B',snapshot());
  lib.archive(two.id);assert.equal(lib.active().id,one.id);
  assert.equal(lib.list(true)[0].id,two.id);assert.throws(()=>lib.archive(one.id),/至少保留/);
  const reopened=new P.Library(storage);reopened.recover(two.id);assert.equal(reopened.list().length,2);
  assert.deepEqual(reopened.list().find(p=>p.id===two.id).state,two.state);
});
test('保存失败：配额错误不损坏旧方案库，不改变当前索引，不吞掉错误',()=>{
  const storage=new MemoryStorage(),lib=new P.Library(storage),one=lib.add('A',snapshot());
  const disk=storage.getItem(P.KEY);storage.fail=true;
  assert.throws(()=>lib.add('B',snapshot()),/保存失败/);assert.equal(storage.getItem(P.KEY),disk);assert.equal(lib.active().id,one.id);
  const edit=lib.active();edit.state.rooms.R05.name='不能持久化';
  assert.throws(()=>lib.save(edit),/保存失败/);assert.equal(lib.active().state.rooms.R05.name,'主卧室');
  assert.equal(P.decode(P.encode({...one,state:edit.state})).project.state.rooms.R05.name,'不能持久化','存储不可用时仍能生成完整备份');
});
test('损坏/未来版本：禁止静默覆盖无法读取的本地库',()=>{
  for(const text of ['{broken',JSON.stringify({schemaVersion:'floorplan.library/99',projects:[]})]){
    const storage=new MemoryStorage();storage.setItem(P.KEY,text);const lib=new P.Library(storage);
    assert.ok(lib.loadError);assert.throws(()=>lib.bootstrap('A',snapshot()),/无法读取/);assert.equal(storage.getItem(P.KEY),text);
  }
});
test('多窗口：陈旧页面不能把其他窗口新增的方案覆盖掉',()=>{
  const storage=new MemoryStorage(),first=new P.Library(storage);first.add('A',snapshot());
  const second=new P.Library(storage);second.add('B',snapshot());const disk=storage.getItem(P.KEY);
  assert.throws(()=>first.save(first.active()),/其他窗口更新/);
  assert.equal(storage.getItem(P.KEY),disk);assert.equal(new P.Library(storage).list().length,2);
});
test('导入校验：拒绝非法户型、非有限位置、重复家具编号及未知格式',()=>{
  const bad=snapshot();bad.model.walls[0].rect[2]=bad.model.walls[0].rect[0];assert.throws(()=>P.create('bad',bad),/校验失败/);
  const invalid=snapshot();invalid.state.furniture=[{id:'x',type:'bed',name:'床',color:'#fff',cx:Infinity,cy:1,w:1000,d:2000,rot:0}];
  assert.throws(()=>P.create('bad',invalid),/家具数据/);
  const duplicate=snapshot(),f={id:'x',type:'bed',name:'床',color:'#fff',cx:1,cy:1,w:1000,d:2000,rot:0};duplicate.state.furniture=[f,{...f}];
  assert.throws(()=>P.create('bad',duplicate),/家具数据/);
  const invalidColor=snapshot();invalidColor.state.furniture=[{...f,color:'red" onclick="bad'}];assert.throws(()=>P.create('bad',invalidColor),/家具数据/);
  const invalidId=snapshot();invalidId.state.furniture=[{...f,id:'bad" id'}];assert.throws(()=>P.create('bad',invalidId),/家具数据/);
  assert.throws(()=>P.decode('{'),/有效/);assert.throws(()=>P.decode('{"schemaVersion":"floorplan.project/99"}'),/不支持/);
});
