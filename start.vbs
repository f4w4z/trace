Set WshShell = CreateObject("WScript.Shell")
smt = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))

' Kill any existing server on port 6768
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True

' Kill any other electron processes
WshShell.Run "taskkill /f /im electron.exe 2>nul", 0, True

' Wait a moment to ensure ports are freed
WScript.Sleep 1000

' Start backend server
WshShell.Run "cmd /c cd /d """ & smt & """ && node dist/index.js", 0, False
WScript.Sleep 4000

' Start Electron overlay
WshShell.Run "cmd /c cd /d """ & smt & """ && node_modules\.bin\electron.cmd app/main.cjs", 0, False
