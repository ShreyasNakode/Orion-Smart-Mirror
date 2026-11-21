' Orion Smart Mirror 3 - Silent Fullscreen Launcher
' Waits exactly 10 seconds, then immediately opens the app in fullscreen with ZERO terminal windows.

WScript.Sleep 10000

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the project directory where this launcher resides
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"

' If local electron dist exists, launch it directly with zero terminal windows
If fso.FileExists(electronExe) Then
    WshShell.Run """" & electronExe & """ """ & scriptDir & """", 1, False
Else
    ' Fallback to npm run desktop via hidden cmd if electron dist is not directly present
    WshShell.Run "cmd /c npm run desktop", 0, False
End If
