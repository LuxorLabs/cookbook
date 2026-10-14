// Proves the Tenki surface RAGFlow's `tenki` sandbox provider
// (internal/agent/sandbox/tenki.go) is built on, without running RAGFlow,
// using the same SDK module and version RAGFlow pins in its go.mod:
// WhoAmI health check, a disposable sandbox with outbound network off
// (RAGFlow's security default), a per-instance work dir with artifacts/,
// `python3 -c` and `node -e` execution, the List/Stat/ReadFile artifact
// collection path, and Close.
//
// Token from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
// Exits non-zero on any failure.
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	tenkisdk "github.com/LuxorLabs/tenki-sdk-go/sandbox"
)

func cfg(key string) string {
	home, _ := os.UserHomeDir()
	f, err := os.Open(filepath.Join(home, ".config", "tenki", "config.yaml"))
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if v, ok := strings.CutPrefix(sc.Text(), key+":"); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func main() {
	if err := run(); err != nil {
		fmt.Println("✗", err)
		os.Exit(1)
	}
	fmt.Println("✓ ragflow-tenki: WhoAmI → outbound-off sandbox → python3 -c (42) → node -e → artifacts/ collected → close")
}

func run() error {
	token := os.Getenv("TENKI_API_KEY")
	if token == "" {
		token = os.Getenv("TENKI_AUTH_TOKEN")
	}
	if token == "" {
		token = cfg("auth_token")
	}
	if token == "" {
		return fmt.Errorf("no token: set TENKI_API_KEY, or run `tenki login`")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Initialize + HealthCheck, as the provider does
	client, err := tenkisdk.New(tenkisdk.WithAuthToken(token), tenkisdk.WithHTTPTimeout(30*time.Second))
	if err != nil {
		return fmt.Errorf("client: %w", err)
	}
	if _, err := client.WhoAmI(ctx); err != nil {
		return fmt.Errorf("WhoAmI: %w", err)
	}

	// CreateInstance: disposable sandbox, network off, server-side lifetime cap
	sess, err := client.Create(ctx,
		tenkisdk.WithAllowOutbound(false),
		tenkisdk.WithMaxDuration(time.Hour),
		tenkisdk.WithWaitTimeout(2*time.Minute),
		tenkisdk.WithMetadata(map[string]string{"source": "ragflow"}),
		tenkisdk.WithCPUCores(1),
		tenkisdk.WithMemoryMB(1024),
	)
	if err != nil {
		return fmt.Errorf("Create: %w", err)
	}
	defer func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer ccancel()
		_ = sess.Close(cctx) // DestroyInstance; max duration reaps it otherwise
	}()
	workDir := path.Join("/home/tenki", "ragflow-codeexec-"+sess.ID)
	if err := sess.Mkdir(ctx, path.Join(workDir, "artifacts")); err != nil {
		return fmt.Errorf("Mkdir: %w", err)
	}

	// ExecuteCode, python path: python3 -c <code> in the work dir
	exec := func(cmd string, args ...string) (string, error) {
		res, err := sess.Exec(ctx, cmd, tenkisdk.WithArgs(args...), tenkisdk.WithDir(workDir), tenkisdk.WithTimeout(30*time.Second))
		if err != nil {
			return "", fmt.Errorf("exec %s: %w", cmd, err)
		}
		if res.ExitCode != 0 {
			return "", fmt.Errorf("exec %s: exit %d, stderr %q", cmd, res.ExitCode, res.Stderr)
		}
		return strings.TrimSpace(string(res.Stdout)), nil
	}
	if out, err := exec("python3", "-c", "print(6 * 7)"); err != nil || out != "42" {
		return fmt.Errorf("python: out %q, err %v", out, err)
	}

	// javascript path: node -e <code> (the default image ships node)
	if out, err := exec("node", "-e", `console.log("hello from node")`); err != nil || out != "hello from node" {
		return fmt.Errorf("node: out %q, err %v", out, err)
	}

	// artifact collection: code writes artifacts/, provider lists, stats, reads back
	if _, err := exec("python3", "-c", "import json; json.dump({'answer': 42}, open('artifacts/result.json', 'w'))"); err != nil {
		return err
	}
	artifactsDir := path.Join(workDir, "artifacts")
	entries, err := sess.List(ctx, artifactsDir)
	if err != nil {
		return fmt.Errorf("List: %w", err)
	}
	if len(entries) != 1 || path.Base(entries[0].Path) != "result.json" {
		return fmt.Errorf("artifacts: unexpected entries %+v", entries)
	}
	remote := path.Join(artifactsDir, "result.json")
	info, err := sess.Stat(ctx, remote)
	if err != nil {
		return fmt.Errorf("Stat: %w", err)
	}
	if info.IsSymlink || info.Mode&0o170000 == 0o120000 {
		return fmt.Errorf("artifact unexpectedly a symlink")
	}
	data, err := sess.ReadFile(ctx, remote)
	if err != nil {
		return fmt.Errorf("ReadFile: %w", err)
	}
	if !strings.Contains(string(data), `"answer": 42`) {
		return fmt.Errorf("artifact read-back mismatch: %q", data)
	}
	return nil
}
