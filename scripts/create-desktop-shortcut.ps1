$WshShell = New-Object -ComObject WScript.Shell

$candidates = @(
    [Environment]::GetFolderPath('Desktop'),
    'C:\Users\nakod\Desktop',
    'C:\Users\nakod\OneDrive\Desktop'
) | Select-Object -Unique | Where-Object { Test-Path $_ }

foreach ($folder in $candidates) {
    $shortcutPath = Join-Path $folder "Orion Smart Mirror 3.lnk"
    $shortcut = $WshShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "C:\Windows\System32\wscript.exe"
    $shortcut.Arguments = "`"E:\orion_smart-mirror_3\launch-orion-silent.vbs`""
    $shortcut.WorkingDirectory = "E:\orion_smart-mirror_3"
    $shortcut.Description = "Orion Smart Mirror 3 - Fullscreen App"
    $shortcut.IconLocation = "E:\orion_smart-mirror_3\node_modules\electron\dist\electron.exe,0"
    $shortcut.Save()
    Write-Host "Successfully created desktop shortcut at: $shortcutPath"
}
