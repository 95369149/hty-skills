---
name: "koufen-sync"
description: "从红太阳调试表增量提取扣分明细，利用终检结果+本地状态跳过已处理记录，省token"
---

# 扣分明细同步

从飞书源表（红太阳调试表）提取不合格项到扣分明细表 v2。

## 增量机制

**跳过逻辑**：`终检结果` 有值 + 该 record_id 已在本地状态文件中 → 跳过。

每次同步只处理新增的已完成记录，不重复提取历史数据。

## 执行

```bash
# 增量（默认，只处理新增记录）
FEISHU_APP_SECRET=*** node scripts/sync_koufen.js

# 全量（清空重建，重置状态文件）
FEISHU_APP_SECRET=*** node scripts/sync_koufen.js --full
```

## 流程

1. 读取本地 `memory/koufen_state.json` → 获取已处理 record_id 集合
2. 读取源表 `tbl5sjvBhkzeXuBq` → 筛选 `终检结果` 有值且不在已处理集合的记录
3. 仅对新记录提取扣分项（遍历 DEDUCTION_MAP 中的 45 个扣分字段）
4. 防重复：检查目标表中是否已有相同 `原始记录ID + 不合格项` 组合
5. 写入目标表 `tblOx1ORipiEVFw1`
6. 更新状态文件，记录新处理的 record_id
7. 输出报告：新增N条、跳过N条、孤儿N条、总条数、总分值

## 去重键

目标表自然主键：`原始记录ID` + `不合格项`

## 孤儿处理

目标表中有但源表中已无对应记录 → 列出但不自动删除。

## 字段映射

`scripts/sync_koufen.js` 的 `DEDUCTION_MAP` 包含完整映射（钳工27+配电板13+电工5）。

### 新增扣分字段

1. 确认新字段在源表中的标题名
2. 确定工段归属
3. 定义不合格项描述
4. 在 `DEDUCTION_MAP` 添加条目

## 首次初始化

已有数据的初始化状态文件：`scripts/init_state.js`，读取源表所有 `终检结果` 有值的记录 ID 写入状态文件。

## 依赖

- Node.js ≥ 14
- 飞书应用凭证（环境变量 `FEISHU_APP_SECRET`）
- `memory/koufen_state.json`（自动创建）

## 表标识

- 源表: `tbl5sjvBhkzeXuBq` | 目标表: `tblOx1ORipiEVFw1`
- app_token: `UxiFbg…ynHf`
