"""
Run a hills optimization loop across two Tenki sandboxes:

  judge    holds the frozen hill, its private/ data and the hills signing key,
           and serves judge.py on a preview URL.
  climber  holds the agent and its submission. It can score a submission
           only by sending it to the judge, and it never has the key.

  python climb.py up [--agent opencode|claude] [--model M] [--hours 1]
  python climb.py status     the agent's log tail and the scores so far
  python climb.py down       download journal.html + reports/, then terminate both

Needs Python 3.12+ and requirements.txt. Tenki key from TENKI_API_KEY or
~/.config/tenki/config.yaml (`tenki login --api-key`). The agent's model key
(ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENCODE_API_KEY or OPENROUTER_API_KEY) is
read from your environment and handed to the climber only.
"""
import argparse
import io
import os
import secrets
import shlex
import sys
import tarfile
import time

from tenki import Client, Sandbox

HILLS = "hills==0.12.1"
HILL = "circle-packing"
PORT = 8080
TAG = "hills-tenki"
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY"]
# OpenCode's own default can be a model without tool use, so pick one when the key allows.
OPENCODE_DEFAULTS = {"ANTHROPIC_API_KEY": "anthropic/claude-sonnet-5-5",
                     "OPENROUTER_API_KEY": "openrouter/anthropic/claude-sonnet-5.5"}


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


def auth():
    opts = {"auth_token": os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")}
    workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
    if workspace_id:
        opts["workspace_id"] = workspace_id
    return opts


def create(role, hours, **opts):
    return Sandbox.create(
        **auth(), name=f"{TAG}-{role}", tags=[TAG, role],
        # At the cap the sandbox pauses rather than ending; pause_retention then
        # deletes it a day later if `down` never ran.
        max_duration=int((hours + 0.5) * 3600), pause_retention=24 * 3600, **opts,
    )


def start_judge(sb, token):
    """Install hills, create and freeze the hill, serve judge.py. Returns (url, tree_hash)."""
    sb.shell(f"uv tool install -q {HILLS}", check=True)  # the default image ships uv
    commit = sb.shell(
        "export PATH=$HOME/.local/bin:$PATH && git config --global user.name judge && "
        "git config --global user.email judge@localhost && mkdir -p ~/judge && cd ~/judge && "
        f"git init -q . && hills new {HILL} -t {HILL} && hills commit {HILL} -m frozen",
        check=True,
    )
    tree_hash = (commit.stdout_text + commit.stderr_text).split("tree hash", 1)[1].split()[0]
    sb.fs.upload(os.path.join(HERE, "judge.py"), "judge.py")
    sb.shell(
        "PATH=$HOME/.local/bin:$PATH setsid python3 judge.py >judge.log 2>&1 </dev/null &",
        env={"JUDGE_TOKEN": token, "HILL": HILL, "PORT": str(PORT)}, check=True,
    )
    url = sb.expose_port(PORT).url.rstrip("/")
    for _ in range(30):  # the server and the preview route take a few seconds
        if sb.shell(f"curl -sf {url}/describe -o /dev/null").exit_code == 0:
            return url, tree_hash
        time.sleep(2)
    raise RuntimeError("judge never answered: " + sb.shell("tail -5 judge.log").stdout_text)


def seed_climber(sb, judge, url, token):
    """Give the climber the task, the hill's example submission, submit.sh and the judge's address."""
    example = judge.shell(f"cd ~/judge/.autolab/hills/{HILL}/examples && ls | head -1", check=True).stdout_text.strip()
    judge.shell(f"tar -czf example.tgz -C ~/judge/.autolab/hills/{HILL}/examples/{example} .", check=True)
    sb.fs.write_bytes("example.tgz", judge.fs.read_bytes("example.tgz"))
    sb.fs.write_text("judge.env", f"JUDGE_URL={shlex.quote(url)}\nJUDGE_TOKEN={shlex.quote(token)}\n")
    sb.fs.mkdir("climb")
    sb.fs.upload(os.path.join(HERE, "submit.sh"), "climb/submit.sh")
    sb.fs.upload(os.path.join(HERE, "climber.md"), "climb/AGENTS.md")
    sb.shell(
        "chmod 600 judge.env && cd climb && chmod +x submit.sh && ln -s AGENTS.md CLAUDE.md && "
        "mkdir -p submission reports && tar -xzf ~/example.tgz -C submission && rm ~/example.tgz && "
        f"curl -sSf {url}/describe -o task.json && "
        "git config --global user.name climber && git config --global user.email climber@localhost && "
        "git -C submission init -q && git -C submission add -A && git -C submission commit -qm baseline",
        check=True,
    )


def agent_loop(agent, model):
    """A shell loop that keeps the agent climbing until climb/deadline passes."""
    if agent == "opencode":
        first = f"opencode run{f' -m {model}' if model else ''}"
        cont = f"{first} --continue"
    else:
        first = f"claude -p --dangerously-skip-permissions{f' --model {model}' if model else ''}"
        cont = f"{first} --continue"
    return f"""set -a; . ~/agent.env; set +a
cd ~/climb
{first} "Read AGENTS.md and start climbing."
while [ "$(date +%s)" -lt "$(cat deadline)" ]; do
  {cont} "The deadline in ./deadline has not passed. Keep climbing."
  sleep 5  # don't spin if the agent exits straight away, e.g. on a model error
done
"""


def up(args):
    keys = {k: os.environ[k] for k in MODEL_KEYS if os.environ.get(k)}
    if not keys:
        sys.exit(f"No model key. Set one of {', '.join(MODEL_KEYS)}.")
    model = args.model
    if args.agent == "claude" and "ANTHROPIC_API_KEY" not in keys:
        sys.exit("--agent claude needs ANTHROPIC_API_KEY.")
    if args.agent == "opencode" and not model:
        model = next((OPENCODE_DEFAULTS[k] for k in OPENCODE_DEFAULTS if k in keys), None)
        if not model:
            sys.exit("Pass --model (an OpenCode provider/model ID, e.g. openai/gpt-5.6-terra).")
    token = secrets.token_urlsafe(24)

    judge = create("judge", args.hours, cpu_cores=4, memory_mb=8192)
    url, tree_hash = start_judge(judge, token)
    print(f"judge    {judge.id}  {HILL} @ {tree_hash[:12]}  {url}")

    climber = create("climber", args.hours, cpu_cores=4, memory_mb=8192)
    seed_climber(climber, judge, url, token)
    climber.fs.write_text("agent.env", "".join(f"{k}={shlex.quote(v)}\n" for k, v in keys.items()))
    climber.fs.write_text("climb.sh", agent_loop(args.agent, model))
    climber.shell(
        f"chmod 600 agent.env && echo $(( $(date +%s) + {int(args.hours * 3600)} )) > climb/deadline && "
        "cd climb && ./submit.sh submission > reports/000-baseline.json",
        check=True,
    )
    climber.shell("setsid bash climb.sh >climb.log 2>&1 </dev/null &", check=True)
    print(f"climber  {climber.id}  {args.agent}{f' ({model})' if model else ''} for {args.hours}h")
    print("\nIt runs without you. Check in with `python climb.py status`; finish with `python climb.py down`.")


def find():
    opts = auth()
    client = Client(auth_token=opts["auth_token"])
    found = {}
    for sb in client.list(workspace_id=opts.get("workspace_id"), tags=[TAG]):
        if sb.state in ("TERMINATING", "TERMINATED"):  # listed briefly after `down`
            continue
        role = "judge" if "judge" in (sb.info.tags or []) else "climber"
        found[role] = sb
    if not found:
        sys.exit("No hills-tenki sandboxes running. Start with `python climb.py up`.")
    for sb in found.values():
        if sb.state in ("PAUSING", "PAUSED"):  # e.g. paused at the lifetime cap
            sb.resume()  # returns while the sandbox is still RESUMING
            for _ in range(90):
                if sb.refresh().state == "RUNNING":
                    break
                time.sleep(2)
    return found


def status(_args):
    climber = find().get("climber")
    if not climber:
        sys.exit("No climber sandbox running. Start with `python climb.py up`.")
    print(climber.shell(
        "cd climb && tail -n 15 ../climb.log; echo; echo '--- reports'; "
        "for r in reports/*.json; do printf '%s  ' \"$r\"; python3 -c \"import json,sys; r=json.load(open(sys.argv[1])); "
        "print(r.get('passed'), ' '.join(f\\\"{m['name']}={m['value']}\\\" for m in r.get('metrics') or []))\" \"$r\"; done; "
        "echo; echo \"deadline in $(( $(cat deadline) - $(date +%s) ))s\"",
    ).stdout_text)


def down(_args):
    found = find()
    climber = found.get("climber")
    if climber:
        out = os.path.join(HERE, "runs", time.strftime("%Y%m%d-%H%M%S"))
        climber.shell("cp climb.log climb/ && tar -czf run.tgz -C climb .", check=True)
        with tarfile.open(fileobj=io.BytesIO(climber.fs.read_bytes("run.tgz"))) as tar:
            tar.extractall(out, filter="data")
        print(f"saved {out}")
    for role, sb in found.items():
        sb.terminate()
        print(f"terminated {role} {sb.id}")


if __name__ == "__main__":
    if not auth()["auth_token"]:
        sys.exit("No Tenki key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.")
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("up")
    u.add_argument("--agent", choices=["opencode", "claude"], default="opencode")
    u.add_argument("--model", help="e.g. anthropic/claude-sonnet-5-5 for opencode, claude-sonnet-5-5 for claude")
    u.add_argument("--hours", type=float, default=1.0)
    sub.add_parser("status")
    sub.add_parser("down")
    args = p.parse_args()
    {"up": up, "status": status, "down": down}[args.cmd](args)
