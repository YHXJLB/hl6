# Tasks: 兑换码（Redeem Codes）

**Input**: Design documents from `/specs/002-redeem-codes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 按 plan/AGENTS 约束，本列表**不包含**单元测试/编译任务；验收以 quickstart 手工路径为准。

**Organization**: 按用户故事分阶段，便于增量交付与独立验收。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、互不阻塞）
- **[Story]**: US1–US4 对应用户故事
- 描述中含确切文件路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 对齐类型、文案键与装配入口，不引入新依赖

- [ ] T001 在 `web/src/types/index.ts` 增加兑换码相关 TypeScript 类型（`RedeemCode`、`RedeemCodeRedemption`、`RedeemRewardType`、`RedeemAudienceType`、兑换成功响应等），字段对齐 `specs/002-redeem-codes/contracts/redeem-code-api-contract.md`
- [ ] T002 [P] 在 `web/src/i18n/zh.json` 与 `web/src/i18n/en.json` 增加最小文案键：`credits.redeem*`、`adminRedeemCodes.*`、`error.redeemCodeUnavailable`、`txn.redeemCode`（其余 4 语言可先复用英文占位键名）
- [ ] T003 [P] 在 `web/src/lib/api.ts` 预留 API 方法签名占位（`redeemCode`、`adminListRedeemCodes`、`adminCreateRedeemCode`、`adminBatchRedeemCodes`、`adminDelistRedeemCode`、`adminRelistRedeemCode`、`adminListRedeemCodeRedemptions`），暂可抛未实现或空实现待后续任务填充

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 数据模型、归一化工具与仓储基础；完成前不得开始用户故事业务接口

**⚠️ CRITICAL**: 本阶段未完成前，不要实现兑换/创建 HTTP 与页面

- [ ] T004 在 `server/internal/model/redeem_code.go` 实现 `RedeemCode`、`RedeemCodeRedemption` 及常量（`reward_type`/`audience_type`），字段对齐 `specs/002-redeem-codes/data-model.md`
- [ ] T005 在 `server/cmd/server/main.go`（或现有 AutoMigrate 注册处）注册 `RedeemCode`、`RedeemCodeRedemption` 自动迁移
- [ ] T006 [P] 在 `server/internal/model/redeem_code.go` 或 `server/internal/helpers/redeem_code.go` 实现码字符串 `Trim`、字符集校验（字母/数字/中文）、英文大写归一化 `NormalizeRedeemCode`
- [ ] T007 在 `server/internal/repository/redeem_code.go` 实现基础读写：`CreateRedeemCode`、`FindRedeemCodeByNormalized`、`CountActiveConflict`（生效中唯一性）、`LockRedeemCodeByID`（事务内 `FOR UPDATE`）、`CountUserRedemptions`、`InsertRedemption`、`IncrementRedeemedCount`
- [ ] T008 [P] 在 `server/internal/router/handlers.go` 增加 `RedeemCode` handler 字段与构造函数装配（handler 文件可先空壳）

**Checkpoint**: 迁移可建表；归一化与仓储可被上层调用

---

## Phase 3: User Story 1 - 用户在积分页兑换码 (Priority: P1) 🎯 MVP

**Goal**: 已登录用户可在积分页提交兑换码；积分类发奖或用户组覆盖；成功反馈；失败笼统错误

**Independent Test**: DB/管理工具预置一张「全员、积分奖励、上架、未过期」码后，仅用积分页即可兑成功并看到余额与流水变化（见 spec US1）

### Implementation for User Story 1

- [ ] T009 [US1] 在 `server/internal/repository/redeem_code.go` 实现事务方法 `RedeemCodeForUser(userID, normalizedCode)`：行锁 → 校验上架/有效期/总次数/每人次数/受众 → 校验目标组存在（组奖励）→ `GrantCredits` 或更新 `group_id` → 写 `redeem_code_redemptions` → `redeemed_count++`；任一业务失败返回统一内部错误供 handler 映射笼统 key
- [ ] T010 [US1] 在 `server/internal/handler/redeem_code.go` 实现用户 `Redeem`：解析 body `code`、归一化、调用仓储、成功返回合同中的 `data` 形状；业务失败一律 `400` + `error.redeemCodeUnavailable`
- [ ] T011 [US1] 在 `server/internal/router/routes_credit.go` 注册 `POST /credits/redeem`（需登录）
- [ ] T012 [P] [US1] 在 `web/src/lib/api.ts` 实现 `redeemCode(code)` 请求 `POST /api/v1/credits/redeem`
- [ ] T013 [P] [US1] 在 `web/src/hooks/use-credits.ts`（或新建 `web/src/hooks/use-redeem-code.ts`）增加兑换 mutation，成功后 invalidate `credits` / transactions / 用户信息（若组变更需刷新 auth/user）
- [ ] T014 [US1] 在 `web/src/pages/credits.tsx` 增加兑换输入区：输入默认大写展示、提交、成功 toast（积分或组）、失败展示笼统错误文案；样式对齐现有积分页

**Checkpoint**: 预置码可完成用户侧兑换闭环（MVP）

---

## Phase 4: User Story 2 - 管理员创建可配置的兑换码 (Priority: P1)

**Goal**: 运营「兑换码」tab 可创建自定义/单码与批量一次性码（奖励二选一、受众、次数、有效期）

**Independent Test**: 管理员仅用创建表单产出生效码，普通用户可兑该码（spec US2）

### Implementation for User Story 2

- [ ] T015 [US2] 在 `server/internal/handler/redeem_code.go`（或 `redeem_code_admin.go`）实现 `AdminCreate`：校验奖励互斥、正数积分（`ParseDisplayCredit` + `>0`）、受众、次数、字符集、生效中冲突；写入 `redeem_codes`；冲突返回 `409` + `error.redeemCodeConflict`
- [ ] T016 [US2] 实现 `AdminBatchCreate`：`count` 默认 10、上限 200；每码 5 位 `[A-Z]`、`max_total=1`、共享 `batch_id`；碰撞重试后仍失败则整批回滚
- [ ] T017 [US2] 实现 `AdminList`：分页与可选筛选（`listed`/`batch_id`/`q`），返回计算字段 `is_expired`/`is_exhausted`/`is_redeemable`
- [ ] T018 [US2] 在 `server/internal/router/routes_admin.go` 注册 `GET/POST /admin/redeem-codes`、`POST /admin/redeem-codes/batch`
- [ ] T019 [P] [US2] 在 `web/src/lib/api.ts` 补齐管理端创建/批量/列表客户端方法
- [ ] T020 [P] [US2] 在 `web/src/hooks/use-redeem-codes.ts` 实现 `useAdminRedeemCodes`、`useAdminCreateRedeemCode`、`useAdminBatchRedeemCodes`
- [ ] T021 [US2] 新建 `web/src/pages/admin/redeem-codes.tsx`：列表 + 创建对话框（奖励二选一、受众 `all|users|groups` 对齐 `web/src/pages/admin/notifications.tsx` 邮箱搜索多选、次数可空、有效期可选、自定义码输入、批量生成入口）
- [ ] T022 [US2] 在 `web/src/pages/admin/users.tsx` 增加 tab `redeem-codes` 与 `TabsTrigger`/`TabsContent`，挂载 `RedeemCodesContent`；同步 tab 白名单与 i18n `adminUsers.tabRedeemCodes`
- [ ] T023 [P] [US2] 补齐 `web/src/i18n/es.json`、`ja.json`、`ru.json`、`zh-Hant.json` 中 `adminRedeemCodes.*` / 相关 error 键（可先英文）

**Checkpoint**: 管理员可自助创建/批量码，用户可兑

---

## Phase 5: User Story 3 - 管理员上下架与兑换记录 (Priority: P2)

**Goal**: 下架/重新上架（过期上架清有效期）；查看成功兑换记录；无通用编辑接口

**Independent Test**: 下架后用户不可兑；未过期再上架可兑；过期再上架变永久；记录页可见成功明细（spec US3）

### Implementation for User Story 3

- [ ] T024 [US3] 在 `server/internal/handler/redeem_code.go` 实现 `AdminDelist`、`AdminRelist`（过期则 `expires_at=null`；不重置 `redeemed_count`）；**不**提供 PUT/PATCH 更新接口
- [ ] T025 [US3] 实现 `AdminListRedemptions`：分页返回用户邮箱、时间、奖励摘要、`group_changed`
- [ ] T026 [US3] 在 `server/internal/router/routes_admin.go` 注册 `POST /admin/redeem-codes/:id/delist`、`POST .../relist`、`GET .../redemptions`
- [ ] T027 [P] [US3] 在 `web/src/lib/api.ts` 与 `web/src/hooks/use-redeem-codes.ts` 增加 delist/relist/redemptions 方法与 hooks
- [ ] T028 [US3] 在 `web/src/pages/admin/redeem-codes.tsx` 增加上下架操作、状态徽章（过期/下架/用尽）、兑换记录抽屉/对话框；确认无编辑码串/受众/次数/奖励/有效期的入口

**Checkpoint**: 运营可纠错上下架并审计成功兑换

---

## Phase 6: User Story 4 - 失败与安全一致体验 (Priority: P2)

**Goal**: 用户侧各类不可兑原因统一笼统错误；管理侧仍展示真实状态

**Independent Test**: 过期/下架/无权限/次数用尽/目标组缺失/随机无效码 → 用户侧同一文案；管理列表字段可区分（spec US4）

### Implementation for User Story 4

- [ ] T029 [US4] 审查并收敛 `server/internal/handler/redeem_code.go` 用户 `Redeem` 所有业务失败分支，确保仅映射 `error.redeemCodeUnavailable`，响应 `data` 不泄露原因细分
- [ ] T030 [US4] 确认 `AdminList` 计算字段与原始字段足以区分过期、下架、用尽、受众类型；必要时在 `web/src/pages/admin/redeem-codes.tsx` 补齐状态列展示
- [ ] T031 [P] [US4] 在全部 `web/src/i18n/*.json` 统一用户失败文案语义为「兑换码无效或不可用」（各语言等价表述）

**Checkpoint**: 安全提示策略与管理可观测性同时满足

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 跨故事收尾与手工验收

- [ ] T032 [P] 在积分流水前端展示路径确认 `txn.redeemCode` 有可读翻译（`web/src/pages/credits.tsx` / 流水渲染组件与 i18n）
- [ ] T033 按 `specs/002-redeem-codes/quickstart.md` 场景 A–E、G 做手工验收并记录缺口（并发 F 可选）
- [ ] T034 [P] 检查封禁用户无法调用 `POST /credits/redeem`（沿用既有 auth/ban 中间件，不新增旁路）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup** → **Phase 2 Foundational**（阻塞所有故事）
- **US1 / US2**：Foundational 完成后可并行；建议先 US1（可用 SQL 预置码验兑换），再 US2（运营创建）
- **US3**：依赖 US2 列表/创建页已存在（挂载上下架与记录 UI）
- **US4**：依赖 US1 兑换路径；建议在 US2/US3 状态字段就绪后做最终收敛
- **Polish**：依赖计划验收的故事完成

### User Story Dependencies

| Story | 依赖 |
|---|---|
| US1 | Phase 2；验收可用手工预置码 |
| US2 | Phase 2；与 US1 后端兑换对接验证完整闭环 |
| US3 | US2 管理页与列表 API |
| US4 | US1 错误路径 + US2/US3 管理状态展示 |

### Parallel Opportunities

- T002/T003；T006/T008；T012/T013；T019/T020/T023；T027；T031/T032/T034
- Foundational 完成后：一人做 US1 前端、一人做 US2 管理 API（若分人）

---

## Parallel Example: User Story 1

```bash
# US1 前端可并行（在 T011 路由就绪后）：
Task: "T012 实现 web/src/lib/api.ts redeemCode"
Task: "T013 实现兑换 mutation hook"

# 然后串行：
Task: "T014 改造 web/src/pages/credits.tsx 兑换 UI"
```

## Parallel Example: User Story 2

```bash
# 管理 API 客户端与 hooks 可并行：
Task: "T019 web/src/lib/api.ts 管理方法"
Task: "T020 web/src/hooks/use-redeem-codes.ts"
Task: "T023 其余语言 i18n 键"
```

---

## Implementation Strategy

### MVP First（仅 US1）

1. Phase 1 + Phase 2  
2. Phase 3 US1（SQL 预置一张全员积分码）  
3. **STOP**：按 Independent Test 验收积分页兑换  

### 推荐增量交付

1. MVP：US1 兑换  
2. US2：运营可创建/批量 → 去掉手工预置依赖  
3. US3：上下架 + 记录  
4. US4 + Polish：安全文案收敛与 quickstart 全量验收  

### Suggested MVP Scope

**仅 Phase 1–3（T001–T014）**：用户兑换闭环。  
完整运营能力需继续 US2+。

---

## Notes

- 不新增单元测试任务；不跑 `go test`/`npm run build`（除非用户另行要求）
- 禁止实现通用 `PUT/PATCH /admin/redeem-codes/:id`
- 批量码强制 `max_total=1`；自定义码 `max_*` 空=不限制
- 每个 checkpoint 都可对照 `quickstart.md` 对应场景验收
