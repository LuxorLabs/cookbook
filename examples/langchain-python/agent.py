"""
A LangChain agent that runs code in a Tenki sandbox (the "code interpreter" pattern).
The agent writes Python; the run_python tool executes it in a disposable microVM.

Needs Python 3.10+, the deps in requirements.txt, and a model key:
export OPENAI_API_KEY=...  (or swap ChatOpenAI for your provider). Run: python agent.py
"""
import os

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from tenki_sandbox import Sandbox

from tenki_tool import make_code_tool


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

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

# One sandbox for the whole agent session, reused across every tool call.
with Sandbox.create(**opts) as sandbox:
    agent = create_react_agent(
        ChatOpenAI(model="gpt-4o-mini"),  # needs OPENAI_API_KEY
        tools=[make_code_tool(sandbox)],  # the tool runs the agent's code in Tenki
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "What is the 20th Fibonacci number? Compute it with Python."}]}
    )
    print(result["messages"][-1].content)
