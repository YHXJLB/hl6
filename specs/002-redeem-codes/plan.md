# Implementation Plan: 兑换码（Redeem Codes）

**Branch**: `002-redeem-codes` | **Date**: 2026-07-23 | **Spec**: [specs/002-redeem-codes/spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-redeem-codes/spec.md`

## Summary

为 HL6 增加兑换码运营能力：管理员在运营「兑换码」页创建码（积分奖励或永久切换用户组，二选一），配置受众（全员/指定用户/指定用户组）、次数与可选有效期，支持自定义码与批量一次性码；用户在积分页兑换。发奖复用既有 `GrantCredits` 与用户组更新；用户侧失败统一笼统错误；创建后除上下架（及过期码重新上架清有效期）外字段不可变。

技术路径见 [research.md](./research.md)；表结构见 [data-model.md](./data-model.md)；HTTP 合同见 [contracts/redeem-code-api-contract.md](./contracts/redeem-code-api-contract.md)。

## Technical Context

**Language/Version**: Go（后端，与仓库现行版本一致），TypeScript + React 19（前端）  
**Primary Dependencies**: Gin、GORM、PostgreSQL driver、TanStack React Query、i18next、既有 Shadcn UI  
**Storage**: PostgreSQL 16（GORM AutoMigrate 新增 `redeem_codes`、`redeem_code_redemptions`）  
**Testing**: 按项目约束本阶段不新增单元测试、不跑编译；以 [quickstart.md](./quickstart.md) 手工验收  
**Target Platform**: Linux/macOS 上的 Go API + 现代浏览器 React SPA  
**Project Type**: web（`server` + `web` 单仓）  
**Performance Goals**: 单次兑换在正常负载下于数秒内返回明确成功/笼统失败；总次数剩余 1 时并发不超兑  
**Constraints**: 安全优先（用户侧不泄露失败原因）；码字符集与大小写规则；创建后不可变；批量默认 10、上限 200、码长 5 纯英文；积分必须为正（支持一位小数）  
**Scale/Scope**: 2 张新表；用户 1 个兑换 API；管理创建/批量/列表/上下架/记录；1 个用户页入口 + 1 个运营 tab

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

对照 `.specify/memory/constitution.md`：

| 原则 | 结论 |
|---|---|
| I. 质量、安全与体验 | **PASS** — 笼统错误、事务发奖、并发行锁、封禁沿用既有中间件 |
| II. 简洁实现与合理复用 | **PASS** — 复用 GrantCredits、用户组更新、通知受众交互模式；无新服务进程 |
| III. 以用户为中心的前端体验 | **PASS** — 积分页兑换、大写展示、toast/i18n；管理端运营 tab |
| IV. 模糊需求先澄清 | **PASS** — spec Clarifications 已闭合，无 NEEDS CLARIFICATION |
| 方案规范（目标用户/主流程/边界/验收） | **PASS** — spec + quickstart 覆盖 |
| 安全先行 / 边界守卫 | **PASS** — 不扩展售卖/期限会员等范围 |

**Phase 0 前预检**：**PASS**  
**Phase 1 设计后复检**：**PASS**（未引入与宪章冲突的额外抽象；受众首版可复制通知 UI，抽取为可选后续）

## Project Structure

### Documentation (this feature)

```text
specs/002-redeem-codes/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── redeem-code-api-contract.md
├── checklists/
│   └── requirements.md
└── spec.md
```

### Source Code (repository root)

```text
server/
├── cmd/server/                 # AutoMigrate 注册新模型
└── internal/
    ├── handler/                # redeem_code.go（用户+管理）或拆分 admin
    ├── model/                  # redeem_code.go
    ├── repository/             # redeem_code.go
    └── router/                 # routes_credit.go / routes_admin.go / handlers.go

web/
└── src/
    ├── hooks/                  # use-redeem-codes.ts
    ├── lib/api.ts              # 客户端方法
    ├── pages/
    │   ├── credits.tsx         # 兑换入口
    │   └── admin/
    │       ├── users.tsx       # 新增 tab
    │       └── redeem-codes.tsx
    ├── types/
    └── i18n/                   # 6 语言键
```

**Structure Decision**: 不新增独立微服务或包；严格落在现有 `server/internal` 与 `web/src` 分层。兑换写路径放 repository 事务；HTTP 合同集中在 `contracts/`。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
