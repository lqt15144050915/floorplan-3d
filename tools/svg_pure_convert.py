# -*- coding: utf-8 -*-
"""纯 SVG 还原：完全按用户 SVG 的墙/窗/门/滑轨几何，仅按 PDF 总尺寸标定外包。
不增删任何墙段。输出 tools/svg_pure_v2.json + 桌面副本。"""
import json, re, shutil, os
from collections import deque
from normalize_floorplan import normalize_plan

svg = open(r"C:\Users\LQT15\Desktop\Group 48097711.svg", encoding="utf-8").read()
def rot90(x,y,w,h,cx,cy):
    pts=[(x,y),(x+w,y),(x,y+h),(x+w,y+h)]
    tp=[(cx-(py-cy), cy+(px-cx)) for px,py in pts]
    xs=[p[0] for p in tp]; ys=[p[1] for p in tp]
    return min(xs),min(ys),max(xs)-min(xs),max(ys)-min(ys)
def rot180(x,y,w,h,cx,cy): return 2*cx-(x+w), 2*cy-(y+h), w, h

els=[]
for m in re.finditer(r'<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"(?: transform="rotate\((-?\d+) ([\d.-]+) ([\d.-]+)\)")? fill="(#[0-9A-Fa-f]+)"', svg):
    x,y,w,h = map(float, m.groups()[:4]); c=m.group(8)
    if m.group(5):
        ang=int(m.group(5)); cx,cy=float(m.group(6)),float(m.group(7))
        if ang==90: x,y,w,h = rot90(x,y,w,h,cx,cy)
        else: x,y,w,h = rot180(x,y,w,h,cx,cy)
    if c=='white': continue
    els.append(dict(x0=x,y0=y,x1=x+w,y1=y+h,c=c))

xs=[e['x0'] for e in els]+[e['x1'] for e in els]
ys=[e['y0'] for e in els]+[e['y1'] for e in els]
sx = 13960/(max(xs)-min(xs)); ox = -240 - min(xs)*sx
sy = 10563/(max(ys)-min(ys)); oy = -240 - min(ys)*sy
print(f"标定: x={sx:.4f} y={sy:.4f} (墙厚≈{32*sx:.0f}mm)")

def CV(v): return round(v)
walls=[]; wins=[]; slide_rects=[]
for e in els:
    r=[CV(ox+e['x0']*sx), CV(oy+e['y0']*sy), CV(ox+e['x1']*sx), CV(oy+e['y1']*sy)]
    if r[2]-r[0]<10 or r[3]-r[1]<10: continue
    if e['c']=='#3694FF': wins.append(r)
    elif e['c']=='#C800FF': slide_rects.append(r)
    elif e['c']=='#BC9160': continue
    else:
        walls.append(dict(rect=r, bearing=(e['c']=='#141619')))   # 门框连接小块（46~92mm）也是真实墙体，全部保留
sx0=min(r[0] for r in slide_rects); sy0=min(r[1] for r in slide_rects)
sx1=max(r[2] for r in slide_rects); sy1=max(r[3] for r in slide_rects)
slides=[dict(rect=[sx0,sy0,sx1,sy1],vertical=(sx1-sx0)<(sy1-sy0))]

def door(x0,y0,x1,y1,hx,hy,c,o,name,entry=False):
    return dict(name=name,rect=[CV(ox+x0*sx),CV(oy+y0*sy),CV(ox+x1*sx),CV(oy+y1*sy)],
                hinge=[CV(ox+hx*sx),CV(oy+hy*sy)],closeDir=c,openDir=o,len=None,entry=entry)
doors=[
 door(332,560,448,592, 448,592, [-1,0],[0,-1],'入户门',True),
 door(461,772,577,788, 577,788, [-1,0],[0,1],'西南卧室门'),
 door(1472,600,1504,716, 1472,600, [0,1],[1,0],'主卧门'),   # 门洞从北侧墙垛(592..600)南缘开始，垛子外露
 door(1758,560,1854,592, 1758,592, [1,0],[0,-1],'卫生间门(东)'),   # 铰点在西侧（用户核定：水平镜像）
 door(1374,576,1468,592, 1374,592, [1,0],[0,-1],'北卧室门'),
]
for dd in doors:
    dd['len']=max(dd['rect'][2]-dd['rect'][0], dd['rect'][3]-dd['rect'][1])

# 房间划分
X0,Y0 = min(w['rect'][0] for w in walls), min(w['rect'][1] for w in walls)
X1,Y1 = max(w['rect'][2] for w in walls), max(w['rect'][3] for w in walls)
CELL=50; W=(X1-X0)//CELL; H=(Y1-Y0)//CELL
g=[[0]*W for _ in range(H)]
for r in [w['rect'] for w in walls]+wins+[dd['rect'] for dd in doors]+[s['rect'] for s in slides]:
    for j in range(max(0,int((r[1]-Y0)//CELL)),min(H,int((r[3]-Y0)//CELL)+1)):
        for i in range(max(0,int((r[0]-X0)//CELL)),min(W,int((r[2]-X0)//CELL)+1)):
            g[j][i]=1
out=[[False]*W for _ in range(H)]; dq=deque()
for i in range(W):
    for j in (0,H-1):
        if not g[j][i]: out[j][i]=True; dq.append((i,j))
for j in range(H):
    for i in (0,W-1):
        if not g[j][i] and not out[j][i]: out[j][i]=True; dq.append((i,j))
while dq:
    i,j=dq.popleft()
    for di,dj in ((1,0),(-1,0),(0,1),(0,-1)):
        ni,nj=i+di,j+dj
        if 0<=ni<W and 0<=nj<H and not g[nj][ni] and not out[nj][ni]: out[nj][ni]=True; dq.append((ni,nj))
seen=[[False]*W for _ in range(H)]; regions=[]
for j0 in range(H):
    for i0 in range(W):
        if g[j0][i0] or out[j0][i0] or seen[j0][i0]: continue
        cells=set(); dq=deque([(i0,j0)]); seen[j0][i0]=True
        while dq:
            ci,cj=dq.popleft(); cells.add((ci,cj))
            for di,dj in ((1,0),(-1,0),(0,1),(0,-1)):
                ni,nj=ci+di,cj+dj
                if 0<=ni<W and 0<=nj<H and not g[nj][ni] and not out[nj][ni] and not seen[nj][ni]:
                    seen[nj][ni]=True; dq.append((ni,nj))
        area0=len(cells)*CELL*CELL/1e6
        if area0<0.8: continue
        # 膨胀：地板向相邻墙/窗/门格各伸 2 格（100mm），伸进墙体内部——墙不透明后画必然覆盖，杜绝一切接缝白线
        for _ in range(2):
            add=set()
            for (ci,cj) in cells:
                for di,dj in ((1,0),(-1,0),(0,1),(0,-1)):
                    ni,nj=ci+di,cj+dj
                    if 0<=ni<W and 0<=nj<H and g[nj][ni]==1: add.add((ni,nj))
            cells |= add
        area=len(cells)*CELL*CELL/1e6
        edges={}
        for (ci,cj) in cells:
            if (ci,cj-1) not in cells: edges.setdefault((ci,cj),[]).append((ci+1,cj))
            if (ci+1,cj) not in cells: edges.setdefault((ci+1,cj),[]).append((ci+1,cj+1))
            if (ci,cj+1) not in cells: edges.setdefault((ci+1,cj+1),[]).append((ci,cj+1))
            if (ci-1,cj) not in cells: edges.setdefault((ci,cj+1),[]).append((ci,cj))
        start=min(edges); loop=[start]; cur=edges[start][0]
        while cur!=start:
            loop.append(cur)
            nxts=edges[cur]
            if len(nxts)==1: nxt=nxts[0]
            else:
                din=(cur[0]-loop[-2][0],cur[1]-loop[-2][1])
                straight=(cur[0]+din[0],cur[1]+din[1])
                nxt = straight if (straight in nxts and straight!=loop[-2]) else next(x for x in nxts if x!=loop[-2])
            cur=nxt
        pts=[(X0+a[0]*CELL, Y0+a[1]*CELL) for a in loop]
        poly=[]
        for p in pts:
            while len(poly)>=2 and ((p[0]==poly[-1][0]==poly[-2][0]) or (p[1]==poly[-1][1]==poly[-2][1])): poly.pop()
            if not poly or p!=poly[-1]: poly.append(p)
        while len(poly)>=2 and ((poly[0][0]==poly[-1][0]==poly[-2][0]) or (poly[0][1]==poly[-1][1]==poly[-2][1])): poly.pop()
        if len(poly)>1 and poly[0]==poly[-1]: poly.pop()
        xs2=[p[0] for p in poly]; ys2=[p[1] for p in poly]
        regions.append(dict(area=round(area,2), poly=[[int(px) for px in p] for p in poly], cx=sum(xs2)/len(xs2), cy=sum(ys2)/len(ys2)))
print(f"纯SVG连通域 {len(regions)} 个:")
for r in sorted(regions,key=lambda r:-r['area']):
    print(f"  {r['area']:7.2f} m² center=({round(r['cx'])},{round(r['cy'])})")

named=[]
for r in sorted(regions,key=lambda r:-r['area']):
    if r['area']>30: nm='客餐厅(开放区)'
    elif 15<r['area']<20: nm='主卧室'
    elif 8<r['area']<12:
        if r['cy']<1700 and r['cx']>8800: nm='卧室'
        elif r['cy']>7500 and r['cx']<4500: nm='卧室'
        elif r['cy']>7500: nm='阳台'
        else: nm='卧室'
    elif 5<r['area']<8: nm='厨房' if (r['cx']<4600 and r['cy']<3400) else '阳台'
    elif 3<r['area']<5: nm='卫生间'
    else: nm='卫生间'
    named.append(dict(name=nm, area=r['area'], poly=r['poly']))
named.sort(key=lambda r:(min(p[1] for p in r['poly']), min(p[0] for p in r['poly'])))

# ---- 边界磁吸：房间多边形边界吸附到相邻墙/窗/门面，消除栅格量化白缝（墙后画，地板可延伸到墙下） ----
blockers = [w['rect'] for w in walls] + wins + [dd['rect'] for dd in doors] + [s['rect'] for s in slides]
faces_x = {}; faces_y = {}
for r in blockers:
    faces_x.setdefault(r[0], []).append(r); faces_x.setdefault(r[2], []).append(r)
    faces_y.setdefault(r[1], []).append(r); faces_y.setdefault(r[3], []).append(r)
def snap_edge(v, lo, hi, faces, tol=130):
    best = None; bd = tol
    for f, rects in faces.items():
        if abs(f - v) >= bd: continue
        if any(min(rr[3], hi) - max(rr[1], lo) > 0 for rr in rects): bd = abs(f - v); best = f
    return best if best is not None else v
snapped = 0
for r in named:
    p = r['poly']; n = len(p)
    for i in range(n):
        a, b = p[i], p[(i+1) % n]
        if a[0] == b[0]:
            v = snap_edge(a[0], min(a[1],b[1]), max(a[1],b[1]), faces_x)
            if v != a[0]: a[0] = b[0] = v; snapped += 1
        else:
            v = snap_edge(a[1], min(a[0],b[0]), max(a[0],b[0]), faces_y)
            if v != a[1]: a[1] = b[1] = v; snapped += 1
print(f"磁吸边数: {snapped}")

for i,r in enumerate(named): r['id']='R%02d'%(i+1)

# ---- L 型阳台窗：角部方墙（SVG 中两段窗未覆盖的角块）+ 120x120 角柱居中，玻璃与方墙齐平 ----
def win_axis(r): return 'V' if (r[2]-r[0]) <= (r[3]-r[1]) else 'H'
vwin = next(r for r in wins if win_axis(r)=='V' and r[1] > 8000)   # 阳台西窗（竖向、南部）
hwin = next(r for r in wins if win_axis(r)=='H' and r[1] > 9500)   # 阳台南窗（横向、最南）
corner = [vwin[0], hwin[1], vwin[2], hwin[3]]    # 角部方域（两段窗未覆盖，用户 SVG 原样）
walls.append(dict(rect=corner, bearing=False, kind='interior', src='角部墙'))
walls.append(dict(rect=[round((vwin[0]+vwin[2])/2-60), round((hwin[1]+hwin[3])/2-60),
                        round((vwin[0]+vwin[2])/2+60), round((hwin[1]+hwin[3])/2+60)],
                  bearing=True, kind='interior', src='角柱'))   # 120x120 黑柱居中于两窗带中线交点
vwin[3] = corner[1]    # 西窗玻璃止于角墙北缘
hwin[0] = vwin[2]     # 南窗玻璃起于角墙东侧面（与方墙齐平，避免体块重叠）
balcony = (id(vwin), id(hwin))

# 外包盒（判断外墙）
xs=[w['rect'][0] for w in walls]+[w['rect'][2] for w in walls]
ys=[w['rect'][1] for w in walls]+[w['rect'][3] for w in walls]
BX0,BY0,BX1,BY1 = min(xs),min(ys),max(xs),max(ys)
def on_envelope(r, tol=30):
    return min(abs(r[0]-BX0), abs(r[2]-BX1), abs(r[1]-BY0), abs(r[3]-BY1)) <= tol

# ---- 组装格式 C（携带窗台/窗高/门开向） ----
NORTH_BED_X = [(9000,12000)]   # 仅北卧室为落地窗；客餐厅北窗为普通窗（2026-10-22 用户更正）
def win_spec(i, r):
    french = (id(r) in balcony) or any(lo < (r[0]+r[2])/2 < hi for lo,hi in NORTH_BED_X) and r[3] < 100
    if french: return {'id':'win%d'%i, 'rect':r, 'kind':'french', 'sillHeight':200, 'height':2200}  # 落地窗：下沿留 200
    return {'id':'win%d'%i, 'rect':r, 'kind':'standard', 'sillHeight':900, 'height':1500}
wins_sorted = sorted(wins)
out={
 'schemaVersion':'floorplan.standard/1',
 'metadata':{'name':'我的改图（纯 SVG 还原 V2）','units':'mm','coordinateSystem':'top-left-inner-y-down','ceilingHeight':2800},
 'walls':[{'id':'w%d'%i, 'rect':w['rect'][:4], 'kind':('exterior' if on_envelope(w['rect']) else 'interior'),
           'bearing':('bearing' if w['bearing'] else 'non_bearing')} for i,w in enumerate(walls)],
 'windows':[win_spec(i,r) for i,r in enumerate(wins_sorted)],
 'doors':[{'id':'d%d'%i, 'name':dd['name'], 'rect':dd['rect'], 'hinge':dd['hinge'], 'closeDir':dd['closeDir'],
           'openDir':dd['openDir'], 'width':dd['len'], 'height':2050, 'lintelHeight':2100, 'swing':'swing',
           **({'entry':True} if dd.get('entry') else {})} for i,dd in enumerate(doors)],
 'slides':[{'id':'s%d'%i, 'rect':s['rect'], 'vertical':s['vertical'], 'height':2100} for i,s in enumerate(slides)],
 'rooms':[{'id':r['id'], 'name':r['name'], 'polygon':r['poly'], 'matId':('antislip' if '卫生间' in r['name'] else 'tile800' if '客餐厅' in r['name'] else 'tile600' if (r['name']=='厨房' or r['name']=='阳台') else 'wood'), 'counted':True} for r in named],
}
out, normalized_changes = normalize_plan(out)
json.dump(out, open('tools/svg_pure_v2.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
shutil.copy('tools/svg_pure_v2.json', r'C:\Users\LQT15\Desktop\我的改图_纯SVG_V2.json')
print(f"纯SVG版（格式C）：墙 {len(out['walls'])} 窗 {len(out['windows'])}（落地 {sum(1 for w in out['windows'] if w['kind']=='french')}）门 {len(out['doors'])} 滑轨 {len(out['slides'])} 房间 {len(out['rooms'])}")
print("已复制到桌面：我的改图_纯SVG_V2.json")
