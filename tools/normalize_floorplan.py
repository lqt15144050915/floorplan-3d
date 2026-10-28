"""显式规范化格式 C；只清理共线冗余、标记外围类别，不移动建筑矩形或改变承重。"""
import argparse
import collections
import copy
import json
from pathlib import Path


def clean_polygon(points):
    result = []
    for p in points:
        if not result or p != result[-1]:
            result.append(p[:])
    if len(result) > 1 and result[0] == result[-1]:
        result.pop()
    changed = True
    while changed and len(result) > 3:
        changed = False
        for i, b in enumerate(result):
            a, c = result[i-1], result[(i+1) % len(result)]
            if (b[0]-a[0])*(c[1]-b[1]) == (b[1]-a[1])*(c[0]-b[0]):
                result.pop(i)
                changed = True
                break
    return result


def signed_area(poly):
    return sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(poly, poly[1:]+poly[:1])) / 2


def exterior_wall_ids(plan):
    # 门窗作为闭合边界；坐标压缩精确划分矩形，不使用 50 mm 近似栅格。
    rects = [obj['rect'] for group in ['walls', 'windows', 'doors', 'slides'] for obj in plan.get(group, [])]
    xs = {r[i] for r in rects for i in [0, 2]}
    ys = {r[i] for r in rects for i in [1, 3]}
    xs.update([min(xs)-1000, max(xs)+1000])
    ys.update([min(ys)-1000, max(ys)+1000])
    xs, ys = sorted(xs), sorted(ys)
    xi, yi = {v:i for i, v in enumerate(xs)}, {v:i for i, v in enumerate(ys)}
    width, height = len(xs)-1, len(ys)-1
    blocked = set()
    for a, b, c, d in rects:
        blocked.update((i, j) for i in range(xi[a], xi[c]) for j in range(yi[b], yi[d]))
    outside, queue = {(0, 0)}, collections.deque([(0, 0)])
    while queue:
        i, j = queue.popleft()
        for p in [(i-1,j), (i+1,j), (i,j-1), (i,j+1)]:
            if 0 <= p[0] < width and 0 <= p[1] < height and p not in blocked and p not in outside:
                outside.add(p)
                queue.append(p)
    result = set()
    for wall in plan['walls']:
        a, b, c, d = wall['rect']
        left, right, top, bottom = xi[a], xi[c], yi[b], yi[d]
        faces = ([(left-1,j) for j in range(top,bottom)] + [(right,j) for j in range(top,bottom)] +
                 [(i,top-1) for i in range(left,right)] + [(i,bottom) for i in range(left,right)])
        if any(p in outside for p in faces):
            result.add(wall['id'])
    return result


def normalize_plan(plan):
    result, changes = copy.deepcopy(plan), {'rooms': [], 'walls': []}
    for room in result.get('rooms', []):
        old = room['polygon']
        clean = clean_polygon(old)
        if len(clean) < 3 or abs(signed_area(clean)-signed_area(old)) > 1e-6:
            raise ValueError('多边形清理改变面积: ' + room['id'])
        room['polygon'] = clean
        if clean != old:
            changes['rooms'].append({'id': room['id'], 'before': len(old), 'after': len(clean)})
    exterior = exterior_wall_ids(result)
    for wall in result['walls']:
        if wall['id'] in exterior and wall['kind'] == 'interior':
            wall['kind'] = 'exterior'
            changes['walls'].append(wall['id'])
    return result, changes


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--log', type=Path)
    args = parser.parse_args()
    raw = args.source.read_bytes()
    normalized, changes = normalize_plan(json.loads(raw.decode('utf-8')))
    if args.backup:
        args.backup.parent.mkdir(parents=True, exist_ok=True)
        if args.backup.exists() and args.backup.read_bytes() != raw:
            raise ValueError('备份已存在且内容不同，拒绝覆盖')
        args.backup.write_bytes(raw)
    args.output.write_text(json.dumps(normalized, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    if args.log:
        args.log.write_text(json.dumps(changes, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(changes, ensure_ascii=True))
