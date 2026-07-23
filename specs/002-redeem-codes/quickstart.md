# Quickstart: 兑换码功能验收

## 1. 前置条件

- 分支：`002-redeem-codes`
- 规格：[`spec.md`](./spec.md)、合同：[`contracts/redeem-code-api-contract.md`](./contracts/redeem-code-api-contract.md)、模型：[`data-model.md`](./data-model.md)
- 环境：`make db-up` + 后端 + 前端开发栈；管理员与至少 2 个普通用户账号；至少 2 个用户组

---

## 2. 后端实施检查清单（对照实现，非运行测试套件）

1. 新增模型 `RedeemCode`、`RedeemCodeRedemption`，并加入 AutoMigrate。
2. Repository：按归一化码查询、生效中冲突检测、事务内行锁兑换、批量插入。
3. Handler：
   - 用户 `POST /api/v1/credits/redeem`
   - 管理 `GET/POST /api/v1/admin/redeem-codes`、`POST .../batch`、`.../delist`、`.../relist`、`GET .../redemptions`
4. 路由注册于 `routes_credit.go` 与 `routes_admin.go`；Handlers 装配。
5. 积分成功路径调用 `GrantCredits(..., "txn.redeemCode", ...)`；组路径更新 `group_id`。
6. 用户失败统一 `error.redeemCodeUnavailable`。

---

## 3. 前端实施检查清单

1. 积分页增加兑换输入（大写展示）与成功/笼统失败 toast。
2. 运营页 `users.tsx` 增加 `redeem-codes` tab 与列表/创建/批量/上下架/记录查看。
3. 受众 UI 对齐通知：`all | users | groups` + 邮箱搜索多选。
4. i18n 键补齐（至少 zh + en）。

---

## 4. 手工验收场景

### A. 积分码快乐路径

1. 管理员创建：自定义码 `TEST10`，奖励积分 `10`（或 `10.5`），受众无限制，总次数 `100`，每人 `1`，无有效期。
2. 用户 A 在积分页输入 `test10` → 成功；余额 +10（或 +10.5）；流水可见。
3. 用户 A 再次兑换 → 笼统失败。
4. 用户 B 兑换 → 成功。

### B. 用户组码与「已在目标组」

1. 创建组奖励码，目标组 =「高级用户」，受众无限制，总次数 `10`。
2. 用户（不在高级组）兑换 → 组变为高级用户，`group_changed` 语义成功。
3. 同一用户（已在高级组）再兑另一张同目标组新码 → 成功且消耗次数；组不变。

### C. 权限与笼统错误

1. 创建仅允许用户 A 邮箱对应账号的码。
2. 用户 B 兑换 → 与随机无效码、已下架码相同笼统提示。
3. 管理员列表仍能看到 listed/受众等真实状态。

### D. 批量一次性码

1. 批量生成 `count=10`，确认码长 5 位纯英文。
2. 每码仅能成功兑 1 次；第二次笼统失败。

### E. 有效期与上下架

1. 创建带过去时间的有效期码（或将系统时间视为已过期的码）→ 用户不可兑。
2. 下架生效码 → 用户不可兑；未过期时重新上架 → 可兑且有效期保留。
3. 对已过期码执行重新上架 → 可兑且无有效期；管理端无编辑有效期入口。

### F. 并发（可选抽测）

1. 总次数=1 的码，两用户几乎同时兑换 → 仅 1 次成功，无超发积分。

### G. 不可变约束

1. 确认无「编辑码/受众/次数/奖励/有效期」的管理 API/UI；仅上下架。

---

## 5. 预期结果摘要

| 场景 | 预期 |
|---|---|
| 有效积分码 | 余额与流水正确 |
| 有效组码 | 组覆盖；已在组仍成功并占次数 |
| 各类失败 | 用户侧同一文案 |
| 批量码 | 5 位英文，一码一次 |
| 过期后上架 | 清除有效期 |
| 次数用尽 | 不可靠上架重置 |

---

## 6. 验收记录（T033 · 2026-07-23）

实现阶段本地未起完整栈，按代码路径对照 quickstart A–E、G（F 可选未跑）。结论：**代码路径覆盖完整，无阻塞缺口**；建议上线前用真实账号补跑一遍 UI。

| 场景 | 代码路径结论 | 缺口 |
|---|---|---|
| A 积分码快乐路径 | 创建校验 + `RedeemCodeForUser`/`GrantCredits` + 积分页大写输入 + `txn.redeemCode` 流水文案 | 需 live：余额/流水 UI 目视 |
| B 用户组码 | 组奖励更新 `group_id`；已在目标组仍成功且 `group_changed=false` | 需 live：组切换目视 |
| C 权限与笼统错误 | 受众校验失败与无效码均 `error.redeemCodeUnavailable`；管理列表保留真实状态字段 | 无 |
| D 批量一次性码 | batch 强制 `max_total=1`、5 位 A–Z、碰撞重试 | 需 live：批量结果列表目视 |
| E 有效期与上下架 | 过期不可兑；delist/relist；过期 relist 清 `expires_at` | 需 live：过期码操作目视 |
| G 不可变约束 | 无 PUT/PATCH 路由；管理 UI 仅上下架/记录，无编辑入口 | 无 |
| 封禁（T034） | `auth.Required` + `IsBanned` 拦截；`/credits/redeem` 不在白名单 | 无 |
| F 并发（可选） | 生效行 `FOR UPDATE` + `redeemed_count` 递增 | 未抽测 |
