/* 墙面点位：坐标/高度单位 mm。与渲染、方案库共用，不依赖 DOM。 */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./fp-core.js'));
  else root.FPElectrical=factory(root.FPCore);
})(typeof self!=='undefined'?self:this,function(Core){
  'use strict';
  const catalog={
    socket5:{name:'五孔插座',symbol:'插',height:300},
    socket3:{name:'三孔插座',symbol:'三',height:300},
    network:{name:'网络插座',symbol:'网',height:300},
    switch1:{name:'单开开关',symbol:'1',height:1300},
    switch2:{name:'双开开关',symbol:'2',height:1300},
    switch3:{name:'三开开关',symbol:'3',height:1300}
  };
  const eq=(a,b)=>Math.abs(a-b)<.01;
  const axis=f=>Math.abs(f.b[0]-f.a[0])>.01?0:1;
  const size=p=>({width:p.layout==='vertical'?86:86*p.count+p.gap*(p.count-1),height:p.layout==='vertical'?86*p.count+p.gap*(p.count-1):86});
  function validate(points){
    if(!Array.isArray(points)) throw Error('水电点位必须为数组');
    const ids=new Set();
    points.forEach(p=>{
      if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.id||/[<>"'&\s]/.test(p.id)||ids.has(p.id)||!Object.hasOwn(catalog,p.type)||
        typeof p.name!=='string'||p.name.length>120||typeof p.wallId!=='string'||typeof p.roomId!=='string'||
        !Array.isArray(p.normal)||p.normal.length!==2||!p.normal.every(Number.isFinite)||Math.abs(p.normal[0])+Math.abs(p.normal[1])!==1||!p.normal.every(v=>[-1,0,1].includes(v))||
        !Number.isFinite(p.along)||!Number.isFinite(p.height)||p.height<0||!Number.isInteger(p.count)||p.count<1||p.count>4||
        !['horizontal','vertical'].includes(p.layout)||!Number.isFinite(p.gap)||p.gap<0||p.gap>100||!/^#[0-9a-f]{6}$/i.test(p.color)) throw Error('水电点位含非法类型、尺寸、位置或重复编号');
      ids.add(p.id);
    });
    return points;
  }
  function faces(model,demolished=[]){
    // 保持原净轮廓：窗台以下的实墙另作为可挂载面，玻璃和门洞不参与。
    const interiors=Object.fromEntries(model.rooms.map(r=>[r.id,Core.roomInterior(model,r,demolished)]));
    const virtual=model.windows.filter(w=>w.sillHeight>0).map(w=>({...w,id:'window:'+w.id}));
    const hosts=[...model.walls,...virtual], m={...model,walls:hosts};
    return Core.wallDimensions(m,demolished,interiors).filter(f=>f.roomId).map(f=>{
      const host=hosts.find(w=>w.id===f.wallId),room=model.rooms.find(r=>r.id===f.roomId);
      const floor=room.floorElevation||0,top=host.id.startsWith('window:')?host.sillHeight:host.kind==='low'?1000:model.meta.ceilingHeight||2800;
      return {...f,axis:axis(f),floor,top};
    });
  }
  function geometry(p,fs){
    const candidates=fs.filter(f=>f.wallId===p.wallId&&f.roomId===p.roomId&&eq(f.normal[0],p.normal[0])&&eq(f.normal[1],p.normal[1]));
    const f=candidates.find(f=>p.along>=f.a[f.axis]-.01&&p.along<=f.b[f.axis]+.01);
    if(!f) return {ok:false,error:'原墙面已拆除或点位不在可用墙段内'};
    const {width,height}=size(p),half=width/2,a=f.a[f.axis],b=f.b[f.axis],x=f.axis===0?p.along:f.a[0],y=f.axis===1?p.along:f.a[1];
    const base={face:f,x,y,width,height,z:f.floor+p.height,offset:p.along-a,endOffset:b-p.along};
    if(p.along-half<a-.01||p.along+half>b+.01) return {...base,ok:false,error:'面板超出墙段边缘，或墙段太短'};
    if(p.height-height/2<0||f.floor+p.height+height/2>f.top+.01) return {...base,ok:false,error:'面板超出地面、窗台或墙顶高度'};
    return {...base,ok:true};
  }
  function check(p,fs,points=[]){
    const g=geometry(p,fs);if(!g.ok)return g;
    for(const other of points){
      if(other.id===p.id)continue;const h=geometry(other,fs);if(!h.ok)continue;
      if(p.roomId===other.roomId&&p.normal.every((v,i)=>v===other.normal[i])&&eq(g.face.a[1-g.face.axis],h.face.a[1-h.face.axis])&&
        Math.abs(p.along-other.along)<(g.width+h.width)/2-.01&&Math.abs(g.z-h.z)<(g.height+h.height)/2-.01) return {...g,ok:false,error:'与已有面板重叠，请调整位置或离地高度'};
    }
    return g;
  }
  function place(type,f,along,options={}){
    const p={id:options.id||'preview',type,name:catalog[type].name,wallId:f.wallId,roomId:f.roomId,normal:f.normal.slice(),along,
      height:catalog[type].height,count:1,layout:'horizontal',gap:10,color:'#ffffff',...options,type,wallId:f.wallId,roomId:f.roomId,normal:f.normal.slice(),along};
    const half=size(p).width/2,lo=f.a[f.axis]+half,hi=f.b[f.axis]-half;
    if(lo<=hi)p.along=Math.max(lo,Math.min(hi,Math.round(along/10)*10));
    return p;
  }
  function nearest(fs,x,y,tolerance=Infinity,filter=()=>true){
    let best=null,distance=tolerance;
    for(const f of fs){
      if(!filter(f))continue;
      const v=f.axis===0?x:y,t=Math.max(f.a[f.axis],Math.min(f.b[f.axis],v)),q=f.axis===0?[t,f.a[1]]:[f.a[0],t];
      const d=Math.hypot(x-q[0],y-q[1]);if(d<distance){distance=d;best=f;}
    }
    return best;
  }
  return {catalog,size,validate,faces,geometry,check,place,nearest};
});
