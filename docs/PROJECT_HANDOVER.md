# Floorplan-3D 二次开发 · 项目接手文档

> 更新日期：2026-10-21 ｜ 状态：Phase 0–2 已完成，Phase 3（导入导出 UI）未开始
> 说明：用户提供的《FLOORPLAN3D_PROJECT_HANDOVER_PHASE2.md》基线文件在本机未找到，
> 本文档按任务要求的 9 项内容基于**当前真实源码**与 `docs/PHASE1-REPORT.md`、`docs/PHASE2-REPORT.md` 核对编写；
> 文中标注"本次复验"的结果为 2026-10-21 实际重跑结果，其余引用自阶段报告。

---

## 1. 项目目标与技术架构

### 目标

基于开源项目 `wy51ai/floorplan-3d`（纯前端户型装修设计工具）二次开发，最终目标：
**用户提供一个符合支持格式的 JSON，即可在工具中直接导入全新户型并自动生成正确的 2D/3D 场景，无需修改源代码。**

### 技术架构（保持原项目技术栈，无框架、无构建）

```
浏览器（file:// 或任意静态服务器）
├── fp-core.js        经典脚本（UMD）：FPModel / Adapter / Validator / 内置户型   ← 本次新增
└── index.html        单文件应用
    ├── 经典脚本（L345 起）   多语言、状态/撤销、2D SVG 渲染、交互、面板、存储
    └── module 脚本（L1575 起） Three.js r160（CDN importmap）3D 场景/漫游/相机
```

- 数据流：`用户 JSON → 格式检测 → Adapter → FPModel（planModel）→ Validator → 2D/3D 同源渲染`
- 运行要求：2D 功能完全离线可用；3D 需联网加载 three.js CDN（jsDelivr）
- 测试：Node 原生 test runner（无第三方依赖）

## 2. 当前代码目录与核心模块职责

```
floorplan-3d/
├── index.html            应用本体（约 2820 行；Phase 2 改造为模型驱动）
├── fp-core.js            数据层核心（832 行；无 DOM 依赖，浏览器/Node 双端）
├── tests/
│   └── fp-core.test.mjs  43 个单元测试（node:test）
├── samples/
│   ├── format-c-template.json            格式 C 模板（入库）
│   ├── two-room-c.json                   两室一厅测试样例（入库，Test C 回归）
│   ├── 最终改图_…_原生字段.json          真实住宅户型（隐私，不入库，见 samples/README.md）
│   └── README.md                         隐私与回归恢复说明
├── docs/
│   ├── PROJECT_HANDOVER.md               本文档
│   ├── PHASE1-REPORT.md                  Phase 1 报告
│   └── PHASE2-REPORT.md                  Phase 2 报告
└── .gitignore                            含隐私数据排除规则
```

### index.html 关键位置（行号为当前工作树）

| 位置 | 职责 |
| --- | --- |
| L394 `let planModel` | 当前户型模型（唯一几何数据源）+ `modelRev`/`modelJsonCache`/存档键 |
| L485 `stateForModel` / L493 `fixState` | 方案状态与模型分离；旧状态只接受 id 匹配项 |
| L509 `viewBounds` / L528 `loadAll` | 视图包围盒（声明 BOUNDS 优先）；v2 存档读取+v1 迁移 |
| L559 `applyModel` | 模型整体替换（可撤销；刷新 2D 标注/方案按钮/存档） |
| L586 `snapRects` | 家具贴墙吸附数据源（模型墙+窗） |
| L748/760/796 | `renderWalls` / `renderOpenings`（含中性门洞）/ `entryArrow`（入户箭头推导） |
| L1557 `window.__fpTest` | Phase 2 测试入口（Phase 3 将被正式导入 UI 取代） |
| L1581 `ctr`/`Hc`/`cutH` | 3D 世界中心/层高/剖切高度（全部模型推导） |
| L2354 `bayGapLintels` | 飘窗类洞口过梁：同轴墙带缺口 × 抬高房间覆盖推导 |
| L2390 `buildArch` | 3D 建筑生成（墙/门窗/楼板/天花全部来自 planModel） |
| L2496 `sync(force)` | 3D 增量重建，签名含 `modelRev`（换户型必全量重建） |
| L2693 `walkStart` | 漫游起点由 entry 门推导 |

### fp-core.js 关键位置

| 位置 | 职责 |
| --- | --- |
| L34 `DEFAULTS` | 预览默认值（窗台 900/窗顶 2400/门扇 2050/过梁 2100/层高 2800 等） |
| L57 `BUILTIN_WALLS` 等 | 内置默认户型本体数据（原 index.html 常量迁移） |
| L234 `adaptNative` | 格式 A/B Adapter（原生字段结构；B 含可选 BOUNDS） |
| L371 `adaptStandard` | 格式 C Adapter（统一标准格式；门开向可缺省→中性门洞） |
| L562 `markEnvelope` | 外围墙派生判定（贴包围盒 ±25mm → `wall.envelope`，保护） |
| L569 `finish` / L606 `validateGeometry` | 收尾+结构性校验（只报告不修改几何） |
| L697 `detectFormat` / L717 `importFromText` | 格式检测与导入入口 |
| L728 `exportStandard` | 统一标准格式导出 |
| L753 `demolishBlockReason` / L765 `roomLabelAt` / L783 `builtinModel` | 拆墙策略 / 标签点推导 / 内置模型 |

## 3. FPModel、Adapter、Validator 数据结构

### FPModel（内部规范模型，`blankModel()` 生成）

```text
{ version: 'fp.model/1',
  meta:  {name, units:'mm', coordinateSystem:'top-left-inner-y-down',
          ceilingHeight, isDefault, source:{format:'A'|'B'|'C'|'builtin', file},
          declaredBounds},          // 文件声明的 BOUNDS 原样保留
  bounds,                           // 几何包围盒（计算值）
  walls:   [{id, rect:[x0,y0,x1,y1], kind:'exterior|interior|low|unknown',
             bearing:'bearing|non_bearing|unknown', envelope:bool}]   // envelope 为派生字段
  windows: [{id, rect, wallId, kind:'standard|bay|french', group,
             sillHeight, height, sillSource:'file|default|builtin'}]
  doors:   [{id, name, rect, hinge, closeDir, openDir,   // 中性门洞三者可为 null
             width, height, entry, lintelHeight, heightSource,
             swing:'swing'|'neutral'}]
  slides:  [{id, rect, vertical, height, heightSource}]
  rooms:   [{id, name, polygon, matId, labelAt, counted, floorElevation}]
  materials: {id:{name,price,sw}}       // 内置 8 种 + 文件自定义合并
  furniture: [],                        // 可为空
  dims: null | {chains:[…]},            // 内置户型原始尺寸链；导入户型 null→自动生成
  defaults: [{path, value, tag:'待确认'|'默认', reason}] }
```

### Adapter Registry（`FPCore.registry`，按序检测，可扩展）

| 格式 | 检测特征 | 说明 |
| --- | --- | --- |
| C | `schemaVersion` 或 `walls+metadata` | 统一标准格式（推荐交换格式，模板见 samples） |
| B | `WALLS` 数组 + `BOUNDS` | 原生字段结构·自定义户型（已按真实文件核实） |
| A | `WALLS` 数组 | 原生字段结构（原项目） |

原生类型映射：`'b'→bearing`（保护）、`'e'→exterior+unknown`（保护）、`'n'→non_bearing+interior`、`'low'→low`、**其他/缺失→unknown（保守保护）**。

### Validator 规则（错误=拒绝导入且 model=null；警告=放行；默认值=记录 provenance）

- 错误：JSON 语法、未知格式、缺失/空墙体、墙坐标非法（非数值/负向/零面积）、未知单位（仅支持 mm）、房间多边形无效（<3 点/零面积/自相交）、id 重复、格式 C 枚举非法
- 警告：开口嵌入墙体（按**原始坐标**报重叠 mm，如真实文件 d2/w15=60mm）、门窗悬浮、完全重复墙体（不去重）、未知墙体类型、未知材质、门铰点偏移、门宽异常、BOUNDS 未包含几何
- 默认值：所有文件缺失的高度/类型均记录 `{path, value, tag, reason}`，绝不覆盖文件显式值
- 铁律：**任何校验/转换不修改用户输入的建筑几何**（有逐坐标断言测试）

### 拆墙权限（保守保护）

`canDemolish(w)` 仅当 `bearing==='non_bearing' && kind!=='exterior' && !envelope`；承重/外墙/外围/承重未知一律保护，`demolishBlockReason()` 返回原因供 UI 提示。

## 4. Phase 0/1/2 已完成内容及测试结果

| 阶段 | 内容 | 测试 | 状态 |
| --- | --- | --- | --- |
| Phase 0 | 只读审计：数据结构、26 处硬编码依赖清单、方案设计 | —（无代码） | ✅ 报告经用户批准 |
| Phase 1 | fp-core.js（模型/Adapter A·B·C/Validator/内置模型）；Node 测试 | 37 用例全过（当时）；**本次复验并入 Phase 2 用例后 43/43 通过** | ✅ 已验收 |
| Phase 2A | 2D 全部渲染/交互改为 planModel 驱动；入户箭头/尺寸链/视图边界动态化 | 浏览器冒烟：默认视觉一致 + 真实 JSON 渲染 + 拆墙权限 | ✅ |
| Phase 2B | 3D 消除 OX/OY、窗台下标、飘窗过梁、漫游起点、机位等硬编码 | 浏览器冒烟：三户型切换零残留零报错，3D 截图正常 | ✅ |
| Phase 2C | v2 存档（模型/状态分离）、v1 迁移、rev 感知撤销重做、方案按钮守卫 | 浏览器冒烟：持久化恢复/跨模型撤销/v1 迁移全过 | ✅ |

**本次复验（2026-10-21）**：`node --test tests/fp-core.test.mjs` → **43/43 通过**；
含隐私样例在场 43 pass / 缺席 30 pass+13 skip+0 fail 两种模式均验证。

详细过程数据（字段映射表、默认值清单、异常处理矩阵）见 `docs/PHASE1-REPORT.md`、`docs/PHASE2-REPORT.md`。

## 5. 2D/3D 同源渲染机制

```
planModel（唯一几何源）
   ├─ 2D：renderWalls/renderRooms/renderOpenings/renderLabels/renderDims 直读 rect/polygon
   └─ 3D：buildArch/buildLabels 读同一 planModel
        坐标变换 wx(x)=(x−ctr)/1000、wz(y)=(y−ctr)/1000，ctr=模型包围盒中心（无固定世界原点）
```

- **一致性保证**：2D 与 3D 无独立几何副本；`modelRev` 进入 3D 重建签名，换户型必然全量重建（无旧残留）
- **一致已验证**：默认 48 墙、真实 47 墙/9 窗/6 门（3D colliders=56=47+9）、两室一厅 8 墙/3 窗/3 门（colliders=11）
- **可拆卸性**：拆墙记录 `state.demolished`（墙 id），2D 幽灵样式、3D 不生成、漫游碰撞体同步排除

## 6. 已知问题、技术风险与未解决事项

1. **隐私数据不在仓库**：真实住宅户型 JSON（格式 B 回归样例）被 `.gitignore` 排除；克隆者跑测试为 30 pass+13 skip。本地放回同名文件即恢复 43 项完整回归。
2. **过梁缺口推导的适用范围**：`bayGapLintels` 依赖墙段同轴（±30mm）且抬高房间覆盖率 ≥55%；超出该模式的异形洞口可能缺洞口上方墙体。
3. **标签质心**：极端凹多边形的推导标签点可能落在多边形外（预览可接受）。
4. **自动尺寸链仅外包两条**（总宽/总高）：分段尺寸链当前仅内置户型有（`dims` 字段未对格式 C 开放）。
5. **撤销栈不跨会话**：刷新后清空（与原应用一致）；跨模型撤销依赖会话内 `modelJsonCache`。
6. **3D 依赖 CDN**：离线环境 3D 不可用（2D 不受影响）；如需离线可把 importmap 指向本地 three。
7. **d2/w15 60mm 重叠**：真实文件自身数据瑕疵，按"不改用户几何"原则保留+警告，已由用户确认该处理方式。
8. **file:// 打开**：代码层面无障碍（fp-core 为经典脚本），自动化沙箱无法验证 file: 协议，建议手动复核一次。
9. **上游远端为公开仓库**：任何私人图纸/户型数据严禁提交（.gitignore 已防护 `*.private.json` 与真实文件名）。

## 7. Phase 3、4 后续任务及验收要求

### Phase 3：导入导出 UI（未开始）

- 文件菜单新增「导入户型 JSON」「导出户型 JSON」（与现有"导入/导出方案"明确区分）
- 导入流程：文件选择 → 格式检测 → 解析/校验 → **预览模态**（户型概要、错误/警告、默认值"待确认"清单、2D 预览）→ 用户确认 → `applyModel()` 整体替换 → 自动适配视角
- 导出：`exportStandard(planModel)` 下载；保证 导出→再导入 几何一致
- 失败/取消不得破坏当前场景；替换可撤销（管线已就绪）
- 完成后移除或降级 `window.__fpTest` 测试入口
- 验收：全流程浏览器操作可达，异常文件在 UI 中得到可读提示

### Phase 4：完整回归验收（未开始）

- 测试 A（默认户型不导入时原功能正常）、B（真实 JSON：黑承重/灰普通/青色窗/厨房隔墙/L 型窗/无家具/2D-3D 一致）、C（第二个不同户型不改码可导入、再导第一个无残留）、D（8 类异常文件可读提示）、E（往返导入导出一致）
- 交付物：修改文件清单、JSON Schema 文档、可复用样例、Adapter 扩展说明、使用说明、自动化+浏览器验收报告、已知限制

## 8. 开发环境、测试命令和 Git 工作流程

### 环境

- Windows + Git Bash；Node v24（Node ≥18 均可，仅用原生 test runner）；Python 3.12（仅辅助脚本）
- 本地预览：`python -m http.server 8000` → http://localhost:8000 （或直接双击 index.html）
- 本机网络：github.com 直连不稳定，本地代理 `127.0.0.1:7890` 可用（git 操作可加
  `-c http.proxy=http://127.0.0.1:7890`，勿永久写入配置，除非自行决定）

### 常用命令

```bash
node --test tests/fp-core.test.mjs   # 数据层测试（43 项；隐私样例缺席时 13 项自动跳过）
python -m http.server 8000           # 本地静态服务
```

### Git 工作流程（本项目约定）

- 分支：`master`（与远端一致）；提交粒度：一个阶段/一个主题一个提交；文档与代码分开提交
- 提交前必须：`node --test` 全绿；不强制推送；隐私文件已在 .gitignore，`git add` 前用 `git status` 复核
- 测试入口：浏览器侧 `window.__fpTest`（Phase 3 完成后移除）

## 9. 当前 Git 状态快照（2026-10-21 核对）

| 项 | 值 |
| --- | --- |
| 分支 | `master`（跟踪 `origin/master`） |
| 接手时基线 HEAD | `730ec0923a018fdf38b4687c5ef385c7dcac451f`（"update"，上游最后提交） |
| 远端 | `origin = https://github.com/wy51ai/floorplan-3d.git`（**公开仓库**，GitHub API 匿名可访问） |
| 本次提交 | `8b55fba` feat: 统一户型模型与模型驱动 2D/3D 渲染（Phase 1-2 基线）；`abe8cb3` docs: 接手文档（当前 HEAD） |
| 测试 | 43/43 通过（2026-10-21 本次复验） |
| 推送状态 | **未推送**。原因：本机 Git 凭据账号为 `lqt15144050915`，对 `wy51ai/floorplan-3d` 无写权限（推送返回 403 Permission denied）。已尝试经本地代理 `127.0.0.1:7890` 连接（网络通），仅权限不符。处理建议（任选其一后重推，勿强推）：① 若 wy51ai 是你的账号，在 Git Credential Manager 中改用该账号登录（`git credential-manager github logout` 后重新登录）；② 给当前凭据账号添加仓库协作者权限；③ 推送到自己账号下的 fork 并调整 origin |
| 隐私确认 | 真实住宅户型 JSON 未进入任何提交（.gitignore 拦截 + 暂存清单二次核对），仅保留在本地 |
