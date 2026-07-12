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

' Kill old electron and free ports
WshShell.Run "taskkill /f /im electron.exe 2>nul", 0, True
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True
' Kill old Supermemory inside WSL
WshShell.Run "wsl -d Ubuntu -u root -- bash -c ""pkill -9 -f supermemory-server 2>/dev/null""", 0, True
WScript.Sleep 500

' Start Supermemory silently in WSL
wslLogPath = Replace(smt, "\", "/")
wslLogPath = "/mnt/c" & Mid(wslLogPath, 3)
WshShell.Run "wsl -d Ubuntu -u root bash -c ""cd /root && export SUPERMEMORY_NO_PROMPT=1 && export OPENAI_API_KEY=dummy && /root/.supermemory/bin/supermemory-server 2>&1 | tee " & wslLogPath & "/supermemory.log""", 0, False

' Launch Electron — main.cjs detects WSL IP and connects directly
WshShell.Run """" & smt & "\node_modules\electron\dist\electron.exe"" """ & smt & "\app\main.cjs""", 1, False
