import marimo

app = marimo.App()


@app.cell
def _():
    import marimo as mo
    return (mo,)


@app.cell
def _(mo):
    n = mo.ui.slider(1, 20, value=5, label="n")
    n
    return (n,)


@app.cell
def _(mo, n):
    squares = [i * i for i in range(1, n.value + 1)]
    mo.md(f"The first **{n.value}** squares sum to **{sum(squares)}**: {squares}")
    return


if __name__ == "__main__":
    app.run()
