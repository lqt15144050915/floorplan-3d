# samples 说明

| 文件 | 是否入库 | 用途 |
| --- | --- | --- |
| `format-c-template.json` | ✅ 入库 | 格式 C（统一标准格式 `floorplan.standard/1`）模板，含全部字段与注释性取值 |
| `two-room-c.json` | ✅ 入库 | 两室一厅最小户型（8 墙 / 3 窗 / 3 门 / 3 房间），Phase 3A 回归用（Test C） |
| `最终改图_v13_原生字段.json` | ❌ **不入库（隐私）** | 真实住宅户型，格式 B（原生字段 `WALLS`+`BOUNDS`），由 `tools/convert_plan.py` 的产物 `plan_generated.js` 导出 |

## 隐私与回归恢复

真实住宅户型数据属于个人隐私，已被 `.gitignore` 排除（规则 `samples/最终改图_*.json`），
**严禁提交到任何远端仓库**。克隆者运行 `node --test tests/fp-core.test.mjs` 时，
依赖该文件的用例会自动跳过（skip）。

如需恢复完整回归：把本机留存的
`Downloads/装修图纸_按用户最新改图识别_v13.json`（pv-floorplan-from-pdf 格式）
经 `tools/convert_plan.py` 生成原生字段后放到本目录同名位置，或直接向仓库维护者索取
`最终改图_v13_原生字段.json` 放回本目录。
