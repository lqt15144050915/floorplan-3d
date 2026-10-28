"""只读检查本项目格式 C 的当前户型，输出可复核的结构及几何审计结果。"""
import collections
import hashlib
import itertools
import json
import math
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'samples/我的改图_阳台大玻璃.json'
OUTPUT = ROOT / 'docs/review-2026-10-22/JSON规范性检查-数据.json'
issues = []


def pairs(items):
    obj = {}
    for key, value in items:
        if key in obj:
            issues.append({'level': 'error', 'code': 'duplicate_key', 'key': key})
        obj[key] = value
    return obj


def reject_constant(value):
    raise ValueError('JSON 非法常量: ' + value)


raw = SOURCE.read_bytes()
data = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=reject_constant)
groups = ['walls', 'windows', 'doors', 'slides', 'rooms']
allowed = {
    'walls': {'id', 'rect', 'kind', 'bearing'},
    'windows': {'id', 'rect', 'kind', 'group', 'sillHeight', 'height', 'frame'},
    'doors': {'id', 'name', 'rect', 'hinge', 'closeDir', 'openDir', 'width', 'height', 'entry', 'lintelHeight', 'swing'},
    'slides': {'id', 'rect', 'vertical', 'height'},
    'rooms': {'id', 'name', 'polygon', 'matId', 'labelAt', 'counted', 'floorElevation'},
}


def check(condition, code, path):
    if not condition:
        issues.append({'level': 'error', 'code': code, 'path': path})


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def point(value, length=2):
    return isinstance(value, list) and len(value) == length and all(map(number, value))


check(data['schemaVersion'] == 'floorplan.standard/1', 'schema_version', '/schemaVersion')
md = data['metadata']
check(md['units'] == 'mm', 'units', '/metadata/units')
check(md['coordinateSystem'] == 'top-left-inner-y-down', 'coordinates', '/metadata/coordinateSystem')
check(number(md['ceilingHeight']) and md['ceilingHeight'] > 0, 'ceiling', '/metadata/ceilingHeight')
check(point(md['bounds'], 4) and md['bounds'][2] > md['bounds'][0] and md['bounds'][3] > md['bounds'][1], 'bounds', '/metadata/bounds')
for key in data.keys() - {'schemaVersion', 'metadata', *groups, 'materials'}:
    issues.append({'level': 'warning', 'code': 'unsupported_field', 'path': '/' + key})
for key, mat in data['materials'].items():
    check(isinstance(mat['name'], str) and number(mat['price']) and mat['price'] >= 0 and
          bool(re.fullmatch(r'#[0-9a-fA-F]{6}', mat['sw'])), 'material_definition', '/materials/' + key)
all_ids = []
for group in groups:
    check(isinstance(data[group], list), 'array', '/' + group)
    for index, obj in enumerate(data[group]):
        path = f'/{group}/{index}'
        check(isinstance(obj['id'], str) and bool(obj['id']), 'id', path + '/id')
        all_ids.append(obj['id'])
        for key in obj.keys() - allowed[group]:
            issues.append({'level': 'warning', 'code': 'unsupported_field', 'path': path + '/' + key})
        if 'rect' in obj:
            r = obj['rect']
            check(point(r, 4) and r[2] > r[0] and r[3] > r[1], 'rect', path + '/rect')
            check(md['bounds'][0] <= r[0] < r[2] <= md['bounds'][2] and md['bounds'][1] <= r[1] < r[3] <= md['bounds'][3], 'outside_bounds', path + '/rect')
        if group == 'walls':
            check(obj['kind'] in ['interior', 'exterior', 'low'] and obj['bearing'] in ['bearing', 'non_bearing', 'unknown'], 'wall_enum', path)
        if 'height' in obj:
            check(number(obj['height']) and 0 < obj['height'] <= md['ceilingHeight'], 'height', path + '/height')
        if group == 'windows':
            check(obj['kind'] in ['standard', 'french', 'bay'], 'window_kind', path)
            check(obj['sillHeight'] >= 0 and obj['sillHeight'] + obj['height'] <= md['ceilingHeight'], 'window_top', path)
        if group == 'doors':
            check('entry' not in obj or type(obj['entry']) is bool, 'entry', path)
            h, c, o = obj['hinge'], obj['closeDir'], obj['openDir']
            check(all(point(v) for v in [h, c, o]), 'door_vectors', path)
            check(sum(v*v for v in c) == sum(v*v for v in o) == 1 and sum(a*b for a, b in zip(c, o)) == 0, 'door_axes', path)
            check(obj['height'] <= obj['lintelHeight'] <= md['ceilingHeight'], 'lintel', path)
            check(obj['width'] == max(obj['rect'][2] - obj['rect'][0], obj['rect'][3] - obj['rect'][1]), 'door_width', path)
        if group == 'slides':
            check(type(obj['vertical']) is bool, 'vertical', path)
        if group == 'rooms':
            check(all(point(p) for p in obj['polygon']), 'polygon_points', path)
            check(obj['matId'] in data['materials'], 'material_reference', path)
            check(type(obj['counted']) is bool and number(obj['floorElevation']), 'room_fields', path)
check(len(all_ids) == len(set(all_ids)), 'global_id_uniqueness', '/')


def inside(x, y, poly):
    hit = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            hit = not hit
    return hit


room_rows = []
for room in data['rooms']:
    poly = room['polygon']
    compact = []
    for p in poly:
        if not compact or p != compact[-1]:
            compact.append(p)
    if compact[0] == compact[-1]:
        compact.pop()
    collinear = backtracks = 0
    for i, b in enumerate(compact):
        a, c = compact[i-1], compact[(i+1) % len(compact)]
        u, v = (b[0]-a[0], b[1]-a[1]), (c[0]-b[0], c[1]-b[1])
        if u[0]*v[1] == u[1]*v[0]:
            collinear += 1
            backtracks += u[0]*v[0]+u[1]*v[1] < 0
    area = abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(poly, poly[1:]+poly[:1]))) / 2
    room_rows.append({'id': room['id'], 'name': room['name'], 'vertices': len(poly),
                      'adjacent_duplicates': len(poly)-len(compact), 'collinear_after_dedup': collinear,
                      'backtracks': backtracks, 'floor_coverage_area_m2': area/1e6,
                      'label_inside': inside(*room['labelAt'], poly)})

# 坐标压缩网格：只在实际边界坐标处分割，所有输入轮廓为正交多边形，故面积无栅格近似。
objects = [(g, o) for g in groups[:4] for o in data[g]]
xs, ys = set(), set()
for _, obj in objects:
    a, b, c, d = obj['rect']
    xs.update([a, c]); ys.update([b, d])
for room in data['rooms']:
    xs.update(p[0] for p in room['polygon']); ys.update(p[1] for p in room['polygon'])
xs.update([min(xs)-1000, max(xs)+1000]); ys.update([min(ys)-1000, max(ys)+1000])
xs, ys = sorted(xs), sorted(ys)
xi, yi = {v:i for i, v in enumerate(xs)}, {v:i for i, v in enumerate(ys)}
w, h = len(xs)-1, len(ys)-1
blocked = set()
for _, obj in objects:
    a, b, c, d = obj['rect']
    blocked.update((i, j) for i in range(xi[a], xi[c]) for j in range(yi[b], yi[d]))
outside, queue = {(0, 0)}, collections.deque([(0, 0)])
while queue:
    i, j = queue.popleft()
    for p in [(i-1,j), (i+1,j), (i,j-1), (i,j+1)]:
        if 0 <= p[0] < w and 0 <= p[1] < h and p not in blocked and p not in outside:
            outside.add(p); queue.append(p)
net = [0]*len(room_rows)
outside_area = overlap_area = uncovered = 0
for i in range(w):
    for j in range(h):
        if (i,j) in blocked:
            continue
        area = (xs[i+1]-xs[i])*(ys[j+1]-ys[j])
        owners = [n for n, r in enumerate(data['rooms']) if inside((xs[i]+xs[i+1])/2, (ys[j]+ys[j+1])/2, r['polygon'])]
        for n in owners:
            net[n] += area
        outside_area += area if owners and (i,j) in outside else 0
        overlap_area += area if len(owners) > 1 else 0
        uncovered += area if not owners and (i,j) not in outside else 0
for row, area in zip(room_rows, net):
    row['independent_net_area_m2'] = area/1e6

perimeter_candidates = []
for wall in data['walls']:
    a, b, c, d = wall['rect']; left, top, right, bottom = xi[a], yi[b], xi[c], yi[d]
    faces = ([(left-1,j) for j in range(top,bottom)] + [(right,j) for j in range(top,bottom)] +
             [(i,top-1) for i in range(left,right)] + [(i,bottom) for i in range(left,right)])
    if any(p in outside for p in faces) and wall['kind'] != 'exterior':
        perimeter_candidates.append({'id': wall['id'], 'kind': wall['kind'], 'bearing': wall['bearing'], 'rect': wall['rect']})
wall_overlaps = []
for a, b in itertools.combinations(data['walls'], 2):
    r, s = a['rect'], b['rect']
    area = max(0, min(r[2],s[2])-max(r[0],s[0])) * max(0,min(r[3],s[3])-max(r[1],s[1]))
    if area:
        wall_overlaps.append({'ids': [a['id'], b['id']], 'area_mm2': area})

node_code = r'''
const fs=require('fs'),core=require('./fp-core.js');
const source=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const r=core.importFromText(JSON.stringify(source),'audit.json');
const out=JSON.parse(JSON.stringify(core.exportStandard(r.model))),changes=[];
function compare(a,b,path=''){for(const k of Object.keys(a)){const p=path+'/'+k;
 if(!(k in b))changes.push({path:p,kind:'missing'});
 else if(a[k]&&typeof a[k]==='object')compare(a[k],b[k],p);
 else if(a[k]!==b[k])changes.push({path:p,from:a[k],to:b[k]});}}
compare(source,out);
console.log(JSON.stringify({ok:r.ok,errors:r.errors,warnings:r.warnings,defaults:r.defaults,lostOrChanged:changes,
 rooms:r.model.rooms.map(x=>({id:x.id,netAreaM2:core.roomInterior(r.model,x).area/1e6})),
 perimeterCandidates:r.model.walls.filter(w=>w.kind!=='exterior').map(w=>({id:w.id,canDemolish:core.canDemolish(w)})),
 openingFloors:[...r.model.doors,...r.model.slides].map(d=>({id:d.id,...core.openingFloor(r.model,d)}))}));
'''
core = json.loads(subprocess.check_output(['node', '-e', node_code, str(SOURCE.resolve())], cwd=ROOT, encoding='utf-8'))
policy = {o['id']:o['canDemolish'] for o in core.pop('perimeterCandidates')}
for row in perimeter_candidates:
    row['currently_demolishable'] = policy[row['id']]
result = {'source': str(SOURCE.resolve()), 'sha256': hashlib.sha256(raw).hexdigest(),
          'counts': {g:len(data[g]) for g in groups}, 'material_count': len(data['materials']),
          'strict_structure_issues': issues, 'project_validator_and_roundtrip': core, 'rooms': room_rows,
          'net_overlap_m2': overlap_area/1e6, 'floor_outside_closed_plan_m2': outside_area/1e6,
          'uncovered_enclosed_area_m2': uncovered/1e6, 'wall_overlaps': wall_overlaps,
          'perimeter_kind_candidates': perimeter_candidates}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
