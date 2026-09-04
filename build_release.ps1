[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()]
    [string]$RustToolchain = "1.98.0",

    [string]$ReleasesDirectory,

    [switch]$SkipDependencyInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"

function Assert-RequiredPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description,

        [ValidateSet("Leaf", "Container")]
        [string]$PathType
    )

    if (-not (Test-Path -LiteralPath $Path -PathType $PathType)) {
        throw "Required $Description was not found: $Path"
    }
}

function Resolve-RequiredExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$CommandNames
    )

    foreach ($CommandName in $CommandNames) {
        $Commands = @(
            Get-Command $CommandName -CommandType Application -All -ErrorAction SilentlyContinue
        )
        if ($Commands.Count -gt 0) {
            # A Windows PATH can expose the same shim from multiple locations.
            # Invoke exactly the first match, consistent with normal PATH lookup.
            return [string]$Commands[0].Source
        }
    }

    throw "Required executable was not found: $($CommandNames -join ', ')"
}

function Copy-DirectoryTree {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [string[]]$ExcludedExtensions = @()
    )

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null

    foreach ($Directory in Get-ChildItem -LiteralPath $Source -Directory -Force -Recurse) {
        $RelativePath = [System.IO.Path]::GetRelativePath($Source, $Directory.FullName)
        New-Item -ItemType Directory -Force -Path (Join-Path $Destination $RelativePath) | Out-Null
    }

    foreach ($File in Get-ChildItem -LiteralPath $Source -File -Force -Recurse) {
        if ($ExcludedExtensions -contains $File.Extension.ToLowerInvariant()) {
            continue
        }

        $RelativePath = [System.IO.Path]::GetRelativePath($Source, $File.FullName)
        $DestinationPath = Join-Path $Destination $RelativePath
        $DestinationParent = Split-Path -Parent $DestinationPath
        New-Item -ItemType Directory -Force -Path $DestinationParent | Out-Null
        Copy-Item -LiteralPath $File.FullName -Destination $DestinationPath -Force
        Write-Output $RelativePath
    }
}

function Compress-ReleaseDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [System.IO.Compression.ZipFile]::Open(
        $DestinationPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )

    try {
        foreach ($Directory in Get-ChildItem -LiteralPath $SourceDirectory -Directory -Force -Recurse) {
            $RelativePath = [System.IO.Path]::GetRelativePath($SourceDirectory, $Directory.FullName)
            $EntryName = $RelativePath.Replace("\", "/").TrimEnd("/") + "/"
            $null = $Archive.CreateEntry($EntryName)
        }

        foreach ($File in Get-ChildItem -LiteralPath $SourceDirectory -File -Force -Recurse) {
            $RelativePath = [System.IO.Path]::GetRelativePath($SourceDirectory, $File.FullName)
            $EntryName = $RelativePath.Replace("\", "/")
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $Archive,
                $File.FullName,
                $EntryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
        }
    } finally {
        $Archive.Dispose()
    }
}

$RepoRoot = $PSScriptRoot
$FrontendDirectory = Join-Path $RepoRoot "web-dashboard"
$FrontendOutputDirectory = Join-Path $FrontendDirectory "out"
$RustDirectory = Join-Path $RepoRoot "rust-web-dashboard"
$RustManifestPath = Join-Path $RustDirectory "Cargo.toml"
$EmbeddedStaticDirectory = Join-Path $RustDirectory "static"
$ReleasesDir = if ($ReleasesDirectory) {
    [System.IO.Path]::GetFullPath($ReleasesDirectory)
} else {
    Join-Path $RepoRoot "Releases"
}

$AssetMappings = @(
    [pscustomobject]@{ Source = "icon"; Destination = "icon" },
    [pscustomobject]@{ Source = "img"; Destination = "images" }
)
$ReleaseDirectories = @($AssetMappings.Destination) + "logs"

Assert-RequiredPath -Path $RustManifestPath -Description "Rust manifest" -PathType Leaf
Assert-RequiredPath -Path (Join-Path $FrontendDirectory "package-lock.json") -Description "frontend lockfile" -PathType Leaf

$VersionLine = Select-String -Path $RustManifestPath -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $VersionLine) {
    throw "Could not read the package version from: $RustManifestPath"
}
$Version = $VersionLine.Matches.Groups[1].Value
$ReleaseName = "DCS-Web-Dashboard-$Version"
$ReleaseFolder = Join-Path $ReleasesDir $ReleaseName
$ZipPath = Join-Path $ReleasesDir "$ReleaseName.zip"

Write-Information "Building dashboard release $Version..."
$NpmCommand = Resolve-RequiredExecutable -CommandNames @("npm.cmd", "npm")
Push-Location $FrontendDirectory
try {
    if (-not $SkipDependencyInstall) {
        Write-Information "Installing locked frontend dependencies..."
        & $NpmCommand ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE."
        }
    }

    Write-Information "Building the static frontend..."
    & $NpmCommand run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

Assert-RequiredPath -Path $FrontendOutputDirectory -Description "Next.js static export" -PathType Container
foreach ($AssetMapping in $AssetMappings) {
    Assert-RequiredPath -Path (Join-Path $FrontendOutputDirectory $AssetMapping.Source) -Description "frontend $($AssetMapping.Source) directory" -PathType Container
}

Write-Information "Refreshing the frontend embedded by the Rust executable..."
if (Test-Path -LiteralPath $EmbeddedStaticDirectory) {
    Remove-Item -LiteralPath $EmbeddedStaticDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $EmbeddedStaticDirectory | Out-Null
$null = @(Copy-DirectoryTree -Source $FrontendOutputDirectory -Destination $EmbeddedStaticDirectory)

Write-Information "Compiling the Rust executable with Rust $RustToolchain..."
$CargoCommand = Resolve-RequiredExecutable -CommandNames @("cargo.exe", "cargo")
Push-Location $RustDirectory
try {
    & $CargoCommand "+$RustToolchain" build --release --locked
    if ($LASTEXITCODE -ne 0) {
        throw "Cargo release build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

$ExecutablePath = Join-Path $RustDirectory "target\release\rust-web-dashboard.exe"
Assert-RequiredPath -Path $ExecutablePath -Description "dashboard executable" -PathType Leaf

Write-Information "Creating release folder: $ReleaseFolder"
New-Item -ItemType Directory -Force -Path $ReleasesDir | Out-Null
if (Test-Path -LiteralPath $ReleaseFolder) {
    Remove-Item -LiteralPath $ReleaseFolder -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $ReleaseFolder | Out-Null
Copy-Item -LiteralPath $ExecutablePath -Destination (Join-Path $ReleaseFolder "rust-web-dashboard.exe") -Force

$PackagedAssetFiles = @{}
foreach ($AssetMapping in $AssetMappings) {
    $SourceDirectory = Join-Path $FrontendOutputDirectory $AssetMapping.Source
    $DestinationDirectory = Join-Path $ReleaseFolder $AssetMapping.Destination
    $PackagedAssetFiles[$AssetMapping.Destination] = @(
        Copy-DirectoryTree -Source $SourceDirectory -Destination $DestinationDirectory
    )
}

# NSSM writes the dashboard service's stdout and stderr here at runtime.
# Do not copy Next.js route artifacts from out\logs into this directory.
$LogsDirectory = Join-Path $ReleaseFolder "logs"
New-Item -ItemType Directory -Force -Path $LogsDirectory | Out-Null
$PackagedAssetFiles["logs"] = @()

foreach ($ReleaseDirectory in $ReleaseDirectories) {
    $DestinationDirectory = Join-Path $ReleaseFolder $ReleaseDirectory
    Assert-RequiredPath -Path $DestinationDirectory -Description "release $ReleaseDirectory directory" -PathType Container

    $ActualRelativePaths = @(
        Get-ChildItem -LiteralPath $DestinationDirectory -File -Force -Recurse |
            ForEach-Object { [System.IO.Path]::GetRelativePath($DestinationDirectory, $_.FullName) } |
            Sort-Object
    )
    $ExpectedRelativePaths = @($PackagedAssetFiles[$ReleaseDirectory] | Sort-Object)
    if (Compare-Object -ReferenceObject $ExpectedRelativePaths -DifferenceObject $ActualRelativePaths) {
        throw "The packaged $ReleaseDirectory tree does not match its expected contents."
    }
}

if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
}
Write-Information "Compressing release: $ZipPath"
Compress-ReleaseDirectory -SourceDirectory $ReleaseFolder -DestinationPath $ZipPath
Assert-RequiredPath -Path $ZipPath -Description "release ZIP" -PathType Leaf

Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $ArchiveEntries = @($Archive.Entries | ForEach-Object { $_.FullName })
    if ($ArchiveEntries -notcontains "rust-web-dashboard.exe") {
        throw "The dashboard executable is missing from the ZIP."
    }

    foreach ($ReleaseDirectory in $ReleaseDirectories) {
        $DirectoryEntry = "$ReleaseDirectory/"
        if ($ArchiveEntries -notcontains $DirectoryEntry) {
            throw "The $DirectoryEntry tree is missing from the ZIP."
        }

        foreach ($RelativePath in $PackagedAssetFiles[$ReleaseDirectory]) {
            $RequiredEntry = "$ReleaseDirectory/$($RelativePath.Replace('\', '/'))"
            if ($ArchiveEntries -notcontains $RequiredEntry) {
                throw "Required asset is missing from the ZIP: $RequiredEntry"
            }
        }
    }

} finally {
    $Archive.Dispose()
}

Write-Information ""
Write-Information "Release created successfully."
Write-Information "Folder: $ReleaseFolder"
Write-Information "Zip:    $ZipPath"
