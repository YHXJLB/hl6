# Phase 0 Research: 兑换码（Redeem Codes）

## 决策 1：奖励发放复用现有积分与用户组写路径

### Decision

- 积分类兑换：在同一 DB 事务内调用既有 `Repository.GrantCredits`，`description_key` 使用 `txn.redeemCode`，params 携带脱敏后的码摘要（或码 ID）。
- 用户组类兑换：在同一事务内调用既有 `Repository.UpdateUserGroupID`（或等价更新）；已在目标组时跳过 UPDATE，但仍插入兑换记录并计入次数。
- 不新建独立「钱包」或「会员期限」子系统。

### Rationale

- 与规格 FR-003/FR-004 一致，符合宪章「简洁实现与合理复用」。
- 现有 `Credit` 类型已支持一位小数展示（内部 0.1 精度），满足「正数可含小数」。

### Alternatives considered

- 单独积分渠道表：增加复杂度，无额外业务价值。
- 用户组切换走管理员 HTTP 内部调用：多余一层，事务边界更难保证。

---

## 决策 2：数据模型采用「兑换码主表 + 成功兑换记录表」，受众用 JSON 列表

### Decision

- 新增 `redeem_codes` 与 `redeem_code_redemptions`。
- 受众对齐通知模型：`audience_type` ∈ {`all`,`users`,`groups`} + `audience_ids` JSON 数组（用户 ID 或用户组 ID）。
- 不单独建受众关联表（MVP 规模下 JSON 足够；创建后不可改受众，无频繁更新压力）。
- 总次数：维护 `redeemed_count` 计数器，兑换事务内 `SELECT … FOR UPDATE` 主行后递增；每人次数：按 `redeem_code_redemptions` 计数（或唯一约束 + 应用层校验）。

### Rationale

- 通知模块已验证 `target_type` + `target_ids` 模式，前后端可复用交互心智。
- 行锁保证「总次数剩余 1」并发不超兑。

### Alternatives considered

- `redeem_code_audience_users` / `_groups` 关联表：可查询性更好，但对「创建后不可改」的 MVP 过重。
- 仅靠兑换记录 COUNT 做总上限：高并发下需锁码行或可串行化隔离，仍需锁主行，计数器更直观。

---

## 决策 3：码字符串归一化与「生效中」唯一性在应用层校验

### Decision

- 持久化 `code_raw`（管理员输入或生成时的展示形，英文大写）与 `code_normalized`（用于匹配：英文大写；去除首尾空白；中文保持原字形）。
- 用户提交：trim → 校验字符集 → normalize → 查找。
- 「当前生效中」唯一性（创建时）：查询满足「已上架 ∧ 未过期 ∧ 总次数未用尽」且 `code_normalized` 相同的行；存在则拒绝。
- **不**对 `code_normalized` 做全局唯一索引（因失效后允许复用）。

### Rationale

- 与规格 FR-017～FR-021 一致。
- 部分唯一索引难以同时表达「未过期 + 未用尽 + 上架」的动态条件。

### Alternatives considered

- 全局唯一索引：与「失效可复用」冲突。
- 软删除旧码改名释放唯一键：运营心智差，且与下架语义重复。

---

## 决策 4：用户侧统一笼统错误；管理侧保留真实状态

### Decision

- 用户兑换业务失败统一：`message_key = error.redeemCodeUnavailable`（文案：「兑换码无效或不可用」），HTTP 建议 `400`（与项目其它业务拒绝一致时也可 `403`；选定 **400** 以免与封禁 403 混淆）。
- 覆盖：不存在、过期、下架、无权限、总/每人次数用尽、目标组缺失等。
- 输入字符集非法：可在前端拦截；服务端仍校验，非法格式可用同一笼统 key 或单独 `error.redeemCodeInvalidFormat`（研究结论：**服务端格式错误亦并入笼统 key**，减少枚举面；前端可本地提示格式以改善 UX）。
- 管理 API 返回明确字段：`status`、`expires_at`、`redeemed_count`、`max_total` 等。

### Rationale

- FR-031 安全要求；宪章「安全先行」。
- 与封禁等系统级 403 区分，避免前端把「码无效」当成账号问题。

### Alternatives considered

- 细分错误码给用户：便于客服但利于枚举探测，否决。
- 全部 404：暗示「是否存在」，否决。

---

## 决策 5：创建后不可变字段；上下架与「过期后重新上架清有效期」为仅有可变路径

### Decision

- 不提供通用 Update API；仅：
  - `POST .../delist`
  - `POST .../relist`（若当前已过期：将 `expires_at` 置 `null`；若仅手动下架且未过期：保留原 `expires_at`）
- 次数用尽不可通过 relist 重置 `redeemed_count`。

### Rationale

- 直接落实 FR-024～FR-027，减少误改与纠纷。

### Alternatives considered

- 完整编辑接口 + 前端禁用：后端仍可能被直接调用，否决。

---

## 决策 6：批量生成与自定义创建拆分接口，批量码强制 max_total=1

### Decision

- `POST /admin/redeem-codes`：单码/自定义（可配置 `max_per_user` / `max_total`，空=不限制）。
- `POST /admin/redeem-codes/batch`：生成 N 个码（默认 N=10，上限 200），每码 5 位 A–Z，强制 `max_total=1`，`max_per_user` 可省略（等价 1）。
- 批量共享同一 `batch_id`（UUID）便于列表筛选。
- 生成碰撞：事务内重试（上限例如 20 次/码），仍失败则整批回滚并报错。

### Rationale

- 与规格生成方式及 Assumptions 一致。
- 拆分接口避免单接口分支过多导致校验遗漏。

### Alternatives considered

- 单一 create + `mode` 字段：可行但校验矩阵更易出错；本期选拆分。

---

## 决策 7：前端落点与受众 UI 复用

### Decision

- 用户：`web/src/pages/credits.tsx` 增加兑换表单 + hook `useRedeemCode`。
- 管理：`web/src/pages/admin/users.tsx` 增加 tab `redeem-codes`，内容组件 `redeem-codes.tsx`（或 `components/` 下拆分对话框）。
- 受众选择：复刻 `notifications.tsx` 的 `all|users|groups` + 邮箱搜索多选模式（可抽小组件，但宪章要求先证明值得抽取；**首版允许复制后小步抽取**）。
- i18n：6 语言键补齐（至少 zh/en 完整，其余语言同步键名，文案可先英/中后备）。

### Rationale

- 规格入口明确；通知页已是受众选择标准。

### Alternatives considered

- 独立顶级管理路由：破坏「运营」信息架构，否决。

---

## 决策 8：测试与交付约束

### Decision

- 遵循项目 AGENTS 约束：本特性实现阶段**不写单元测试、不跑编译**（除非用户另行要求）。
- 验收以 `quickstart.md` 手工路径为准。

### Rationale

- 与仓库开发要求及既有 `001` 计划一致。

### Alternatives considered

- 为并发超兑补集成测试：有价值，但不在默认交付约束内；可列可选后续。
