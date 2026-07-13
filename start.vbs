On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
smt = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
If Right(smt, 1) = "\" Then smt = Left(smt, Len(smt) - 1)

' Auto-elevate to admin if not already (needed for kill commands)
If Not WScript.Arguments.Named.Exists("elevated") Then
  Set objShell = CreateObject("Shell.Application")
  objShell.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """ /elevated", "", "runas", 1
  WScript.Quit
End If

' Kill old electron and free ports (PowerShell Stop-Process works on elevated processes from elevated context)
WshShell.Run "powershell -NoProfile -Command ""Stop-Process -Name electron -Force -ErrorAction SilentlyContinue""", 0, True
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True
' Stop old Supermemory container (if running from previous WSL setup or Docker)
WshShell.Run "docker stop trace-supermemory 2>nul", 0, True
WshShell.Run "docker rm trace-supermemory 2>nul", 0, True
WScript.Sleep 500

' Start Supermemory via Docker Compose
WshShell.Run "cmd /c cd /d """ & smt & """ && docker compose up -d --build", 0, False
WScript.Sleep 1000
' Tail container logs to file for splash screen
WshShell.Run "cmd /c cd /d """ & smt & """ && docker compose logs -f > supermemory.log 2>&1", 0, False

' Launch Electron — connects to Supermemory on localhost:6767
WshShell.Run """" & smt & "\node_modules\electron\dist\electron.exe"" """ & smt & "\app\main.cjs""", 1, False
