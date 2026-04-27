<#
.SYNOPSIS
    Dev helper for the D&D companion project.
.DESCRIPTION
    Single entry point for common dev tasks.
.EXAMPLE
    .\dev.ps1 start    # stop + clean cache + migrate + start server
    .\dev.ps1 test     # run pytest
    .\dev.ps1 lint     # run ruff
    .\dev.ps1 fix      # run ruff --fix
    .\dev.ps1 check    # lint + tests (CI-style)
    .\dev.ps1 clean    # only clean __pycache__
    .\dev.ps1 stop     # stop running python servers
    .\dev.ps1 migrate  # run alembic upgrade head
#>
param(
    [Parameter(Position=0)]
    [ValidateSet("start", "test", "lint", "fix", "check", "clean", "stop", "migrate", "help")]
    [string]$Command = "help"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Stop-PyServers {
    $procs = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -like "*main.py*" }
    if ($procs) {
        $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Write-Host "[OK] Stopped $($procs.Count) python server(s)" -ForegroundColor Green
    } else {
        Write-Host "[OK] No running servers" -ForegroundColor DarkGray
    }
}

function Clear-PyCache {
    $count = 0
    Get-ChildItem -Path . -Filter "__pycache__" -Recurse -Directory -ErrorAction SilentlyContinue |
        ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            $count++
        }
    Get-ChildItem -Path . -Filter "*.pyc" -Recurse -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Cleaned $count __pycache__ dirs" -ForegroundColor Green
}

function Invoke-Migrate {
    python -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Migration failed" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "[OK] Migrations applied" -ForegroundColor Green
}

function Invoke-Lint {
    Write-Host "[..] Running ruff..." -ForegroundColor Cyan
    ruff check app/ main.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Lint errors found" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "[OK] Lint passed" -ForegroundColor Green
}

function Invoke-Fix {
    Write-Host "[..] Running ruff --fix..." -ForegroundColor Cyan
    ruff check app/ main.py --fix
    Write-Host "[OK] Done" -ForegroundColor Green
}

function Invoke-Test {
    Write-Host "[..] Running pytest..." -ForegroundColor Cyan
    python -m pytest tests/ -q
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Tests failed" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "[OK] Tests passed" -ForegroundColor Green
}

function Show-Help {
    Get-Help $PSCommandPath -Detailed
}

switch ($Command) {
    "stop"    { Stop-PyServers }
    "clean"   { Clear-PyCache }
    "migrate" { Invoke-Migrate }
    "lint"    { Invoke-Lint }
    "fix"     { Invoke-Fix }
    "test"    { Invoke-Test }
    "check" {
        Invoke-Lint
        Invoke-Test
        Write-Host "[OK] All checks passed" -ForegroundColor Green
    }
    "start" {
        Stop-PyServers
        Clear-PyCache
        Invoke-Migrate
        Write-Host "[GO] Starting server..." -ForegroundColor Cyan
        python main.py
    }
    "help"    { Show-Help }
}
