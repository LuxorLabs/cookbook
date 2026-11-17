"""Run a Covalent workflow where each step (an "electron") runs in its own
Tenki sandbox: a fresh Linux VM with root access, created when the step starts
and deleted when it finishes.

Full run (needs a Covalent dispatcher):
    export TENKI_API_KEY=tk_...       # a tk_ API key (see README). Set it BEFORE
                                      # `covalent start`: the executor runs inside
                                      # the dispatcher process and reads its env.
    covalent start
    python workflow.py
"""
import covalent as ct

# --------------------------------------------------------------------------
# Upstream Covalent bug workaround. With covalent 0.240.0 and requests >= 2.34,
# the Covalent SDK posts the dispatch manifest without a
# `Content-Type: application/json` header, and the dispatcher rejects every
# ct.dispatch() with 422 Unprocessable Entity, before any sandbox is created.
# Remove this block once Covalent fixes it. Source: the plugin README's "Known
# upstream issue" (https://github.com/LuxorLabs/tenki-covalent-plugin).
from covalent._dispatcher_plugins import local as ldisp

_orig_post = ldisp.APIClient.post


def _patched_post(self, endpoint, **kw):
    if "data" in kw:
        kw.setdefault("headers", {})["Content-Type"] = "application/json"
    return _orig_post(self, endpoint, **kw)


ldisp.APIClient.post = _patched_post
# --------------------------- end workaround -------------------------------

from covalent_tenki_plugin import TenkiExecutor  # noqa: E402 (after the patch)

# Every electron that uses this executor runs in its own new Tenki sandbox.
tenki = TenkiExecutor(cpu_cores=2, memory_mb=4096, sandbox_requirements="numpy")


@ct.electron(executor=tenki)
def sqrt_of_sum(n):
    import numpy as np  # installed in the VM via sandbox_requirements
    return float(np.sqrt(sum(range(n))))


@ct.lattice
def workflow(n):
    return sqrt_of_sum(n)


if __name__ == "__main__":
    dispatch_id = ct.dispatch(workflow)(100)
    print("dispatched:", dispatch_id)
    result = ct.get_result(dispatch_id, wait=True)
    print("result:", result.result)  # sqrt(sum(0..99)) = sqrt(4950) ~= 70.36
