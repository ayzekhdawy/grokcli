# 审核结论：通过（无 blocker）

pi `-p`（工具仅 `read`/`bash`）审未提交的桌面宠物修复：Windows 长跑卡顿、感叹号收敛、运行中不撒彩带。可进入下一项。

- 干活/打字保持所选形体（专注/好奇脸），不再走 `alert`/`exclaim`/`orbit`/`comet`
- `working` 优先于 `ready`；彩带只在进入 unread-ready 时播一次，然后右上角 pastille
- rAF 分级节流、hidden 暂停、`pet://cursor` 量化且只 `win.emit` 给宠物窗
- i18n 15 locale 改写 `settings.pet.expressionDesc`；CHANGELOG Unreleased Fixed 已写
- vitest `src/lib/pet` + `src/components/pet` 全绿；`cargo test still_cursor` 通过；`tsc -b` 0 错误

## 非 blocker

1. 光标停在 mark 上时 `fromScreen` 不按时间过期，会停在 30fps 而不是 rest 档；不会回到 60fps+全窗广播的卡死路径。
2. `petDoneTaskIds` 现为死导出（产品路径已不消费）。
3. `needs_you` 经既有 `verbToMarkState("waiting")→"listening"` 走 attentif，不是 `wide`（改动前亦不可达 `wide`）。
