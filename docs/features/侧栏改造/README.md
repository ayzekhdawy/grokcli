# 侧栏改造（Codex 式右侧 Side Workbench）

| 文档 | 用途 |
|------|------|
| [request.md](./request.md) | 原始需求 |
| [PLAN.md](./PLAN.md) | 产品布局定稿（icon 指认、开/关两态） |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | 分 Phase 实施方案与架构 |
| [GOAL.md](./GOAL.md) | **新会话粘贴的 Goal 提示词 + 验收清单** |
| [PROGRESS.md](./PROGRESS.md) | 执行进度 |
| `image*.png` | 视觉验收对照 |

## 新会话怎么开

1. 切分支：`feature/sidebar-refactor`  
2. 打开 [GOAL.md](./GOAL.md)，复制 **「总 Goal（编排）」** 整段给 Agent  
3. 或只复制当前 **Phase N 可复制 Goal** 精做一阶段  
4. 硬规则：**未达验收不得结束、不得跳 Phase**

## Icon 速记

- **pill（方框斜箭头 ▾）** = 使用指定应用打开  
- **`··|·`** = 环境信息  
- **竖分栏** = 显示/隐藏侧边栏  
- **底部横线方框** = 不做  
