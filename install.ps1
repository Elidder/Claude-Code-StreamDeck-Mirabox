# Claude Code StreamDeck (Mirabox) — one-command installer for Windows.
#
#   irm https://raw.githubusercontent.com/Elidder/Claude-Code-StreamDeck-Mirabox/main/install.ps1 | iex
#
# Downloads the latest release, puts the plugin into Stream Dock's plugins folder and restarts
# Stream Dock. Works in Windows PowerShell 5.1 and PowerShell 7.
# Overrides (environment variables): CCSD_ZIP (local zip or URL), CCSD_PLUGINS_DIR,
# CCSD_NO_RESTART=1 (leave Stream Dock running).

$ErrorActionPreference = 'Stop'
$repo       = 'Elidder/Claude-Code-StreamDeck-Mirabox'
$pluginName = 'com.claudecode.streamdeck.sdPlugin'
$zipSource  = if ($env:CCSD_ZIP) { $env:CCSD_ZIP } else { "https://github.com/$repo/releases/latest/download/Claude-Code-StreamDeck-Mirabox.zip" }
$pluginsDir = if ($env:CCSD_PLUGINS_DIR) { $env:CCSD_PLUGINS_DIR } else { Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins' }

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

Say 'Claude Code StreamDeck (Mirabox) installer' Cyan

if (-not (Test-Path (Split-Path $pluginsDir -Parent))) {
    Say "Stream Dock was not found ($pluginsDir)." Red
    Say 'Install the Mirabox / AJAZZ Stream Dock software, start it once, then run this again.' Yellow
    return
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ccsd-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    # 1. Get the release zip
    $zip = Join-Path $work 'plugin.zip'
    if ($zipSource -match '^https?://') {
        Say "Downloading $zipSource"
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipSource -OutFile $zip -UseBasicParsing
    } else {
        Copy-Item $zipSource $zip
    }

    Expand-Archive -Path $zip -DestinationPath (Join-Path $work 'x') -Force
    $src = Get-ChildItem (Join-Path $work 'x') -Recurse -Directory -Filter $pluginName | Select-Object -First 1
    if (-not $src) { throw "The archive does not contain $pluginName." }

    # 2. Stop Stream Dock so the plugin folder is not in use
    $sd = if ($env:CCSD_NO_RESTART) { $null } else { Get-Process | Where-Object { $_.ProcessName -like 'Stream Dock*' -or $_.ProcessName -eq 'StreamDock' } | Select-Object -First 1 }
    $sdExe = if ($sd) { $sd.Path } else { $null }
    if ($sd) {
        Say 'Stopping Stream Dock'
        Get-Process | Where-Object { $_.ProcessName -like 'Stream Dock*' -or $_.ProcessName -eq 'StreamDock' } | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    # 3. Replace the plugin folder
    New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
    $dst = Join-Path $pluginsDir $pluginName
    if (Test-Path $dst) {
        $item = Get-Item $dst -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            [IO.Directory]::Delete($dst)   # a link: remove the link only, never its target
        } else {
            Remove-Item $dst -Recurse -Force
        }
    }
    Copy-Item $src.FullName $dst -Recurse
    Say "Installed to $dst" Green

    # 4. Start Stream Dock again
    if ($sdExe) {
        Say 'Starting Stream Dock'
        Start-Process $sdExe -WorkingDirectory (Split-Path $sdExe -Parent)
    } else {
        Say 'Start (or restart) Stream Dock to load the plugin.' Yellow
    }
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

$claude = (Get-Command claude -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $env:USERPROFILE '.local\bin\claude.exe'))
if (-not $claude) {
    Say 'Claude Code itself is not installed yet. Install it with:' Yellow
    Say '  irm https://claude.ai/install.ps1 | iex' Yellow
}

Say 'Done. In Stream Dock, drag "Claude Code" onto a key.' Cyan
