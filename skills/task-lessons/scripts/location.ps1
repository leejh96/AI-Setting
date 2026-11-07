param([string] $Directory = (Get-Location).Path)

$OutputEncoding = [Text.UTF8Encoding]::new($false)
$locator = Join-Path $PSScriptRoot 'location.mjs'
$snapshots = @()
$git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1

# Windows 샌드박스가 Node의 자식 출력 캡처를 막으면 PowerShell에서 Git을 읽습니다.
while ($true) {
    $inputJson = ConvertTo-Json -InputObject $snapshots -Compress
    $output = $inputJson | node $locator $Directory --git-stdin
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $result = $output | ConvertFrom-Json
    if (-not $result.probe) {
        $output
        break
    }

    $probe = $result.probe
    $info = @{ directory = $probe }
    if ($git) {
        $commonDir = & $git.Source -C $probe rev-parse --path-format=absolute --git-common-dir 2>$null
        if ($LASTEXITCODE -eq 0) {
            $root = & $git.Source -C $probe rev-parse --show-toplevel 2>$null
            if ($LASTEXITCODE -ne 0) { $root = $probe }
            $origin = & $git.Source -C $root remote get-url origin 2>$null
            $info.commonDir = $commonDir
            $info.root = $root
            if ($LASTEXITCODE -eq 0) { $info.origin = $origin }
        }
    }
    $snapshots += $info
}
