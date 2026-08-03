"""
A CrewAI agent that runs code in a Tenki sandbox to answer questions.

Needs Python 3.10+, the deps in requirements.txt, and OPENAI_API_KEY (CrewAI's
default model). Run: python agent.py
"""
import os

from crewai import Agent, Crew, Task
from tenki_sandbox import Sandbox

from tenki_tool import TenkiCodeInterpreter


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        return ""
    return ""


opts = {"cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

with Sandbox.create(**opts) as sandbox:
    analyst = Agent(
        role="Data analyst",
        goal="Answer questions by running Python in a sandbox instead of guessing.",
        backstory="You verify every numeric answer by executing code.",
        tools=[TenkiCodeInterpreter(sandbox=sandbox)],
        verbose=True,
    )
    task = Task(
        description="What is the 20th Fibonacci number? Compute it in the sandbox.",
        expected_output="The number, plus a one-line note on how you got it.",
        agent=analyst,
    )
    print(Crew(agents=[analyst], tasks=[task]).kickoff())
