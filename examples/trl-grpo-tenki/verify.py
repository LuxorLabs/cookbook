"""
Verify the sandboxed code reward without a model key or a GPU. On live Tenki sandboxes:
  1. a correct, a wrong and an infinite-loop completion score [1.0, 0.0, 0.0],
  2. a completion that calls sys.exit(0) before the tests can't fake a pass, and
  3. every sandbox the reward created is terminated afterwards.
"""
import asyncio, os, re, sys  # noqa: E401


def cfg(key):
    try:
        text = open(os.path.expanduser("~/.config/tenki/config.yaml")).read()
        return re.search(rf"^{key}:\s*(.+)$", text, re.M).group(1).strip()
    except (OSError, AttributeError):
        return ""


token = os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_API_KEY, or run `tenki login`.")
    sys.exit(1)
os.environ["TENKI_API_KEY"] = token

from tenki import AsyncClient  # noqa: E402

from reward import TAG, tenki_code_reward  # noqa: E402
from reward_smoke import TESTS, score  # noqa: E402

EXIT_HACK = "```python\nimport sys\nsys.exit(0)\n```"


async def main():
    client = AsyncClient()
    before = {s.info.id for s in await client.list(tags=[TAG], include_terminated=True)}

    scores = await score()
    assert scores == [1.0, 0.0, 0.0], f"correct/wrong/infinite loop scored {scores}"
    hack = await tenki_code_reward([EXIT_HACK], tests=[TESTS])
    assert hack == [0.0], f"sys.exit(0) scored {hack}"
    print(f"✓ reward scored correct/wrong/infinite-loop {scores}, sys.exit(0) {hack}")

    made = [s for s in await client.list(tags=[TAG], include_terminated=True) if s.info.id not in before]
    states = {s.info.id: s.info.state for s in made}
    assert len(states) == 4, f"expected 4 sandboxes, found {len(states)}"
    assert all(v in {"TERMINATING", "TERMINATED"} for v in states.values()), f"left running: {states}"
    print(f"✓ all {len(states)} reward sandboxes terminated")


asyncio.run(main())
