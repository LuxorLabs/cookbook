"""A LlamaIndex tool that runs Python in a disposable Tenki sandbox.

`make_code_tool(sandbox)` closes over a live Tenki sandbox and returns a
LlamaIndex `FunctionTool` an agent can call. `exec(command, *args)` passes args
straight through (no shell splitting), so model-generated, multi-line code goes
across as a single `-c` argument with no escaping surprises.

Uses the official `tenki` Python SDK (pip install tenki; Python 3.10+).
"""
from llama_index.core.tools import FunctionTool
from tenki import Sandbox


def make_code_tool(sandbox: Sandbox) -> FunctionTool:
    """Return a `run_python` LlamaIndex tool bound to a live Tenki sandbox."""

    def run_python(code: str) -> str:
        """Execute Python code in a secure, disposable sandbox and return its stdout/stderr.

        Use it for calculations, data work, or anything that needs real execution.
        """
        result = sandbox.exec("python3", "-c", code)
        out = f"{result.stdout_text}{result.stderr_text}".strip()
        return out or f"(no output; exit code {result.exit_code})"

    return FunctionTool.from_defaults(
        fn=run_python,
        name="run_python",
        description="Execute Python code in a secure, disposable Tenki sandbox; returns stdout/stderr.",
    )
