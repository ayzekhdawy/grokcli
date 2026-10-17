## 结论：**通过（无 blocker）**

审查对象：未提交的「新建会话打开侧栏默认进入计划」修复。`pi -p`，工具仅 `read`/`bash`。

`npx vitest run src/lib/planModePro.test.ts`：31/31 通过。

### 核对表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 初始 focusKey 0 不打开；真 bump / planVisible 仍打开 | ✅ | `focusBump = input.focusKey !== 0`；新测试覆盖 0 vs null 与 0→1 |
| 2 | autoOpenEnabled=false 不变 | ✅ | 早返回未改 |
| 3 | PlanReviewPanel / ResourceViewer 未误伤 | ✅ | 只改 `shouldOpenPlanSideTab` |
| 4 | App.tsx / 文案 / 密钥 | ✅ | 无业务、无硬编码、无密钥 |
| 5 | CHANGELOG Unreleased 中英成对 | ✅ | picker-not-Plan 中英各一条 |
| 6 | 测试 | ✅ | 31 passed |

### 非 blocker 备注

1. ResourceViewer 内部 effect 仍用 `planFocusKey == null` vs ref(null)；当前未被 JSX 渲染。日后若复活，应共用 `shouldOpenPlanSideTab`。
2. `forceExpandKey=0` 仍会在 PlanReviewPanel 挂载时展开一次，幂等、无害。

无 blocker，该项可标完成。
