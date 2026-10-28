import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),Core=require('../fp-core.js'),E=require('../fp-electrical.js'),P=require('../fp-projects.js');
const model=()=>Core.importFromText(readFileSync(new URL('../samples/我的改图_阳台大玻璃.json',import.meta.url),'utf8')).model;
const fixture=()=>{const m=model(),fs=E.faces(m),f=fs.find(f=>f.wallId==='w25');return {m,fs,f,p:E.place('socket5',f,f.a[f.axis]+800,{id:'p1'})};};
test('点位：沿净墙面绑定，墙柱相交和墙厚不进入量取区间',()=>{
  const {m,fs}=fixture(),f=fs.find(f=>f.wallId==='w6');assert.equal(f.value,336);assert.deepEqual(f.a,[6637,5]);
  const p=E.place('socket5',f,6800,{id:'one'}),g=E.geometry(p,fs);assert.equal(g.ok,true);assert.equal(g.y,5);assert.equal(g.offset,163);
  assert.equal(E.geometry({...p,along:6600},fs).ok,false);assert.equal(JSON.stringify(m),JSON.stringify(model()));
});
test('点位：短墙拒绝面板越界，联排宽度和竖排高度一起计入边界',()=>{
  const {fs,p}=fixture(),short=fs.find(f=>f.wallId==='w12');assert.equal(E.geometry(E.place('socket5',short,short.a[short.axis]+23),fs).ok,false);
  assert.deepEqual(E.size({...p,count:3}),{width:278,height:86});assert.deepEqual(E.size({...p,count:3,layout:'vertical'}),{width:86,height:278});
  assert.equal(E.geometry({...p,along:fs.find(f=>f.wallId==='w25').a[1]+42},fs).ok,false);
});
test('点位：完成地面、窗台下实墙和顶高限制，不在玻璃上布置',()=>{
  const {m,fs,p}=fixture();assert.equal(E.geometry({...p,height:20},fs).ok,false);assert.equal(E.geometry({...p,height:2800},fs).ok,false);
  const f=fs.find(f=>f.wallId==='window:win4'),point=E.place('socket5',f,f.a[f.axis]+500);
  assert.equal(E.geometry(point,fs).ok,true);assert.equal(E.geometry({...point,height:900},fs).ok,false);
  const elevated={...f,floor:150};const g=E.geometry(point,[elevated]);assert.equal(g.z,450);
  assert.ok(m.windows.find(w=>w.id==='win4').sillHeight===900);
});
test('点位：面板碰撞按同侧共面检测，背面房间互不干扰',()=>{
  const {fs,p}=fixture();assert.equal(E.check({...p,id:'p2',along:p.along+70},fs,[p]).ok,false);
  assert.equal(E.check({...p,id:'p2',along:p.along+100},fs,[p]).ok,true);assert.equal(E.check({...p,id:'p2',height:500},fs,[p]).ok,true);
  const front=fs.find(f=>f.wallId==='w35'&&f.roomId==='R01'),back=fs.find(f=>f.wallId==='w35'&&f.roomId==='R05');
  const a=E.place('socket5',front,front.a[front.axis]+300,{id:'a'}),b=E.place('socket5',back,back.a[back.axis]+300,{id:'b'});
  assert.equal(E.check(b,fs,[a]).ok,true);
});
test('点位：删除宿主后保留数据并报告失效，重新贴墙保留规格但更新绑定和位置',()=>{
  const {m,fs,p}=fixture(),before=JSON.stringify(p),gone=E.faces(m,['w25']);assert.equal(E.geometry(p,gone).ok,false);assert.equal(JSON.stringify(p),before);
  const f=fs.find(f=>f.wallId==='w26'),moved=E.place(p.type,f,f.a[f.axis]+500,p);
  assert.equal(moved.wallId,'w26');assert.equal(moved.along,Math.round((f.a[f.axis]+500)/10)*10);assert.equal(moved.height,300);assert.equal(E.geometry(moved,fs).ok,true);
});
test('点位：非法类型、法线、数量、颜色和重复编号不能进入存档',()=>{
  const {p}=fixture();for(const changes of [{type:'unknown'},{normal:[0,0]},{normal:[.5,.5]},{count:0},{count:2.5},{height:NaN},{color:'red'},{gap:-1},{layout:'diagonal'}])assert.throws(()=>E.validate([{...p,...changes}]));
  assert.throws(()=>E.validate([p,p]));assert.doesNotThrow(()=>E.validate([p]));
});
test('点位：方案导出、版本恢复和旧方案兼容，不丢失未知装修字段',()=>{
  const {m,p}=fixture(),state={furniture:[],rooms:{},demolished:[],measures:[],electrical:[p],lights:{future:true}},project=P.create('点位方案',{model:m,state});
  const decoded=P.decode(P.encode(project));assert.deepEqual(decoded.project.state,state);
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},library=new P.Library(storage);
  const current=library.bootstrap('点位方案',{model:m,state}),version=current.versions[0].id;
  library.save({model:m,state:{...state,electrical:[{...p,height:800}]}},{checkpoint:true});
  assert.equal(library.restore(current.id,version).state.electrical[0].height,300);
  assert.deepEqual(new P.Library(storage).active().state,state);
  assert.throws(()=>P.create('坏点位',{model:m,state:{...state,electrical:[{...p,height:Infinity}]}}));
  assert.doesNotThrow(()=>P.create('旧方案',{model:m,state:{furniture:[]}}));
});
