"""
Run a Prime Intellect Environments Hub environment on Tenki sandboxes through verifiers' custom runtime.

  python eval.py                         # no model: replay the task's reference answer (vf-validate, gold check)
  python eval.py --model openai/gpt-4o-mini --base-url https://openrouter.ai/api/v1 --api-key-var OPENROUTER_API_KEY
                                         # scored run: a model solves the tasks (vf-eval)

Both put each rollout in its own Tenki sandbox, with the task image running under Docker inside it.
"""
import argparse, json, os, re, subprocess, sys  # noqa: E401
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNTIME = ["custom", "tenki_backend.TenkiBackend"]


def cfg(key):
    try:
        text = open(os.path.expanduser("~/.config/tenki/config.yaml")).read()
        return re.search(rf"^{key}:\s*(.+)$", text, re.M).group(1).strip()
    except (OSError, AttributeError):
        return ""


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--env", default="gsm8k", help="installed Hub environment (default: gsm8k, from requirements.txt)")
ap.add_argument("-n", "--limit", type=int, default=2, help="how many tasks (default: 2)")
ap.add_argument("--model", help="model id; setting it switches to a scored vf-eval run")
ap.add_argument("--base-url", help="OpenAI-compatible endpoint for --model")
ap.add_argument("--api-key-var", help="name of the env var holding that endpoint's key")
args = ap.parse_args()

token = os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
if not token:
    sys.exit("No token. Set TENKI_API_KEY, or run `tenki login`.")
env = {**os.environ, "TENKI_API_KEY": token, "PYTHONPATH": f"{HERE}{os.pathsep}{os.environ.get('PYTHONPATH', '')}"}

bin_dir = Path(sys.executable).parent
if args.model:
    if not (args.base_url and args.api_key_var):
        sys.exit("--model needs --base-url and --api-key-var (the name of the variable, not the key).")
    if not os.environ.get(args.api_key_var):
        sys.exit(f"{args.api_key_var} is not set.")
    cmd = [str(bin_dir / "vf-eval"), args.env, "-m", args.model, "-n", str(args.limit), "--no-push", "--no-rich",
           "--client.base_url", args.base_url, "--client.api_key_var", args.api_key_var,
           "--env.agent.runtime.type", RUNTIME[0], "--env.agent.runtime.import_path", RUNTIME[1]]
else:
    cmd = [str(bin_dir / "vf-validate"), args.env, "--only-gold", "-n", str(args.limit), "--no-rich",
           "--runtime.type", RUNTIME[0], "--runtime.import_path", RUNTIME[1]]
print("+", " ".join(cmd), flush=True)
shown = True
with subprocess.Popen(cmd, env=env, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as proc:
    for line in proc.stdout:
        shown = shown and line.rstrip() != "{"  # vf-eval ends --no-rich runs by dumping one whole trace; skip it
        if shown and "HF Hub" not in line and not line.startswith("Generating"):
            print(line, end="", flush=True)
if args.model and proc.returncode == 0:
    traces = max(HERE.glob("outputs/*/traces.jsonl"), key=lambda p: p.stat().st_mtime)
    scores = [sum(r["score"] * r["weight"] for r in t["rewards"].values())
              for line in traces.open() for t in json.loads(line)["traces"]]
    print(f"{len(scores)} episodes, mean reward {sum(scores) / len(scores):.3f}  ({traces})")
sys.exit(proc.returncode)
