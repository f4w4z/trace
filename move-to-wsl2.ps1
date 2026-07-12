# PowerShell script to move the trace project to WSL2 Linux home directory

$projPath = "/mnt/c/Projects/trace"
$wslDest = "~/trace"

# Check if WSL2 is available
$wsldAvailable = wsl --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "WSL2 is not available. Please enable WSL2."
    exit 1
}

# Create the destination directory in WSL2
wsl -d docker-desktop --user root --exec bash -c "mkdir -p $wslDest"

# Copy files using WSL2's cp command
$copyCommand = "cp -r $projPath/. $wslDest/"
wsl -d docker-desktop --user root --exec bash -c "$copyCommand"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Success! Project moved to WSL2 Linux filesystem."
    Write-Host "The project is now accessible from the WSL2 Linux filesystem."
    Write-Host "Run 'wsl && ls -la ~/trace' to see the files."
} else {
    Write-Host "Failed to move files automatically."
    Write-Host "Try manually moving the project using Windows File Explorer:"
    Write-Host "1. Open WSL2 terminal: wsl"
    Write-Host "2. Navigate to your home directory: cd ~"
    Write-Host "3. Create the trace directory: mkdir trace"
    Write-Host "4. Use drag-and-drop to move C:\\Projects\\trace to ~/trace"
}
