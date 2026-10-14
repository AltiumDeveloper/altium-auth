package altiumauth

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// openBrowser launches the OS browser on url without any dependency (open on
// macOS, the URL protocol handler on Windows, xdg-open elsewhere), and always
// prints the URL to stderr for manual copy-and-paste if the launch fails.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		// Not "cmd /c start": authorize URLs contain '&', a cmd.exe separator.
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err == nil {
		go func() { _ = cmd.Wait() }() // reap the launcher
	}
	fmt.Fprintf(os.Stderr, "\nOpen the following URL in your browser to sign in:\n%s\n", url)
}
