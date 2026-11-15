/**
 * Serve the goal game to an external agent over stdin/stdout, one JSON request
 * per line and one JSON response per line. See docs/kb/rl-agents.md.
 *
 *   npm run serve:goal
 */
import { createInterface } from "node:readline";
import { AgentBridge } from "../bridge";

const bridge = new AgentBridge();
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim()) process.stdout.write(JSON.stringify(bridge.handleLine(line)) + "\n");
}
