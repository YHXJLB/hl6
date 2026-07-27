# HL6 Docker Compose 快速部署

本文用于生产/准生产环境快速拉起 HL6 全栈（`app + postgres`），使用镜像：

- `ghcr.io/yhxjlb/hl6:latest`（GitHub Container Registry，**公开包**，可匿名 `docker pull`，无需登录）

## 0. 关于 ghcr.io 登录（公开包无需登录）

镜像包已设为**公开（public）**，在服务器上拉取时**不需要** `docker login`，直接 `docker pull ghcr.io/yhxjlb/hl6:latest` 即可。

仅在以下场景才需要登录：

- 你要向 ghcr.io **推送**自己的镜像（需要 `write:packages` 权限的 token）；
- 或镜像包被改回了私有（此时拉取需 `read:packages` 权限的 token）。

登录命令（如确实需要）：

```bash
docker login ghcr.io -u YHXJLB -p <TOKEN>
```

> **把包改成公开（GitHub 限制）**：GitHub 目前**不提供**修改包可见性的 REST API（官方文档已无此端点，相关 PATCH 调用一律返回 404）。所以只能到 Web UI 手动点一次：
> 进入 GitHub → 右上角头像 → **Your packages** → `hl6` → **Package settings** → **Change visibility** → 选 **Public** → **Save**。
> 设成公开后，上面的匿名拉取立即生效。仓库 `YHXJLB/hl6` 已经是 public，与包可见性相互独立，互不影响。

## 1. 准备 `docker-compose.prod.yml`

```yaml
services:
  app:
    image: ${IMAGE:-ghcr.io/yhxjlb/hl6:latest}
    container_name: hl6-app
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "${APP_PORT:-8080}:8080"
    environment:
      SERVER_PORT: "8080"
      APP_URL: "${APP_URL:-}"
      FRONTEND_URL: "${FRONTEND_URL:-}"
      BACKEND_URL: "${BACKEND_URL:-}"
      ALLOWED_ORIGINS: "${ALLOWED_ORIGINS:-}"
      DATABASE_URL: "postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable"
      SESSION_SECRET: "${SESSION_SECRET:-}"

      # 高级选填（默认留空）
      OIDC_ISSUER: "${OIDC_ISSUER:-}"
      OIDC_CLIENT_ID: "${OIDC_CLIENT_ID:-}"
      OIDC_CLIENT_SECRET: "${OIDC_CLIENT_SECRET:-}"
      ENCRYPTION_KEY: "${ENCRYPTION_KEY:-}"

  postgres:
    image: postgres:16-alpine
    container_name: hl6-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: "${POSTGRES_DB}"
      POSTGRES_USER: "${POSTGRES_USER}"
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
```

## 2. 准备 `.env`

```dotenv
# 访问端口（宿主机）
APP_PORT=8080

# 镜像（默认 ghcr.io/yhxjlb/hl6:latest；如需使用其它镜像源可在此覆盖）
IMAGE=ghcr.io/yhxjlb/hl6:latest

# 公网访问地址（同域部署建议填写）
APP_URL=https://hl6.example.com
ALLOWED_ORIGINS=https://hl6.example.com

# 数据库
POSTGRES_DB=hl6
POSTGRES_USER=hl6
POSTGRES_PASSWORD=please-change-this-password

# 可选：首次启动种子。留空时自动生成并写入数据库 _internal_session_secret
SESSION_SECRET=

# 可选：不填则 FRONTEND/BACKEND 回退到 APP_URL（若 APP_URL 也为空，则走数据库/自动探测）
FRONTEND_URL=
BACKEND_URL=

# ------------------------------
# 高级选填（默认不填）
# ------------------------------

# OIDC：字段级优先级 env > database。填了就以 env 为准。
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=

# 64 位十六进制（32 字节）AES-256-GCM 密钥。不填时敏感配置按明文存储。
ENCRYPTION_KEY=
```

## 3. 启动

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml --env-file .env logs -f app
```

启动后访问：

- `APP_URL`（如果你填写了）
- 或 `http://<服务器IP>:<APP_PORT>`

## 4. 高级选填项的运行时优先级（关键）

以下行为来自当前后端实现：

1. `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`  
每个字段独立按 `环境变量 > 数据库` 取值。某字段一旦在 env 里有值，该字段数据库值会被忽略，且后台不允许覆盖该字段。

2. `FRONTEND_URL` / `BACKEND_URL` / `APP_URL`  
URL 运行时优先级为：`FRONTEND_URL/BACKEND_URL（APP_URL 兜底） > 数据库 > 自动探测并落库`。  
当 env 中提供了这些 URL（包括仅提供 `APP_URL` 的场景）时，数据库 URL 配置不会生效，后台也不能修改该 URL 配置。

3. `ENCRYPTION_KEY`  
仅从环境变量读取，不从数据库读取。填写后会用于加解密数据库中的敏感字段（例如 OIDC Client Secret、Cloudflare Token）；不填则按明文处理。

## 5. 升级与停止

升级到最新镜像：

```bash
docker compose -f docker-compose.prod.yml --env-file .env pull app
docker compose -f docker-compose.prod.yml --env-file .env up -d app
```

停止：

```bash
docker compose -f docker-compose.prod.yml --env-file .env down
```

删除容器并同时清理数据库卷（危险）：

```bash
docker compose -f docker-compose.prod.yml --env-file .env down -v
```

## 6. 常见注意事项

- 全新安装时，如果 OIDC 三项都留空且系统里还没有用户，可在登录页通过初始化向导完成 OIDC 配置。
- 首个注册用户会自动成为管理员。
- `ENCRYPTION_KEY` 建议首次部署就确定，后续更换密钥会增加历史敏感数据解密失败风险。
