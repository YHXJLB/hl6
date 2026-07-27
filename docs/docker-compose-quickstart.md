# HL6 Docker Compose 快速部署

本文用于生产/准生产环境快速拉起 HL6 全栈（`app + postgres`），使用镜像：

- `ghcr.io/yhxjlb/hl6:latest`（GitHub Container Registry，私有包，拉取前需先 `docker login ghcr.io`）

## 0. 登录 ghcr.io（私有镜像包，拉取前必须）

`ghcr.io/yhxjlb/hl6` 是私有包，未登录直接 `pull` 会报 401。先用有权限的 token 登录（可用你的 GitHub PAT，或仅含 `read:packages` 的细粒度 token）：

```bash
docker login ghcr.io -u YHXJLB -p <TOKEN>
```

> 建议为服务器单独建一个**细粒度 token**，只勾 `read:packages`，不要使用全权限 PAT。

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
