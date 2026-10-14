import { EventType, Middleware, type AbstractAgent, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/client";
import { Observable, type Subscription } from "rxjs";

/**
 * Lets the model see an MCP App's result within the same run.
 *
 * MCPAppsMiddleware executes a UI tool after the model's turn has already
 * ended, emits TOOL_CALL_RESULT + the activity snapshot, and finishes the run.
 * The model never reads the result, so it can't summarize it ("that's a 2-vCPU
 * VM with 4 GB") or react to a failure ("exit 1 — fixing the import").
 *
 * This middleware sits OUTSIDE the MCP Apps middleware. When a pass ends with
 * tool results the model hasn't seen, it holds back RUN_FINISHED and runs the
 * chain again with the updated messages, stitching every pass into one run.
 * Widget → server proxy requests pass straight through.
 */
export class ContinueAfterAppsMiddleware extends Middleware {
	constructor(private readonly maxContinuations = 3) {
		super();
	}

	run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
		if ((input.forwardedProps as Record<string, unknown> | undefined)?.__proxiedMCPRequest) {
			return this.runNext(input, next);
		}

		return new Observable<BaseEvent>((subscriber) => {
			let inner: Subscription | undefined;
			let closed = false;

			const pass = (passInput: RunAgentInput, turn: number) => {
				let finished: BaseEvent | null = null;
				let sawToolResult = false;
				let messages: Message[] = passInput.messages;

				inner = this.runNextWithState(passInput, next).subscribe({
					next: ({ event, messages: m }) => {
						messages = m;
						if (event.type === EventType.RUN_STARTED && turn > 0) return;
						if (event.type === EventType.RUN_FINISHED) {
							finished = event;
							return;
						}
						if (event.type === EventType.TOOL_CALL_RESULT) sawToolResult = true;
						subscriber.next(event);
					},
					error: (err) => subscriber.error(err),
					complete: () => {
						if (closed) return;
						// Activity messages (the rendered app) aren't part of the model's transcript.
						const lastReal = [...messages].reverse().find((msg) => (msg.role as string) !== "activity");
						if (finished && sawToolResult && lastReal?.role === "tool" && turn < this.maxContinuations) {
							pass({ ...passInput, messages }, turn + 1);
							return;
						}
						if (finished) subscriber.next(finished);
						subscriber.complete();
					},
				});
			};

			pass(input, 0);
			return () => {
				closed = true;
				inner?.unsubscribe();
			};
		});
	}
}
