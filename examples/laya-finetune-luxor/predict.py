"""Runs inside the sandbox: load the fine-tuned checkpoint and route new tickets."""
import json
import sys

import laya

agent = laya.load(sys.argv[1])
with open(f"{sys.argv[1]}/questions.json") as f:
    questions = json.load(f)  # the choice question laya-train built from the CSV labels

for text in json.loads(sys.argv[2]):
    answer = agent.predict(text, questions)["answers"]["label"]
    print(json.dumps({"text": text, "team": answer["choice"], "p": round(answer["probabilities"][answer["choice"]], 3)}))
