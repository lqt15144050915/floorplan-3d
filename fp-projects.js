/* 完整装修方案与本地方案库。无 DOM 依赖，浏览器与 Node 共用。 */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./fp-core.js'),require('./fp-electrical.js'));
  else root.FPProjects=factory(root.FPCore,root.FPElectrical);
})(typeof self!=='undefined'?self:this,function(FPCore,Electrical){
  'use strict';
  const KEY='huxing-project-library-v1',SCHEMA='floorplan.project/1',LIBRARY='floorplan.library/1',MAX_VERSIONS=10;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const uid=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const now=()=>new Date().toISOString();
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=message=>{throw new Error(message);};
  const nameOf=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,80):fail('请填写方案名称');
  function validateSnapshot(snapshot){
    if(!object(snapshot)||!object(snapshot.model)||snapshot.model.version!==FPCore.MODEL_VERSION) fail('完整方案缺少有效户型');
    const m=snapshot.model,s=snapshot.state;
    if(!object(m.meta)||!object(m.materials)||!m.bounds||!['x','y','w','h'].every(k=>Number.isFinite(m.bounds[k]))||m.bounds.w<=0||m.bounds.h<=0||!['walls','windows','doors','slides','rooms'].every(k=>Array.isArray(m[k]))) fail('户型数据不完整');
    let result;
    try{result=FPCore.importFromText(JSON.stringify(FPCore.exportStandard(m)));}catch(e){fail('户型结构无法读取');}
    if(!result.ok) fail('户型校验失败：'+result.errors.map(e=>e.message).slice(0,2).join('；'));
    if(!object(s)||!Array.isArray(s.furniture)) fail('方案布置数据不完整');
    const ids=new Set();
    for(const f of s.furniture){
      if(!object(f)||typeof f.id!=='string'||!f.id||/[<>"'&\s]/.test(f.id)||ids.has(f.id)||typeof f.type!=='string'||typeof f.name!=='string'||typeof f.color!=='string'||!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(f.color)||
        !['cx','cy','w','d','rot'].every(k=>Number.isFinite(f[k]))||f.w<=0||f.d<=0) fail('家具数据含非法尺寸、位置或重复编号');
      ids.add(f.id);
    }
    if(s.rooms!==undefined&&!object(s.rooms)) fail('房间设置格式错误');
    if(s.rooms&&Object.values(s.rooms).some(r=>!object(r)||(r.name!==undefined&&typeof r.name!=='string')||(r.mat!==undefined&&typeof r.mat!=='string'))) fail('房间名称或材质格式错误');
    if(s.demolished!==undefined&&(!Array.isArray(s.demolished)||s.demolished.some(id=>typeof id!=='string'))) fail('拆墙记录格式错误');
    if(s.measures!==undefined&&(!Array.isArray(s.measures)||s.measures.some(v=>!object(v)||!['a','b'].every(k=>object(v[k])&&Number.isFinite(v[k].x)&&Number.isFinite(v[k].y))))) fail('测量记录格式错误');
    if(s.electrical!==undefined) Electrical.validate(s.electrical);
    // 通过标准格式校验几何，但保留原模型和全部未来装修字段，绝不以转换产物替换原数据。
    return snapshot;
  }
  function checkpoint(p,label){
    const last=p.versions[p.versions.length-1];
    if(last&&JSON.stringify([last.model,last.state])===JSON.stringify([p.model,p.state])) return;
    p.versions.push({id:uid(),createdAt:now(),label,model:clone(p.model),state:clone(p.state)});
    p.versions=p.versions.slice(-MAX_VERSIONS);
  }
  function create(name,snapshot){
    validateSnapshot(snapshot);const time=now();
    const p={id:uid(),name:nameOf(name),createdAt:time,updatedAt:time,archivedAt:null,model:clone(snapshot.model),state:clone(snapshot.state),versions:[]};
    checkpoint(p,'初始版本');return p;
  }
  function validateProject(p){
    if(!object(p)||typeof p.id!=='string'||!p.id) fail('方案编号错误');
    const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
    if(!date(p.createdAt)||!date(p.updatedAt)||(p.archivedAt!==null&&!date(p.archivedAt))) fail('方案时间记录错误');
    nameOf(p.name);validateSnapshot(p);
    if(!Array.isArray(p.versions)||p.versions.length>MAX_VERSIONS) fail('历史版本格式错误');
    const ids=new Set();
    p.versions.forEach(v=>{if(!object(v)||typeof v.id!=='string'||ids.has(v.id)||!date(v.createdAt)||typeof v.label!=='string') fail('历史版本记录错误');ids.add(v.id);validateSnapshot(v);});
    return p;
  }
  function decode(text,context){
    let value;try{value=JSON.parse(text);}catch(e){fail('不是有效的 JSON 文件');}
    if(value?.schemaVersion===SCHEMA){
      validateProject(value.project);return {project:clone(value.project),kind:'complete'};
    }
    if(value?.schemaVersion) fail('不支持的方案文件版本');
    if(value?.model&&value?.state){
      return {project:create(context?.name||'导入的方案',value),kind:'legacy-complete'};
    }
    if(Array.isArray(value?.furniture)&&context?.model){
      return {project:create(context.name||'导入的旧方案',{model:context.model,state:value}),kind:'legacy-state'};
    }
    fail('文件不包含完整方案或旧版布置，请用“导入户型 JSON”打开户型文件');
  }
  function encode(project){validateProject(project);return JSON.stringify({schemaVersion:SCHEMA,exportedAt:now(),project},null,2);}
  class Library{
    constructor(storage){
      this.storage=storage;this.data={schemaVersion:LIBRARY,activeId:null,projects:[]};this.loadError=null;this.serialized=null;
      try{
        const text=storage.getItem(KEY);
        if(text!==null){
          const data=JSON.parse(text);
          if(data.schemaVersion!==LIBRARY||!Array.isArray(data.projects)) fail('方案库格式不受支持');
          const ids=new Set();data.projects.forEach(p=>{validateProject(p);if(ids.has(p.id))fail('方案库编号重复');ids.add(p.id);});
          if(data.projects.length&&!data.projects.some(p=>p.id===data.activeId&&!p.archivedAt)) fail('当前方案索引无效');
          this.data=data;this.serialized=text;
        }
      }catch(e){this.loadError=new Error('本地方案库无法读取，原存档已保留：'+e.message);}
    }
    active(){return clone(this.data.projects.find(p=>p.id===this.data.activeId)||null);}
    list(archived=false){return clone(this.data.projects.filter(p=>!!p.archivedAt===archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}
    transact(fn){
      if(this.loadError) throw this.loadError;
      const next=clone(this.data),result=fn(next);
      let previous;try{previous=this.storage.getItem(KEY);}catch(e){fail('浏览器存储不可用，请导出完整方案备份');}
      if(previous!==this.serialized) fail('方案库已在其他窗口更新，请导出当前方案备份后刷新');
      const serialized=JSON.stringify(next);
      try{this.storage.setItem(KEY,serialized);}catch(e){fail('保存失败：浏览器空间不足或存储不可用，请导出完整方案备份');}
      this.data=next;this.serialized=serialized;return clone(result??null);
    }
    uniqueName(data,name){
      const base=nameOf(name);let result=base,n=2;
      while(data.projects.some(p=>!p.archivedAt&&p.name===result)){result=base.slice(0,70)+' ('+n+')';n++;}
      return result;
    }
    add(name,snapshot){
      return this.transact(data=>{const p=create(this.uniqueName(data,name),snapshot);data.projects.push(p);data.activeId=p.id;return p;});
    }
    bootstrap(name,snapshot){return this.active()||this.add(name,snapshot);}
    save(snapshot,{checkpoint:keep=false,label='手动保存'}={}){
      validateSnapshot(snapshot);
      return this.transact(data=>{
        const p=data.projects.find(p=>p.id===data.activeId&&!p.archivedAt);if(!p) fail('没有当前方案');
        const changed=JSON.stringify([p.model,p.state])!==JSON.stringify([snapshot.model,snapshot.state]);
        p.model=clone(snapshot.model);p.state=clone(snapshot.state);if(changed)p.updatedAt=now();
        if(keep) checkpoint(p,label);return p;
      });
    }
    activate(id){return this.transact(data=>{const p=data.projects.find(p=>p.id===id&&!p.archivedAt);if(!p)fail('方案不存在');data.activeId=id;return p;});}
    rename(id,name){return this.transact(data=>{const p=data.projects.find(p=>p.id===id);if(!p)fail('方案不存在');const clean=nameOf(name);if(data.projects.some(v=>v.id!==id&&!v.archivedAt&&v.name===clean))fail('已存在同名方案');p.name=clean;p.updatedAt=now();return p;});}
    importProject(project){validateProject(project);return this.transact(data=>{const p=create(this.uniqueName(data,project.name),project);p.versions=clone(project.versions);checkpoint(p,'导入版本');data.projects.push(p);data.activeId=p.id;return p;});}
    restore(id,versionId){
      return this.transact(data=>{
        const p=data.projects.find(p=>p.id===id&&!p.archivedAt),v=p?.versions.find(v=>v.id===versionId);if(!v)fail('历史版本不存在');
        const target=clone(v);checkpoint(p,'恢复前备份');p.model=target.model;p.state=target.state;p.updatedAt=now();checkpoint(p,'恢复历史版本');data.activeId=p.id;return p;
      });
    }
    archive(id){return this.transact(data=>{const live=data.projects.filter(p=>!p.archivedAt);if(live.length<=1)fail('至少保留一个使用中的方案');const p=live.find(p=>p.id===id);if(!p)fail('方案不存在');p.archivedAt=now();if(data.activeId===id)data.activeId=live.find(v=>v.id!==id).id;return data.projects.find(v=>v.id===data.activeId);});}
    recover(id){return this.transact(data=>{const p=data.projects.find(p=>p.id===id&&p.archivedAt);if(!p)fail('回收站中没有该方案');p.name=this.uniqueName(data,p.name);p.archivedAt=null;p.updatedAt=now();return p;});}
  }
  return {KEY,SCHEMA,LIBRARY,MAX_VERSIONS,Library,create,decode,encode,validateSnapshot};
});
