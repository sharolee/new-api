<#
.SYNOPSIS
    new-api Docker 一键重新部署脚本

.DESCRIPTION
    重新构建 Docker 镜像并替换运行中的 new-api 容器，保留数据卷与端口配置。

.PARAMETER ImageName
    镜像名称，默认 calciumion/new-api:latest

.PARAMETER ContainerName
    容器名称，默认 new-api

.PARAMETER Port
    宿主机映射端口，默认 3000

.PARAMETER DataDir
    数据持久化目录（宿主机路径），默认 D:\ProgramData\newapi

.PARAMETER SkipBuild
    跳过镜像构建步骤，直接用现有镜像重启容器

.PARAMETER NoBuildCache
    构建镜像时使用 --no-cache，不使用docker构建缓存，调试源码编译问题打开

.EXAMPLE
    .\redeploy.ps1
    默认全流程：构建镜像 + 替换容器

.EXAMPLE
    .\redeploy.ps1 -SkipBuild
    跳过构建，仅用现有镜像重新部署容器

.EXAMPLE
    .\redeploy.ps1 -NoBuildCache
    构建不使用缓存，输出完整编译日志，用于排错

.EXAMPLE
    .\redeploy.ps1 -Port 3001 -DataDir "E:\newapi-data"
    使用自定义端口和数据目录
#>

[CmdletBinding()]
param(
    [string]$ImageName     = "calciumion/new-api:latest",
    [string]$ContainerName = "new-api",
    [int]   $Port          = 3000,
    [string]$DataDir       = "D:\ProgramData\newapi",
    [switch]$SkipBuild,
    [switch]$NoBuildCache
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step  { param($msg) Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2 { param($msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "  [X]  $msg" -ForegroundColor Red }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

# ---------- 1. 前置检查 ----------
Write-Step "前置检查"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "未找到 docker 命令，请确认 Docker Desktop 已启动"
    exit 1
}
Write-Ok "docker 已就绪"

if (-not (Test-Path "Dockerfile")) {
    Write-Err "未在当前目录找到 Dockerfile: $scriptRoot"
    exit 1
}
Write-Ok "Dockerfile 已定位"

if (-not (Test-Path $DataDir)) {
    Write-Warn2 "数据目录不存在，将自动创建: $DataDir"
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}
Write-Ok "数据目录: $DataDir"

# ---------- 2. 构建镜像 ----------
if ($SkipBuild) {
    Write-Step "跳过镜像构建 (-SkipBuild)"
} else {
    Write-Step "构建镜像: $ImageName"
    Write-Host "  这个过程包含前端 bun build + 后端 go build，可能需要几分钟..."

    $buildArgs = @("build","-t",$ImageName)
    if ($NoBuildCache) {
        $buildArgs += "--no-cache"
    }
    $buildArgs += "."

    $env:DOCKER_BUILDKIT = "0"
    & docker @buildArgs
    Remove-Item Env:DOCKER_BUILDKIT -ErrorAction SilentlyContinue

    if ($LASTEXITCODE -ne 0) {
        Write-Err "镜像构建失败 (exit $LASTEXITCODE)"
        exit 1
    }
    Write-Ok "镜像构建成功"
}

# ---------- 3. 停止并移除旧容器 ----------
Write-Step "处理旧容器: $ContainerName"

$existing = & docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) { throw "docker ps 查询容器异常" }

if ($existing -eq $ContainerName) {
    $running = & docker ps --filter "name=^/$ContainerName$" --format "{{.Names}}"
    if ($LASTEXITCODE -ne 0) { throw "docker ps 查询运行容器异常" }

    if ($running -eq $ContainerName) {
        Write-Host "  停止运行中的容器..."
        & docker stop $ContainerName
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "stop容器返回非0" }
        Write-Ok "容器已停止"
    }
    & docker rm $ContainerName
    if ($LASTEXITCODE -ne 0) { throw "移除旧容器失败" }
    Write-Ok "旧容器已移除"
} else {
    Write-Ok "未发现旧容器，直接创建"
}

# ---------- 4. 启动新容器 ----------
Write-Step "启动新容器"

$runArgs = @(
    "run", "-d",
    "--name", $ContainerName,
    "-p", "${Port}:3000",
    "-v", "${DataDir}:/data",
    "-e", "TZ=Asia/Shanghai",
    "--restart", "unless-stopped",
    $ImageName
)
& docker @runArgs
if ($LASTEXITCODE -ne 0) {
    Write-Err "容器启动失败 (exit $LASTEXITCODE)"
    exit 1
}
Write-Ok "容器已启动"

# ---------- 5. 健康检查 ----------
Write-Step "健康检查"

Start-Sleep -Seconds 3

$status = & docker inspect $ContainerName --format "{{.State.Status}}"
if ($LASTEXITCODE -ne 0) { throw "docker inspect 查询容器状态失败" }

if ($status -ne "running") {
    Write-Err "容器状态异常: $status"
    Write-Host "  查看日志: docker logs $ContainerName"
    exit 1
}
Write-Ok "容器状态: $status"

# 尝试访问 /api/status 端点（最多重试 10 次，每次间隔 2 秒）
$probeOk = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$Port/api/status" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $probeOk = $true
            break
        }
    } catch {
        Write-Host "  等待服务就绪... ($i/10)"
        Start-Sleep -Seconds 2
    }
}

if ($probeOk) {
    Write-Ok "HTTP 探针成功: http://localhost:$Port/api/status"
} else {
    Write-Warn2 "HTTP 探针未通过（服务可能仍在启动中）"
    Write-Host "  可稍后重试: curl http://localhost:$Port/api/status"
    Write-Host "  查看日志:   docker logs $ContainerName --tail 50"
}

# ---------- 6. 总结 ----------
Write-Step "部署完成"

$containerInfo = & docker ps --filter "name=^/$ContainerName$" --format "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"
Write-Host $containerInfo

Write-Host ""
Write-Host "  访问地址:  http://localhost:$Port" -ForegroundColor White
Write-Host "  数据目录:  $DataDir" -ForegroundColor White
Write-Host "  查看日志:  docker logs $ContainerName -f" -ForegroundColor White
Write-Host ""