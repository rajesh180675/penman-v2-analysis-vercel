# Run this script AFTER stopping the dev server (npm run dev:local).
# It renames the 6 case-inconsistent company folders to Title Case
# AND renames the inner consolidated ZIP to match the new folder name,
# so they work correctly on Linux/Vercel (case-sensitive filesystem).
#
# The consolidated ZIP must match the folder name exactly because
# DataEntry.tsx fetches: /data/companies/{folder}/{folder}.zip
# standalone.zip is always lowercase and doesn't need renaming.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/rename-company-folders.ps1

$base = Join-Path $PSScriptRoot "..\public\data\companies"
$base = Resolve-Path $base

$renames = @(
  @("bajaj finance",      "Bajaj Finance"),
  @("HDFC bank",          "HDFC Bank"),
  @("ICICI bank",         "ICICI Bank"),
  @("paytm",              "Paytm"),
  @("reliance Industries", "Reliance Industries"),
  @("Tata steel",         "Tata Steel")
)

foreach ($pair in $renames) {
  $oldName = $pair[0]
  $newName = $pair[1]
  $src = Join-Path $base $oldName
  $dst = Join-Path $base $newName

  if (Test-Path $src) {
    # Step 1: Rename folder (two-step for case-only changes on Windows)
    $tmpName = $oldName + "_RENAME_TMP"
    $tmp = Join-Path $base $tmpName
    Rename-Item -Path $src -NewName $tmpName -Force
    Rename-Item -Path $tmp -NewName $newName -Force
    Write-Host "FOLDER OK: '$oldName' -> '$newName'"

    # Step 2: Rename the consolidated ZIP inside the folder
    $oldZip = Join-Path $dst "$oldName.zip"
    $newZip = "$newName.zip"
    if (Test-Path $oldZip) {
      $tmpZipName = "$oldName _ZIP_TMP.zip"
      Rename-Item -Path $oldZip -NewName $tmpZipName -Force
      $tmpZipPath = Join-Path $dst $tmpZipName
      Rename-Item -Path $tmpZipPath -NewName $newZip -Force
      Write-Host "  ZIP OK: '$oldName.zip' -> '$newZip'"
    } elseif (Test-Path (Join-Path $dst $newZip)) {
      Write-Host "  ZIP ALREADY: '$newZip'"
    } else {
      Write-Host "  ZIP NOT FOUND: '$oldName.zip' (skipped)"
    }
  } elseif (Test-Path $dst) {
    Write-Host "ALREADY DONE: '$newName'"
    # Still check inner ZIP
    $oldZip = Join-Path $dst "$oldName.zip"
    $newZip = "$newName.zip"
    if (Test-Path $oldZip) {
      $tmpZipName = "$oldName _ZIP_TMP.zip"
      Rename-Item -Path $oldZip -NewName $tmpZipName -Force
      $tmpZipPath = Join-Path $dst $tmpZipName
      Rename-Item -Path $tmpZipPath -NewName $newZip -Force
      Write-Host "  ZIP OK: '$oldName.zip' -> '$newZip'"
    }
  } else {
    Write-Host "NOT FOUND: '$oldName' (skipped)"
  }
}

Write-Host "`n=== Final state ==="
Get-ChildItem $base -Directory | ForEach-Object {
  $dir = $_.Name
  $zips = Get-ChildItem (Join-Path $base $dir) -Filter "*.zip" | Select-Object -ExpandProperty Name
  Write-Host "  $dir/ -> $($zips -join ', ')"
}
