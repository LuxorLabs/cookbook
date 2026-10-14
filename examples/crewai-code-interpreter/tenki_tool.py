"""A CrewAI tool that runs Python in a disposable Tenki sandbox.

Uses the official `tenki` Python SDK (pip install tenki; Python 3.10+).
`exec(command, *args)` passes args straight through (no shell splitting), so
model-generated, multi-line code goes across as a single `-c` argument with no
escaping surprises.
"""
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr
from tenki import Sandbox


class RunPythonInput(BaseModel):
    code: str = Field(..., description="The Python code to run.")


class TenkiCodeInterpreter(BaseTool):
    name: str = "run_python"
    description: str = (
        "Execute Python code in a secure, disposable sandbox and return its stdout/stderr. "
        "Use it for calculations, data work, or anything that needs real execution."
    )
    args_schema: Type[BaseModel] = RunPythonInput

    _sandbox: Sandbox = PrivateAttr()

    def __init__(self, sandbox: Sandbox, **kwargs):
        super().__init__(**kwargs)
        self._sandbox = sandbox

    def _run(self, code: str) -> str:
        result = self._sandbox.exec("python3", "-c", code)
        out = f"{result.stdout_text}{result.stderr_text}".strip()
        return out or f"(no output; exit code {result.exit_code})"
