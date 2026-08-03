"""
A LlamaIndex agent that runs code in a Tenki sandbox (the "code interpreter" pattern).
The agent writes Python; the run_python tool executes it in a disposable microVM.

Needs Python 3.10+, the deps in requirements.txt, and a model key:
export OPENAI_API_KEY=...  (or swap the LLM for your provider). Run: python agent.py
"""
import asyncio
import os

from llama_index.core.agent.workflow import FunctionAgent
from llama_index.llms.openai import OpenAI
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
workspace = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace:
    opts["workspace_id"] = workspace


async def main():
    # One sandbox for the whole agent session, reused across every tool call.
    with Sandbox.create(**opts) as sandbox:
        agent = FunctionAgent(
            tools=[make_code_tool(sandbox)],  # the tool runs the agent's code in Tenki
            llm=OpenAI(model="gpt-4o-mini"),  # needs OPENAI_API_KEY
            system_prompt="You answer questions by writing and running Python in a sandbox.",
        )
        response = await agent.run("What is the 20th Fibonacci number? Compute it with Python.")
        print(response)


if __name__ == "__main__":
    asyncio.run(main())
