"""
A HuggingFace smolagents `CodeAgent` whose generated Python runs in a Tenki
sandbox, via `TenkiExecutor` (the `remote_executors.py` seam).

Needs Python 3.10+, the deps in requirements.txt, and a model:
  - set OPENAI_API_KEY  → uses OpenAIServerModel (pip install 'smolagents[openai]'), or
  - set HF_TOKEN        → uses InferenceClientModel (Hugging Face Inference)
Run: python agent.py
"""
import os

from smolagents import CodeAgent
from smolagents.monitoring import AgentLogger, LogLevel

from tenki_executor import TenkiExecutor


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        return ""
    return ""


# A `tk_` API key works as-is; a `tenki login` session token must be sent as a
# cookie, so prefix it `cookie:` (see the auth note in the README).
token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if token and not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

# allow_outbound=True: CodeAgent patches its final_answer tool, and smolagents
# then pip-installs that tool's inferred requirements (numpy, pillow) into the
# sandbox at send_tools time — which needs outbound network.
opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024, "allow_outbound": True}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id


def build_model():
    """Pick a model from whatever key is in the environment."""
    if os.environ.get("OPENAI_API_KEY"):
        from smolagents import OpenAIServerModel

        return OpenAIServerModel(model_id=os.environ.get("TENKI_DEMO_MODEL", "gpt-4o-mini"))
    from smolagents import InferenceClientModel

    return InferenceClientModel(model_id=os.environ.get("TENKI_DEMO_MODEL", "Qwen/Qwen2.5-Coder-32B-Instruct"))


# The executor boots one microVM and reuses it for every step of the agent's
# reasoning; `CodeAgent(executor=...)` swaps it in for the default local one.
executor = TenkiExecutor(additional_imports=[], logger=AgentLogger(LogLevel.INFO), **opts)
try:
    agent = CodeAgent(tools=[], model=build_model(), executor=executor)
    answer = agent.run("What is the 20th Fibonacci number? Compute it in Python.")
    print(answer)
finally:
    executor.cleanup()  # terminate the microVM
