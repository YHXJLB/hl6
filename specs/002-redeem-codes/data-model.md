# Phase 1 Data Model: 兑换码（Redeem Codes）

## 1. RedeemCode（新增表 `redeem_codes`）

| 字段 | 类型 | 说明 | 约束 |
|---|---|---|---|
| `id` | uint | 主键 | PK |
| `code_normalized` | varchar(64) | 匹配用归一化串 | 必填；英文大写；创建时在「生效中」集合内唯一（应用层） |
| `code_display` | varchar(64) | 管理/展示用（英文大写） | 必填；与输入/生成结果一致 |
| `reward_type` | varchar(16) | `credits` \| `group` | 必填 |
| `credit_amount` | bigint | 内部积分单位（`model.Credit`） | `reward_type=credits` 时必填且 > 0；否则 NULL |
| `target_group_id` | uint | 目标用户组 | `reward_type=group` 时必填；FK → `user_groups.id`（创建时存在；兑换时再校验） |
| `audience_type` | varchar(16) | `all` \| `users` \| `groups` | 必填 |
| `audience_ids` | jsonb | 用户 ID 或组 ID 列表 | `all` 时为空数组/`null`；`users`/`groups` 时非空数组 |
| `max_per_user` | int | 每人最大成功次数 | 可空 = 不限制；若填必须 ≥ 1 |
| `max_total` | int | 总最大成功次数 | 可空 = 不限制；批量码固定 `1`；若填必须 ≥ 1 |
| `redeemed_count` | int | 已成功总次数 | 默认 0；仅成功兑换递增 |
| `expires_at` | timestamptz | 有效期截止 | 可空 = 永久；比较用服务器当前时间 |
| `listed` | bool | 是否上架 | 默认 `true`；`false` = 下架 |
| `batch_id` | uuid | 批量生成批次 | 可空；单码创建为空 |
| `created_by` | uint | 创建管理员 | 必填；FK → `users.id` |
| `created_at` | timestamptz | 创建时间 | 自动 |
| `updated_at` | timestamptz | 更新时间 | 自动（上下架/过期上架清期时更新） |

### 校验规则（创建时）

- `reward_type` 与奖励字段互斥完整：积分码禁止带 `target_group_id`；组码禁止带 `credit_amount`。
- `credit_amount`：经 `ParseDisplayCredit(f, false, true)`，且显示值必须 **> 0**（注意：现有 `ParseDisplayCredit` 允许 0，业务层需额外拒绝 0）。
- `audience_type` 与 `audience_ids` 一致；`users`/`groups` 至少 1 个 ID；ID 必须存在。
- 码字符：仅 Unicode 字母与数字（含中文）；禁止标点/符号/空白（首尾 trim 后中间不得有空白）。
- 长度：建议上限 64；批量固定长度 5。
- `code_normalized` 不得与任一「生效中」码冲突。

### 「生效中」判定（唯一性 + 可兑前置）

同时满足：

1. `listed = true`
2. `expires_at IS NULL OR expires_at > now()`
3. `max_total IS NULL OR redeemed_count < max_total`

### 状态流转

```text
[创建] --> listed=true
listed=true --delist--> listed=false
listed=false --relist--> listed=true
  若 relist 时已过期（expires_at != null && expires_at <= now()）：
    同时 expires_at = null
  若仅手动下架且未过期：保留 expires_at
次数用尽 / 过期：不自动改 listed；仅影响可兑与唯一性集合
```

### 不可变字段

创建后不可变：`code_*`、`reward_*`、`target_group_id`、`audience_*`、`max_per_user`、`max_total`、`batch_id`、`created_by`。  
可变：`listed`；以及「过期后 relist」时的 `expires_at → null`；`redeemed_count` 仅由成功兑换递增。

---

## 2. RedeemCodeRedemption（新增表 `redeem_code_redemptions`）

| 字段 | 类型 | 说明 | 约束 |
|---|---|---|---|
| `id` | uint | 主键 | PK |
| `redeem_code_id` | uint | 兑换码 | 必填，FK → `redeem_codes.id`，index |
| `user_id` | uint | 兑换用户 | 必填，FK → `users.id`，index |
| `reward_type` | varchar(16) | 冗余快照 | 与码一致 |
| `credit_amount` | bigint | 积分快照 | 组奖励时 NULL |
| `target_group_id` | uint | 组快照 | 积分奖励时 NULL |
| `group_changed` | bool | 是否实际发生组变更 | 组奖励时有意义；已在目标组则为 `false` |
| `created_at` | timestamptz | 成功时间 | 自动 |

### 校验与并发

- 仅成功兑换插入；失败不写本表。
- 每人次数：兑换前 `COUNT(*) WHERE redeem_code_id AND user_id`；若 `max_per_user` 有值且 count ≥ 上限则失败。
- 建议索引：`(redeem_code_id, user_id)` 非唯一（允许多次，除非 max_per_user=1 时仍靠计数；批量码 max_total=1 已足够）。
- 与 `redeem_codes` 行锁同一事务：锁码行 → 校验 → 发奖/改组 → `redeemed_count++` → 插入 redemption。

---

## 3. 既有实体关系

| 实体 | 关系 |
|---|---|
| `User` | 兑换主体；`audience_type=users` 的受众；积分余额所有者；`group_id` 被组奖励覆盖 |
| `UserGroup` | `target_group_id` 目标；`audience_type=groups` 受众 |
| `CreditBalance` / `CreditTransaction` | 积分类成功兑换时更新/插入（`type` 沿用 grant 习惯，`description_key=txn.redeemCode`） |

---

## 4. 派生/展示字段（非持久化或 API 计算）

| 字段 | 含义 |
|---|---|
| `is_expired` | `expires_at != null && now >= expires_at` |
| `is_exhausted` | `max_total != null && redeemed_count >= max_total` |
| `is_redeemable` | `listed && !is_expired && !is_exhausted`（管理列表展示；用户侧不暴露细分） |
| `effective_for_uniqueness` | 同「生效中」 |

---

## 5. AutoMigrate

在 `server/cmd/server` 既有迁移列表中注册 `RedeemCode`、`RedeemCodeRedemption`。无需独立 SQL 迁移文件（与项目现行 GORM AutoMigrate 一致）。
