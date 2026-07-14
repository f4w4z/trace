On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
smt = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
If Right(smt, 1) = "\" Then smt = Left(smt, Len(smt) - 1)

' Stop Electron overlay
WshShell.Run "taskkill /f /im electron.exe 2>nul", 0, True

' Stop Supermemory Docker container
WshShell.Run "cmd /c cd /d """ & smt & """ && docker compose down 2>nul", 0, True

' Kill trace API server (port 6768)
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True

' Kill supermemory server (port 6767) — backup in case container didn't stop cleanly
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6767 ""') do taskkill /f /pid %a 2>nul", 0, True
