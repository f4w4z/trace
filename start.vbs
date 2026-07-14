On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
smt = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
If Right(smt, 1) = "\" Then smt = Left(smt, Len(smt) - 1)

' === Ensure .env exists ===
If Not fso.FileExists(smt & "\.env") Then
  If fso.FileExists(smt & "\.env.example") Then
    fso.CopyFile smt & "\.env.example", smt & "\.env", True
  Else
    MsgBox "No .env or .env.example found. Run setup.bat first.", vbCritical, "Trace"
    WScript.Quit
  End If
End If

' === Ensure .env.docker exists (docker-compose.yml requires it) ===
If Not fso.FileExists(smt & "\.env.docker") Then
  Set f = fso.CreateTextFile(smt & "\.env.docker", True)
  f.WriteLine "# Docker-specific env overrides"
  f.Close
End If

' === Check Node.js ===
Dim nodeCheck
nodeCheck = WshShell.Run("cmd /c node --version >nul 2>&1", 0, True)
If nodeCheck <> 0 Then
  MsgBox "Node.js is not installed or not in PATH." & vbCrLf & vbCrLf & _
         "Download from https://nodejs.org/ (LTS version)", vbCritical, "Trace"
  WScript.Quit
End If

' === Auto-elevate to admin if not already (needed for kill commands) ===
If Not WScript.Arguments.Named.Exists("elevated") Then
  Set objShell = CreateObject("Shell.Application")
  On Error Resume Next
  objShell.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """ /elevated", "", "runas", 1
  If Err.Number <> 0 Then
    Err.Clear
  Else
    WScript.Quit
  End If
  On Error Resume Next
End If

' === Kill old electron and free ports ===
WshShell.Run "powershell -NoProfile -Command ""Stop-Process -Name electron -Force -ErrorAction SilentlyContinue""", 0, True
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":6768 ""') do taskkill /f /pid %a 2>nul", 0, True
WshShell.Run "docker stop trace-supermemory 2>nul", 0, True
WshShell.Run "docker rm trace-supermemory 2>nul", 0, True
WScript.Sleep 500

' === Check Docker is running ===
Dim dockerCheck
dockerCheck = WshShell.Run("cmd /c docker info >nul 2>&1", 0, True)
If dockerCheck <> 0 Then
  MsgBox "Docker Desktop is not running." & vbCrLf & vbCrLf & _
         "Start Docker Desktop and try again.", vbExclamation, "Trace"
  WScript.Quit
End If

' === Start Supermemory via Docker Compose ===
Dim composeExit
composeExit = WshShell.Run("cmd /c cd /d """ & smt & """ && docker compose up -d 2>&1", 0, True)
If composeExit <> 0 Then
  MsgBox "Docker Compose failed to start." & vbCrLf & _
         "Make sure Docker Desktop is fully running and try again.", vbExclamation, "Trace"
  WScript.Quit
End If
WScript.Sleep 1000
WshShell.Run "cmd /c cd /d """ & smt & """ && docker compose logs -f > supermemory.log 2>&1", 0, False

' === Launch Electron ===
Dim electronPath
electronPath = smt & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electronPath) Then
  If fso.FileExists(smt & "\node_modules\.package-lock.json") Then
    WshShell.Run "cmd /c cd /d """ & smt & """ && node -e ""require('electron')""", 0, True
  Else
    MsgBox "Dependencies not installed. Run setup.bat first.", vbCritical, "Trace"
    WScript.Quit
  End If
End If

If fso.FileExists(electronPath) Then
  WshShell.Run """" & electronPath & """ """ & smt & "\app\main.cjs""", 1, False
Else
  MsgBox "Electron binary could not be downloaded." & vbCrLf & _
         "Run 'npm install' manually, then try again.", vbCritical, "Trace"
End If
