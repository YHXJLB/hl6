# Redeem Code API Contract (Phase 1)

## 1. 范围

定义兑换码特性对外 HTTP 合同：

- 用户：提交兑换码
- 管理员：创建单码、批量生成、列表、下架/上架、查看成功兑换记录

统一响应：`ApiResponse{code, message, message_key?, data}`；列表用既有分页结构。

---

## 2. 枚举与公共规则

### 2.1 枚举

| 字段 | 值 |
|---|---|
| `reward_type` | `credits` \| `group` |
| `audience_type` | `all` \| `users` \| `groups` |

### 2.2 码字符

- 允许：Unicode 字母、数字（含中文）
- 禁止：标点、符号、空白（提交前 trim；中间空白非法）
- 匹配：大小写不敏感（英文归一为大写）
- 最大长度：64；批量生成固定 5 位 `[A-Z]{5}`

### 2.3 用户侧笼统错误

所有业务不可兑失败（含格式以外已达服务端的业务失败）：

- HTTP：`400`
- `message_key`：`error.redeemCodeUnavailable`
- 用户可见语义：兑换码无效或不可用
- **不得**在 `message`/`data` 中区分具体原因

封禁用户等系统拒绝仍走既有中间件/鉴权错误，不进入上述码业务分支。

---

## 3. 用户接口

### 3.1 兑换

- `POST /api/v1/credits/redeem`
- Auth: 登录用户

Request:

```json
{
  "code": "ABCDE"
}
```

Validation:

- `code` 必填；trim 后非空；符合字符规则（否则可仍返回笼统错误）。

Success `data`（积分类示例）：

```json
{
  "reward_type": "credits",
  "credit_amount": 10.5,
  "balance": 120.5
}
```

Success `data`（用户组类示例）：

```json
{
  "reward_type": "group",
  "target_group_id": 2,
  "target_group_name": "高级用户",
  "group_changed": true
}
```

行为要点：

- 已在目标组：`group_changed=false`，仍算成功。
- 积分类：写流水 `txn.redeemCode`。
- 并发安全：不得超总次数/每人次数。

---

## 4. 管理员接口

Auth: 管理员。

### 4.1 列表兑换码

- `GET /api/v1/admin/redeem-codes`
- Query：`page`、`per_page`；可选 `listed`、`batch_id`、`q`（码字符串模糊）

`data.items[]` 建议字段：

- `id`, `code_display`, `reward_type`, `credit_amount`, `target_group_id`, `target_group_name`
- `audience_type`, `audience_ids`
- `max_per_user`, `max_total`, `redeemed_count`
- `expires_at`, `listed`
- `is_expired`, `is_exhausted`, `is_redeemable`（计算字段）
- `batch_id`, `created_by`, `created_at`, `updated_at`

### 4.2 创建单码 / 自定义码

- `POST /api/v1/admin/redeem-codes`

Request:

```json
{
  "code": "春季活动",
  "reward_type": "credits",
  "credit_amount": 10.5,
  "audience_type": "all",
  "audience_ids": [],
  "max_per_user": 1,
  "max_total": 100,
  "expires_at": "2026-12-31T15:59:59Z"
}
```

或组奖励：

```json
{
  "code": "VIP2026",
  "reward_type": "group",
  "target_group_id": 2,
  "audience_type": "users",
  "audience_ids": [3, 9],
  "max_per_user": null,
  "max_total": null,
  "expires_at": null
}
```

Validation：

- `reward_type` 二选一及对应必填字段；`credit_amount` 显示值 > 0。
- `audience_*` 互斥规则；`users`/`groups` 的 ID 必须存在。
- `max_*` 省略或 `null` = 不限制；若提供必须为整数 ≥ 1。
- `code` 符合字符规则；与生效中码冲突则 `409` + 明确管理端错误键（如 `error.redeemCodeConflict`）。
- 创建成功后字段不可再经 API 修改（无通用 PUT）。

### 4.3 批量生成

- `POST /api/v1/admin/redeem-codes/batch`

Request:

```json
{
  "count": 10,
  "reward_type": "credits",
  "credit_amount": 5,
  "audience_type": "groups",
  "audience_ids": [1, 2],
  "max_per_user": 1,
  "expires_at": null
}
```

规则：

- `count` 默认 10；范围 1～200。
- 每码：`code` 自动生成 5 位纯英文大写；`max_total` **强制为 1**（请求体若传其他值忽略或拒绝，推荐忽略并强制）。
- 同批共享 `batch_id`。
- 成功返回创建出的码列表（含 `code_display`）。

### 4.4 下架

- `POST /api/v1/admin/redeem-codes/:id/delist`
- 将 `listed=false`；已是下架可幂等成功。

### 4.5 重新上架

- `POST /api/v1/admin/redeem-codes/:id/relist`
- 将 `listed=true`。
- 若上架前已过期：`expires_at` 置 `null`。
- 不重置 `redeemed_count`。
- 次数已用尽时允许 `listed=true`，但用户仍不可兑（管理列表 `is_exhausted=true`）。

### 4.6 兑换记录

- `GET /api/v1/admin/redeem-codes/:id/redemptions`
- Query：分页

`items[]`：

- `id`, `user_id`, `user_email`, `reward_type`, `credit_amount`, `target_group_id`, `group_changed`, `created_at`

---

## 5. 明确不提供的接口

- `PUT/PATCH /admin/redeem-codes/:id`（禁止改码串/受众/次数/奖励/有效期）
- 用户查询某码是否有效的探测接口
- 失败兑换列表（MVP 不要求）

---

## 6. i18n message keys（最小集）

| key | 用途 |
|---|---|
| `error.redeemCodeUnavailable` | 用户兑换笼统失败 |
| `error.redeemCodeConflict` | 管理端码冲突 |
| `error.redeemCodeInvalidReward` | 管理端奖励非法 |
| `error.redeemCodeInvalidAudience` | 管理端受众非法 |
| `txn.redeemCode` | 积分流水描述 |
| `credits.redeem*` / `adminRedeemCodes.*` | 前后端文案命名空间 |
