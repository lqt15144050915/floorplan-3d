# Phase 3A 测试报告：户型 JSON 导入与预览

> 日期：2026-10-21 ｜ 分支：`master`（本地提交，未推送）｜ 状态：✅ 完成，等待验收
> 本轮范围：接手文档 §7 Phase 3 的 3A 部分（导入 + 预览 + 原子替换）。导出 UI（3B）未开始。

---

## 0. 重要背景：Phase 1–2 成果在本机缺失，已按规格重建

接手文档描述的 Phase 0–2 代码（`fp-core.js`、`tests/`、`samples/`、提交 `8b55fba`/`abe8cb3`）
**不存在于本机，也从未推送到远端**（接手文档 §9 记录了 403 推送失败）。核实过程：
GitHub 远端 master 仍为基线 `730ec09`；全盘文件搜索、回收站、ZCode 会话数据库（23 个历史会话）
均无 `fp-core.js` 痕迹；本机唯一一次 floorplan-3d 会话（10-20，Desktop 目录）与开发无关。

因此本轮在实现 3A 之前，**先按接手文档 §2/§3 的规格重建了数据层与模型驱动渲染**
（下文 §2、§3），API 形状与文档一致：`FPCore.importFromText / exportStandard / builtinModel /
canDemolish / demolishBlockReason / roomLabelAt / registry`，`planModel / modelRev / applyModel`。
若日后找回原 Phase 1–2 代码，可用本轮测试套件做等价性核验。

## 1. 交付物

| 文件 | 内容 |
| --- | --- |
| `fp-core.js`（新增，约 600 行） | 数据层：DEFAULTS / Adapter A·B·C / Validator / 内置模型 / 导出 / 拆墙权限；浏览器+Node 双端（UMD） |
| `index.html`（改造） | 模型驱动（planModel 唯一几何源，applyModel 原子替换、v2 存档、跨模型撤销、3D 全推导）；3A 导入 UI（菜单入口、文件选择、拖拽、预览模态） |
| `tests/fp-core.test.mjs`（新增，29 用例） | Node 原生 test runner；隐私样例缺席时自动 skip |
| `samples/format-c-template.json` | 格式 C 模板（入库） |
| `samples/two-room-c.json` | 两室一厅回归样例：8 墙/3 窗/3 门/3 房间（入库） |
| `samples/最终改图_v13_原生字段.json`、`samples/最终改图_V15_独立重绘_原生字段.json` | 真实户型隐私样例（**不入库**，.gitignore `samples/最终改图_*.json` 已拦截并验证） |
| `samples/README.md` | 隐私与回归恢复说明 |

## 2. 数据层规格实现（对应接手文档 §3）

- **FPModel** `fp.model/1`：meta（含 source.format/file、declaredBounds、ceilingHeight）/ bounds / walls（kind+bearing+envelope 派生）/ windows（sill provenance）/ doors（hinge/closeDir/openDir 可空 → 中性门洞 swing）/ slides / rooms（labelAt 派生）/ materials（内置 8 种 + 文件合并）/ dims（内置链，导入为 null）/ defaults（provenance）。
- **格式检测**：registry 按序 C（schemaVersion 或 walls+metadata）→ B（WALLS+BOUNDS）→ A（WALLS）；**兼容原生旧键名 `WINS`**（真实文件验证发现，见 §6-③）。
- **Validator**：错误（拒绝，model=null）7 类；警告（放行）8 类（含开口嵌入超差按原始坐标报 mm、完全重复墙不去重、BOUNDS 未包含几何）；默认值一律记录 provenance，`待确认`（如未声明承重 → unknown 保守保护）与`默认`分开标注。铁律「不改几何」有逐坐标断言测试。

## 3. index.html 模型驱动改造（对应接手文档 §5）

- `planModel` 唯一几何源；`WALLS/WINS/DOORS/SLIDES/ROOMS/MATS` 变为模型视图（`syncModelVars` 整体重建），渲染层沿用旧形状最小改动。
- `applyModel()`：整体替换 + 可撤销（撤销栈元素 `{model, json}`，支持跨模型撤销）+ `fitView` 视角适配 + v2 存档 `huxing-design-v2`（v1 只读迁移）；方案随模型缓存（`modelJsonCache`）。
- 2D：拆墙权限走 `FPCore`（承重/未知/外墙/外围保护）；入户箭头由 entry 门推导；尺寸链 = 内置 8 链 / 导入自动外包两条；中性门洞只画框线。
- 3D：世界中心/层高由模型包围盒推导；门窗过梁高度全部来自模型；飘窗类洞口上方墙体按「同轴墙带缺口 ±30mm × 抬高房间覆盖 ≥55%」推导（复现内置两条硬编码过梁）；漫游起点由入户门推导；`modelRev` 进入 3D 重建签名（换户型必全量重建）。

## 4. 单元测试（`node --test tests/fp-core.test.mjs`）

| 模式 | 结果 |
| --- | --- |
| 隐私样例在场（当前本机） | **29 pass / 0 fail / 0 skip** |
| 隐私样例缺席（克隆视角） | 27 pass / 0 fail / 2 skip（预期行为） |

覆盖：内置模型结构与 provenance；铁律逐坐标断言（内置反造 + v13 真实文件）；检测 A/B/C/未知；原生类型映射 b/e/n/low/其他→unknown；默认值 provenance 与显式值不覆盖；WINS 旧键名；中性门洞；格式 C 枚举/单位/材质合并与回退；错误 7 类；警告 5 类；canDemolish 矩阵；内置/两室一厅导出往返一致；roomLabelAt（矩形/凹形）；v13 真实文件（66 墙/11 窗/7 门/9 房间 + 往返）；V15 用户文件（48 墙、铰点偏移告警、承重保护）。

## 5. 浏览器端到端回归（Chrome · http://localhost:8001 独立源）

| # | 场景 | 结果 |
| --- | --- | --- |
| A | 默认户型不导入：48 墙/12 窗/6 门/13 房间/46 家具、视觉与改造前一致、入户箭头 `M3350 8755L4400 8755` 与原版相同 | ✅ |
| B | 真实 JSON（格式 B，v13 66墙/11窗/7门）：拖拽 → 预览模态（概要+警告 2 条含重复墙+默认值 4 项+2D 预览）→ 确认 → 黑承重/灰普通/青窗/L 型客餐厅、自动尺寸链 13960×10563、入户箭头 `M1512 1978L1512 3028`（指向北侧入户门）、套内 107.37 m² | ✅ |
| C | 格式 C（two-room-c.json）：识别格式 C、8/3/3/3、确认后 1 面黑承重墙、3D 重建（世界中心重推导、无残留、门洞正确） | ✅ |
| D | 异常文件：`{"foo":1}` → 「unknown_format 无法识别的户型格式…」可读提示、无确认按钮；`{oops` → 「bad_json JSON 语法错误：…」；模型均不受影响 | ✅ |
| E | 取消不破坏：模态取消后模型/撤销栈不变；确认后撤销一步**跨模型**回到默认户型（48 墙/46 家具） | ✅ |
| F | 持久化：导入后 v2 存档写入，刷新页面模型与方案恢复（含 v13 恢复后箭头/门窗全正确） | ✅ |
| G | 拆墙权限：承重墙 w0 → toast「承重墙（黑色）或承重属性未知的墙体不可拆除」且 demolished 不变；可拆墙 w26 → 标记拆除 + 幽灵样式 + 再点恢复 | ✅ |
| H | 3D 同源：内置户型 3D 与改造前视觉一致（含飘窗过梁）；导入户型 3D 全量重建无残留 | ✅ |

用户实测（8000 端口）：开发过程中用户自行拖入了 `最终修改图_独立重绘_floorplan3d_V15.json`
（格式 B，48 墙/6 门/9 房间），全流程成功并持久化——等效一次真实用户验收；该文件已征引入回归样例。

### UI 截图（本次验收材料）

| 画面 | 路径（会话 artifacts 目录） |
| --- | --- |
| 默认户型 2D（改造后，与改造前一致） | `call_764b8836…740f9962…png`（三室两厅两卫全景） |
| 格式 C 导入预览模态 | `call_87bb075a…29cb10eb…png`（概要+2D 预览+确认按钮） |
| 真实户型 v13 导入后 2D | `call_52eb6735…f05d1633…png`（黑承重/灰普通/青窗/L 型厅/入户箭头/107.37 m²） |
| 内置户型 3D（改造后） | `call_2ced3f96…42474e8a…png`（含飘窗过梁、房间标签） |
| 两室一厅 3D（俯视） | `call_…`（画布导出：8 墙+承重墙+门洞） |

截图保存在 `C:\Users\LQT15\.zcode\cli\artifacts\session_20544a1a323836b1105e5bae9de15555\`。

## 6. 过程中修复的缺陷（均经回归覆盖）

1. **renderAll 不重绘 openings/dims**：导入后门窗、入户箭头、尺寸链停留在初始渲染 → renderAll 纳入 `renderOpenings()/renderDims()`。
2. **entryArrow face 轴配对错误**：门洞长轴沿 x 时门脸应取 y0/y1（两处配对反了）→ 修复后内置/v13/V15 三种户型箭头位置全部正确。
3. **原生格式键名兼容**：真实文件使用旧键名 `WINS`（原项目/convert_plan 产物均为 WINS）→ Adapter 同时接受 `WINDOWS`/`WINS`。
4. **unknown_mat 警告丢失**：材质回退发生在校验前导致警告不报 → 调整 finish/validate 时序。
5. **applyModel 尺寸链残留**（renderAll 修复的子项）。
6. 重复 `typeColor`/`const BOUNDS` 声明等改造期笔误（语法检查拦截）。

## 7. 已知限制

- 与接手文档一致的既有限制继续有效（过梁推导适用范围、极端凹多边形标签点、3D 依赖 CDN 等）。
- `window.__fpTest` 测试入口**保留**（本轮浏览器回归依赖），按约定在 Phase 3B 导出 UI 完成后移除。
- 自定义材质（文件新增）2D 按色板平涂、3D 平涂贴图（无纹理图案）；内置 8 种材质不受影响。
- 撤销栈不跨会话（与原应用一致）；v1 存档只读迁移到内置模型。
- 真实户型 JSON 为隐私数据，仅本地保留；克隆者跑测试为 27 pass + 2 skip。

## 8. 复验命令

```bash
node --test tests/fp-core.test.mjs   # 29/29（隐私样例缺席时 27+2 skip）
python -m http.server 8000           # http://localhost:8000 手动体验「文件 ▾ → 导入户型 JSON」或直接拖拽 JSON 入画面
```
