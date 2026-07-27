# 基础镜像统一在首个 FROM 之前声明（BuildKit 规则：用于 FROM 的 ARG 必须是全局的）
#   - 默认使用私有镜像源（服务器本地构建，速度快且预装 libwebp）
#   - GitHub Actions 等无法访问私有源时，传入公共 Docker Hub 镜像即可
ARG NODE_IMAGE=mirror.houlang.cloud/dh/node:22-alpine
ARG GO_IMAGE=mirror.houlang.cloud/dh/golang:1.25.8-alpine
ARG FINAL_IMAGE=mirror.houlang.cloud/dh/alpine:3.22

FROM ${NODE_IMAGE} AS web-builder

WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

ARG APP_GIT_BRANCH=unknown
ARG APP_GIT_COMMIT=unknown
ENV APP_GIT_BRANCH=$APP_GIT_BRANCH
ENV APP_GIT_COMMIT=$APP_GIT_COMMIT

RUN npm run build

FROM ${GO_IMAGE} AS server-builder

WORKDIR /src

# build-base 提供 C 工具链；libwebp-dev 提供 chai2010/webp (CGO) 所需的头文件与静态库
RUN apk add --no-cache build-base libwebp-dev

ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=$GOPROXY

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -o /out/hl6-server ./cmd/server

FROM ${FINAL_IMAGE}

# libwebp 为运行期动态链接依赖（chai2010/webp CGO），缺失会导致容器启动即崩溃
RUN apk add --no-cache ca-certificates tzdata libgcc libwebp

WORKDIR /app

COPY --from=server-builder /out/hl6-server /app/server
COPY --from=web-builder /src/web/dist /app/web/dist

EXPOSE 8080

ENTRYPOINT ["/app/server"]
