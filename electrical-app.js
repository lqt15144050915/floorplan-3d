/* 点位编辑器，复用主应用的撤销栈、房间净轮廓与完整方案保存。 */
const electricalEditor={active:false,placing:null,lastType:'socket5',height:300,count:1,layout:'horizontal',gap:10,color:'#ffffff',drag:null,faceKey:'',faces:[]};
const getElectrical=id=>(state.electrical||[]).find(p=>p.id===id);
function electricalFaces(){
  const key=JSON.stringify([modelRev,modelKey(planModel),state.demolished]);
  if(electricalEditor.faceKey!==key){electricalEditor.faceKey=key;electricalEditor.faces=FPElectrical.faces(planModel,state.demolished);}
  return electricalEditor.faces;
}
function electricalRoom(id){return state.rooms[id]?.name||id;}
function electricalFaceName(f){return `${electricalRoom(f.roomId)} · ${f.wallId} · 朝${f.normal[0]>0?'右':f.normal[0]<0?'左':f.normal[1]>0?'下':'上'} · ${Math.round(f.value)} mm`;}
function electricalOptions(){const e=electricalEditor;return {height:e.height,count:e.count,layout:e.layout,gap:e.gap,color:e.color};}
function setElectricalTab(on){
  electricalEditor.active=on;electricalEditor.placing=null;electricalEditor.reattach=null;document.body.classList.toggle('electrical',on);
  document.querySelectorAll('#sceneTabs [data-scene]').forEach(b=>{const yes=(b.dataset.scene==='electrical')===on;b.classList.toggle('on',yes);b.setAttribute('aria-selected',yes);});
  if(on)setTool('select');select(null);renderAll();window.View3D?.electricalMode();
  if(on)drawer('lib',true);
}
function startElectrical(type){
  const e=electricalEditor;e.reattach=null;e.placing=type;e.lastType=type;e.height=FPElectrical.catalog[type].height;
  select(null);renderElectricalLibrary();window.View3D?.electricalMode();closeDrawers();
}
function renderElectricalLibrary(){
  const root=$('#electricalLib'),e=electricalEditor;root.hidden=!e.active;
  document.querySelectorAll('#sceneTabs [data-scene]').forEach(b=>b.onclick=()=>setElectricalTab(b.dataset.scene==='electrical'));
  const notice=$('#electricalNotice');notice.hidden=!e.active;
  if(!e.active)return;
  notice.innerHTML=e.placing?`<span>放置${FPElectrical.catalog[e.placing].name} · 离地 ${e.height} mm · 点击实墙面</span><button class="btn" id="epFinish">取消</button>`
    :'<span>水电点位 · 点面板选中，拖动沿墙调整</span><button class="btn" id="epChoose">添加点位</button>';
  if($('#epFinish'))$('#epFinish').onclick=()=>{e.placing=null;e.reattach=null;renderElectricalLibrary();window.View3D?.electricalMode();};
  if($('#epChoose'))$('#epChoose').onclick=()=>drawer('lib',true);
  const fs=electricalFaces(),points=state.electrical||[];
  root.innerHTML=`<h4>插座 / 开关</h4><div class="ep-catalog">${Object.entries(FPElectrical.catalog).map(([type,c])=>`<button type="button" data-ep-type="${type}" class="${e.placing===type?'on':''}" aria-pressed="${e.placing===type}"><i class="ep-icon">${c.symbol}</i><span>${c.name}</span></button>`).join('')}</div>
    <div class="hint">选择类型，再点 2D 墙边或 3D 实墙面。面板按 86 × 86 mm 绘制，离地高度可改。<div class="actions"><button class="btn" id="epPrecise">精确布置</button></div></div>
    <h4>已布置点位 · ${points.length} 组 / ${points.reduce((a,p)=>a+p.count,0)} 个面板</h4><div class="ep-list">${points.map((p,i)=>{const g=FPElectrical.check(p,fs,points);return `<button class="ep-row ${ui.sel?.id===p.id?'on':''}" data-ep-select="${esc(p.id)}"><i class="ep-icon">${g.ok?i+1:'!'}</i><span>${esc(p.name)}${p.count>1?' ×'+p.count:''}<small>${esc(electricalRoom(p.roomId))} · 中心离地 ${p.height} mm${g.ok?'':' · 待调整'}</small></span></button>`;}).join('')||'<div class="ep-help">还没有点位，选择上方类型开始布置。</div>'}</div>`;
  root.querySelectorAll('[data-ep-type]').forEach(b=>b.onclick=()=>startElectrical(b.dataset.epType));
  root.querySelectorAll('[data-ep-select]').forEach(b=>b.onclick=()=>{select({kind:'electrical',id:b.dataset.epSelect});closeDrawers();window.View3D?.focusElectrical(b.dataset.epSelect);});
  $('#epPrecise').onclick=()=>{e.placing=null;select(null);drawer('panel',true);};
}
function electricalFormFields(p,g){
  return `<label class="full">点位名称<input name="name" value="${esc(p.name)}" maxlength="120" required></label>
    <label>类型<select name="type">${Object.entries(FPElectrical.catalog).map(([k,c])=>`<option value="${k}" ${k===p.type?'selected':''}>${c.name}</option>`).join('')}</select></label>
    <label>中心离地 (mm)<input name="height" type="number" min="0" step="1" value="${p.height}" required></label>
    <label class="full">中心距墙段起点 (mm)<input name="offset" type="number" step="1" value="${Math.round(g.offset??0)}" required></label>
    <label>联排数量<select name="count">${[1,2,3,4].map(n=>`<option ${n===p.count?'selected':''}>${n}</option>`).join('')}</select></label>
    <label>排列方向<select name="layout"><option value="horizontal" ${p.layout==='horizontal'?'selected':''}>横排</option><option value="vertical" ${p.layout==='vertical'?'selected':''}>竖排</option></select></label>
    <label>面板间距 (mm)<input name="gap" type="number" min="0" max="100" value="${p.gap}" required></label>
    <label>面板颜色<input name="color" type="color" value="${p.color}"></label>`;
}
function renderElectricalPanel(root){
  const p=ui.sel?.kind==='electrical'&&getElectrical(ui.sel.id),fs=electricalFaces(),points=state.electrical||[];
  if(p){
    const g=FPElectrical.check(p,fs,points),candidates=fs.filter(f=>f.wallId===p.wallId&&f.roomId===p.roomId&&p.normal.every((n,i)=>n===f.normal[i])),face=g.face||candidates[0];
    root.innerHTML=`<section><h3>点位属性 <small>${esc(electricalRoom(p.roomId))}</small></h3>${!g.ok?`<div class="ep-warning">${g.error}，点位已保留，可重新贴墙。</div>`:''}
      <form id="epEdit"><div class="form">${electricalFormFields(p,g)}</div><p class="ep-help">${face?`墙段净长 ${Math.round(face.value)} mm · 另一端距中心 ${Math.round(g.endOffset??0)} mm<br>起点：${face.axis===0?'左端':'上端'}；高度：完成地面至面板中心。`:'原墙面不可用，请重新贴墙。'}<br>实际尺寸 ${g.width||FPElectrical.size(p).width} × ${g.height||FPElectrical.size(p).height} mm · 厚度 8 mm</p>
      <div class="ep-warning" id="epError" role="alert" hidden></div><div class="actions"><button class="btn primary" type="submit">应用修改</button><button class="btn" type="button" id="epLocate">3D 近看</button><button class="btn" type="button" id="epWallPreview">同墙预览</button></div></form>
      <div class="actions"><button class="btn" id="epCopy">复制</button><button class="btn" id="epReattach">重新贴墙</button><button class="btn danger" id="epDelete">删除点位</button><button class="btn" id="epBack">返回点位总览</button></div></section>
      <section class="ep-help">2D 拖动只调整沿墙距离；3D 拖动可调整沿墙位置和高度。方向键微调 10 mm，按 Shift 微调 100 mm。方案自动保存，支持撤销和重做。</section>`;
    $('#epEdit').onsubmit=ev=>{
      ev.preventDefault();const values=Object.fromEntries(new FormData(ev.currentTarget));
      if(!face)return electricalError('原墙面不可用，请使用“重新贴墙”');
      const changes={...values,height:+values.height,count:+values.count,gap:+values.gap,along:face.a[face.axis]+Number(values.offset)};delete changes.offset;
      updateElectrical(p,changes);
    };
    $('#epLocate').onclick=async()=>{if(!is3D())await setView('3d');closeDrawers();window.View3D?.focusElectrical(p.id);};
    $('#epWallPreview').onclick=async()=>{if(!is3D())await setView('3d');closeDrawers();window.View3D?.focusElectrical(p.id,true);};
    $('#epCopy').onclick=duplicateElectrical;$('#epDelete').onclick=deleteElectrical;
    $('#epReattach').onclick=()=>{electricalEditor.reattach=p.id;electricalEditor.placing=p.type;electricalEditor.height=p.height;renderElectricalLibrary();closeDrawers();window.View3D?.electricalMode();};
    $('#epBack').onclick=()=>select(null);return;
  }
  const type=electricalEditor.lastType,defaultP={type,name:FPElectrical.catalog[type].name,...electricalOptions()},first=fs.find(f=>f.value>=86)||fs[0];
  root.innerHTML=`<section><h3>水电点位布置</h3><div class="ep-counter"><span>${points.length} 组点位</span><span>${points.reduce((a,p)=>a+p.count,0)} 个面板</span></div>
    <p class="ep-help">在左侧选择插座或开关，点击墙面放置。也可以在这里选择墙段、输入尺寸。</p>
    <h3>精确布置</h3><form id="epAdd"><div class="form"><label class="full">房间 / 墙段<select name="face" id="epFace">${fs.map((f,i)=>`<option value="${i}" ${f===first?'selected':''}>${esc(electricalFaceName(f))}</option>`).join('')}</select></label>${electricalFormFields(defaultP,{offset:first?Math.min(300,Math.round(first.value/2)):0})}</div>
    <p class="ep-help">所有尺寸均为 mm。距离从墙段左端或上端量到点位中心，不计墙体厚度。</p><div class="ep-warning" id="epError" role="alert" hidden></div><div class="actions"><button class="btn primary" type="submit" ${!first?'disabled':''}>添加到墙面</button></div></form></section>
    <section class="ep-help">点位与当前方案一起自动保存，完整方案 JSON 包含全部点位。切回“总览”仍可看到真实面板。当前预览包含插座、网口和开关面板。</section>`;
  $('#epFace').onchange=ev=>{const f=fs[Number(ev.target.value)];$('#epAdd [name=offset]').value=Math.min(300,Math.round(f.value/2));};
  $('#epAdd [name=type]').onchange=ev=>{const c=FPElectrical.catalog[ev.target.value];$('#epAdd [name=name]').value=c.name;$('#epAdd [name=height]').value=c.height;};
  $('#epAdd').onsubmit=ev=>{ev.preventDefault();const v=Object.fromEntries(new FormData(ev.currentTarget)),f=fs[+v.face];
    const p=FPElectrical.place(v.type,f,f.a[f.axis]+Number(v.offset),{id:uid(),name:v.name,height:+v.height,count:+v.count,layout:v.layout,gap:+v.gap,color:v.color});
    // 精确输入不吸附，不悄悄改变用户输入的距离。
    p.along=f.a[f.axis]+Number(v.offset);if(addElectrical(p)){closeDrawers();window.View3D?.focusElectrical(p.id);}
  };
}
function electricalError(message){const el=$('#epError');if(el){el.hidden=false;el.textContent=message;}toast(message);return false;}
function updateElectrical(p,changes){
  const candidate={...p,...changes};try{FPElectrical.validate([candidate]);}catch(err){return electricalError(err.message);}
  const g=FPElectrical.check(candidate,electricalFaces(),state.electrical);if(!g.ok)return electricalError(g.error);
  mutate(()=>Object.assign(getElectrical(p.id),candidate));return true;
}
function addElectrical(p){
  const g=FPElectrical.check(p,electricalFaces(),state.electrical);if(!g.ok)return electricalError(g.error);
  electricalEditor.placing=null;electricalEditor.reattach=null;ui.sel={kind:'electrical',id:p.id};
  mutate(()=>state.electrical.push(p));window.View3D?.electricalMode();toast('点位已添加，已自动保存');return true;
}
function placeElectricalOnFace(f,along){
  const e=electricalEditor,old=e.reattach&&getElectrical(e.reattach);
  const p=FPElectrical.place(e.placing,f,along,old?{...old,wallId:f.wallId,roomId:f.roomId,normal:f.normal.slice()}: {...electricalOptions(),id:uid()});
  // 重新贴墙时保留规格，沿墙位置取本次点击。
  if(old){if(updateElectrical(old,p)){e.placing=null;e.reattach=null;renderElectricalLibrary();window.View3D?.electricalMode();}return;}
  addElectrical(p);
}
function deleteElectrical(){const id=ui.sel?.id;if(!getElectrical(id))return;ui.sel=null;mutate(()=>state.electrical=state.electrical.filter(p=>p.id!==id));}
function duplicateElectrical(){
  const old=getElectrical(ui.sel?.id);if(!old)return;
  const fs=electricalFaces(),g=FPElectrical.geometry(old,fs);if(!g.ok)return electricalError(g.error);
  for(let d=g.width+10;d<g.face.value;d+=10)for(const sign of [1,-1]){
    const p={...old,id:uid(),name:old.name+' 副本',normal:old.normal.slice(),along:old.along+sign*d};
    if(FPElectrical.check(p,fs,state.electrical).ok){addElectrical(p);return;}
  }
  electricalError('当前墙段没有足够空间复制，请选择其他墙段布置');
}
function renderElectricalFab(){
  if(ui.sel?.kind!=='electrical')return false;const p=getElectrical(ui.sel.id);if(!p)return false;
  const fab=$('#fab');fab.classList.add('show');fab.innerHTML=`<span class="name">${esc(p.name)}</span><button class="btn" id="epFabProp">点位属性</button><button class="btn" id="epFabCopy">复制</button><button class="btn danger" id="epFabDelete">删除</button><button class="btn" id="epFabDone">完成</button>`;
  $('#epFabProp').onclick=()=>drawer('panel',true);$('#epFabCopy').onclick=duplicateElectrical;$('#epFabDelete').onclick=deleteElectrical;$('#epFabDone').onclick=()=>select(null);return true;
}
function renderElectrical2D(){
  const root=$('#gElectrical');if(!root||!state)return;const fs=electricalFaces(),k=1/view.s;
  root.innerHTML=(state.electrical||[]).map((p,i)=>{const g=FPElectrical.geometry(p,fs);if(!g.face)return '';const selected=ui.sel?.kind==='electrical'&&ui.sel.id===p.id,c=selected?'#b5653a':g.ok?'#2f5d62':'#bc442c';
    const x=g.x+p.normal[0]*14*k,y=g.y+p.normal[1]*14*k;
    return `<g class="ep-point" data-ep-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}，离地 ${p.height} 毫米"><title>${esc(p.name)} · ${esc(electricalRoom(p.roomId))} · 离地 ${p.height} mm</title><line x1="${g.x}" y1="${g.y}" x2="${x}" y2="${y}" stroke="${c}" vector-effect="non-scaling-stroke"/><circle cx="${x}" cy="${y}" r="${14*k}" fill="transparent"/><circle class="ep-dot" cx="${x}" cy="${y}" r="${10*k}" fill="${c}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text x="${x}" y="${y+4*k}" font-size="${11*k}" fill="#fff" text-anchor="middle">${i+1}</text></g>`;
  }).join('');
  root.querySelectorAll('[data-ep-id]').forEach(el=>el.onkeydown=ev=>{if(ev.key==='Enter'){setElectricalTab(true);select({kind:'electrical',id:el.dataset.epId});drawer('panel',true);}});
}
function electricalPlanDown(ev,pt){
  const el=ev.target.closest('[data-ep-id]'),e=electricalEditor;
  if(e.active&&e.placing){
    const f=FPElectrical.nearest(electricalFaces(),pt.x,pt.y,20/view.s);if(f)placeElectricalOnFace(f,f.axis===0?pt.x:pt.y);else toast('请点击房间内侧的实墙面');return true;
  }
  if(!el)return false;
  if(!e.active)setElectricalTab(true);const p=getElectrical(el.dataset.epId);select({kind:'electrical',id:p.id});
  e.drag={id:p.id,before:snap(),sx:ev.clientX,sy:ev.clientY,moved:false};svg.setPointerCapture(ev.pointerId);return true;
}
function electricalPlanMove(ev,pt){
  const d=electricalEditor.drag;if(!d)return false;
  if(Math.hypot(ev.clientX-d.sx,ev.clientY-d.sy)<TAP&&!d.moved)return true;
  const p=getElectrical(d.id),g=FPElectrical.geometry(p,electricalFaces());if(!g.face)return true;
  const candidate={...p,along:Math.round((g.face.axis===0?pt.x:pt.y)/10)*10};
  const check=FPElectrical.check(candidate,electricalFaces(),state.electrical);
  if(check.ok){Object.assign(p,candidate);d.moved=true;renderElectrical2D();window.View3D?.sync();}
  const hint=$('#electricalNotice span');if(hint)hint.textContent=check.ok?`中心距起点 ${Math.round(check.offset)} mm · 离地 ${p.height} mm`:check.error;return true;
}
function electricalPlanEnd(ev){
  const d=electricalEditor.drag;if(!d)return false;electricalEditor.drag=null;touches.delete(ev.pointerId);
  if(ev.type==='pointercancel'){state=fixState(JSON.parse(d.before));renderAll();}
  else if(d.moved){commit(d.before);renderAll();}else renderElectricalLibrary();return true;
}
