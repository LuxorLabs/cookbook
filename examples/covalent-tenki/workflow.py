"""Run a Covalent workflow where each task executes in its own disposable Tenki
sandbox (fresh Linux VM with real root, created on demand, destroyed when the
task finishes).

Full run (needs a Covalent dispatcher):
    covalent start
    export TENKI_API_KEY=tk_...       # a tk_ API key (see README)
    python workflow.py
"""
import covalent as ct
from covalent_tenki_plugin import TenkiExecutor

# Each electron assigned this executor runs in a fresh Tenki sandbox.
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
