# ============================================================
# DelayerZ - Installer Script (PowerShell)
# Run via install.bat, do not run this file directly.
#
# Source lookup order:
#   1. .\DelayerZ\          (unzipped release package)
#   2. ..\extension\        (running from the source repository)
# ============================================================

param(
    [switch]$Elevated
)

$AppVersion = "1.3.0"

# ---- Color helpers ----
function Write-Ok   ($msg) { Write-Host "  [OK] $msg"  -ForegroundColor Green  }
function Write-Warn ($msg) { Write-Host "  [!]  $msg"  -ForegroundColor Yellow }
function Write-Err  ($msg) { Write-Host "  [X]  $msg"  -ForegroundColor Red    }
function Write-Step ($msg) { Write-Host "`n  >>  $msg" -ForegroundColor Cyan   }

# ============================================================
# SAFE EXIT: always show a prompt before the window closes
# ============================================================
function Safe-Exit ($code) {
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit $code
}

# ============================================================
# TOP-LEVEL ERROR TRAP
# ============================================================
trap {
    Write-Host ""
    Write-Err "Unexpected error: $_"
    Safe-Exit 1
}

# ============================================================
# 0. SELF-ELEVATE TO ADMINISTRATOR
# ============================================================
$isAdmin = ([Security.Principal.WindowsPrincipal]`
    [Security.Principal.WindowsIdentity]::GetCurrent()`
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "  Requesting administrator privileges..." -ForegroundColor Yellow

    $psArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"",
        "-Elevated"
    )

    try {
        Start-Process -FilePath "powershell.exe" `
                      -ArgumentList $psArgs `
                      -Verb RunAs `
                      -Wait
    } catch {
        Write-Err "Elevation cancelled or failed: $_"
        Safe-Exit 1
    }

    exit 0
}

# ============================================================
# BANNER
# ============================================================
Clear-Host
Write-Host ""
Write-Host "  ==================================================" -ForegroundColor DarkCyan
Write-Host "   DelayerZ v$AppVersion - Installer for Adobe Animate" -ForegroundColor Cyan
Write-Host "  ==================================================" -ForegroundColor DarkCyan
Write-Host ""

# ============================================================
# 1. RESOLVE PATHS
# ============================================================
Write-Step "Checking paths..."

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
}

$sourceDir = $null
$folderCandidates = @(
    (Join-Path $scriptDir "DelayerZ"),
    (Join-Path $scriptDir "..\extension")
)
foreach ($candidate in $folderCandidates) {
    if (Test-Path (Join-Path $candidate "CSXS\manifest.xml")) {
        $sourceDir = (Resolve-Path $candidate).Path
        break
    }
}

if (-not $sourceDir) {
    Write-Host ""
    Write-Err "Extension files (CSXS\manifest.xml) not found."
    Write-Err "Expected one of these next to operator.ps1:"
    Write-Host ""
    Write-Host "    DelayerZ\CSXS\manifest.xml"      -ForegroundColor Gray
    Write-Host "    ..\extension\CSXS\manifest.xml"  -ForegroundColor Gray
    Write-Host ""
    Safe-Exit 1
}

$destSystem = "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\DelayerZ"
$destUser   = "$env:APPDATA\Adobe\CEP\extensions\DelayerZ"
$destDir    = if (Test-Path "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions") {
    $destSystem
} else {
    Write-Warn "System CEP path not found, using per-user path."
    $destUser
}

Write-Ok "Source      : $sourceDir"
Write-Ok "Destination : $destDir"

# ============================================================
# 2. CHECK FOR RUNNING ADOBE ANIMATE
# ============================================================
Write-Step "Checking for running Adobe Animate process..."

$animateProcess = Get-Process -Name "Animate" -ErrorAction SilentlyContinue

if ($animateProcess) {
    Write-Warn "Adobe Animate is running."
    Write-Host ""
    Write-Host "  Choose an action:" -ForegroundColor White
    Write-Host "  [1] Close Animate automatically and continue" -ForegroundColor Gray
    Write-Host "  [2] Continue without closing (not recommended)" -ForegroundColor Gray
    Write-Host "  [3] Cancel" -ForegroundColor Gray
    Write-Host ""

    $choice = Read-Host "  Choice (1/2/3)"

    switch ($choice) {
        "1" {
            Stop-Process -Name "Animate" -Force
            Start-Sleep -Seconds 2
            Write-Ok "Animate closed."
        }
        "2" {
            Write-Warn "Continuing. Restart Animate after the installation finishes."
        }
        default {
            Write-Warn "Installation cancelled."
            Safe-Exit 0
        }
    }
} else {
    Write-Ok "Adobe Animate is not running."
}

# ============================================================
# 3. COPY EXTENSION FILES (CEP PANEL)
# ============================================================
Write-Step "Copying extension files..."

try {
    if (Test-Path $destDir) {
        Remove-Item $destDir -Recurse -Force
        Write-Ok "Previous installation removed."
    }
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Copy-Item -Path "$sourceDir\*" -Destination $destDir -Recurse -Force
    Write-Ok "Files copied to: $destDir"
} catch {
    Write-Err "Failed to copy files: $_"
    Safe-Exit 1
}

# ============================================================
# 4. COPY JSFL TO THE ANIMATE COMMANDS FOLDER
# ============================================================
Write-Step "Copying JSFL to Animate Commands folder..."

$jsflSource = "$sourceDir\jsfl\DelayerZ.jsfl"
$jsflFound  = $false

if (-not (Test-Path $jsflSource)) {
    Write-Warn "DelayerZ.jsfl not found in jsfl\, skipped."
} else {
    $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
    $jsflCopied   = 0

    # Every "Animate <year>\<locale>\Configuration\Commands" folder that exists
    $cmdFolders = Get-ChildItem -Path "$localAppData\Adobe" -Directory -Filter "Animate*" -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue } |
        ForEach-Object { Join-Path $_.FullName "Configuration\Commands" } |
        Where-Object { Test-Path $_ }

    foreach ($cmdFolder in $cmdFolders) {
        try {
            Copy-Item -Path $jsflSource -Destination "$cmdFolder\DelayerZ.jsfl" -Force
            Write-Ok "$cmdFolder"
            $jsflCopied++
        } catch {
            Write-Warn "Failed to copy to $cmdFolder : $_"
        }
    }

    if ($jsflCopied -eq 0) {
        Write-Warn "No Animate Commands folder found."
        Write-Warn "Copy this file manually to:"
        Write-Host "    %LOCALAPPDATA%\Adobe\Animate 2024\en_US\Configuration\Commands\" -ForegroundColor Gray
        Write-Host "    Source file: $jsflSource" -ForegroundColor Gray
    } else {
        Write-Ok "JSFL installed in $jsflCopied location(s)."
        $jsflFound = $true
    }
}

# ============================================================
# 5. REGISTRY: PlayerDebugMode (required for unsigned CEP)
# ============================================================
Write-Step "Setting registry PlayerDebugMode..."

$csxsVersions = @(9, 10, 11, 12, 13)
$regErrors    = 0

foreach ($ver in $csxsVersions) {
    $regPath = "HKCU:\Software\Adobe\CSXS.$ver"
    try {
        if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
        Set-ItemProperty -Path $regPath -Name "PlayerDebugMode" -Value "1" -Type String -Force
        Write-Ok "CSXS.$ver - PlayerDebugMode=1"
    } catch {
        Write-Warn "CSXS.$ver - Failed: $_"
        $regErrors++
    }
}

if ($regErrors -gt 0) {
    Write-Warn "$regErrors key(s) could not be set (not critical)."
}

# ============================================================
# 6. VERIFY
# ============================================================
Write-Step "Verifying installation..."

$checks = @(
    @{ Path = "$destDir\CSXS\manifest.xml"; Label = "manifest.xml"  },
    @{ Path = "$destDir\DelayerZ.html";     Label = "DelayerZ.html" },
    @{ Path = "$destDir\jsx\DelayerZ.jsx";  Label = "DelayerZ.jsx"  },
    @{ Path = "$destDir\css\style.css";     Label = "style.css"     },
    @{ Path = "$destDir\js\main.js";        Label = "main.js"       }
)

$allOk = $true
foreach ($check in $checks) {
    if (Test-Path $check.Path) {
        Write-Ok $check.Label
    } else {
        Write-Err "$($check.Label) -- FILE NOT FOUND!"
        $allOk = $false
    }
}

if ($jsflFound) {
    Write-Ok "DelayerZ.jsfl (Commands menu)"
} else {
    Write-Warn "DelayerZ.jsfl not installed (optional)"
}

# ============================================================
# DONE
# ============================================================
Write-Host ""
Write-Host "  ==================================================" -ForegroundColor DarkCyan

if ($allOk) {
    Write-Host "   INSTALLATION SUCCESSFUL!" -ForegroundColor Green
    Write-Host "  ==================================================" -ForegroundColor DarkCyan
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "  1. Open Adobe Animate (2024 or newer)"        -ForegroundColor Gray
    Write-Host "  2. Panel   : Window > Extensions > DelayerZ"  -ForegroundColor Gray
    if ($jsflFound) {
        Write-Host "  3. Command : Commands > DelayerZ"          -ForegroundColor Gray
    }
    Write-Host ""
} else {
    Write-Host "   INSTALLATION COMPLETED WITH WARNINGS." -ForegroundColor Yellow
    Write-Host "  ==================================================" -ForegroundColor DarkCyan
    Write-Host ""
    Write-Host "  Some files were not found at the destination." -ForegroundColor Yellow
    Write-Host "  Check the source folder and try again."        -ForegroundColor Yellow
    Write-Host ""
}

Safe-Exit 0
