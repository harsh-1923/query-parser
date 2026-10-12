// Asks kimi-k3 for a fictional demo directory (people + channels) for the site.
// Output: apps/site/src/demo-directory.json. Usage: node apps/site/scripts/gen-directory.mjs
import { writeFileSync } from "node:fs"
import { chat } from "../../../spikes/S04-time/llm.mjs"

const out = await chat(
  `Create a fictional company directory for a demo of a search box at a mid-size Indian tech company called "Lumen".

Return JSON only, shaped as:
{"people":[{"id":"u_<short>","name":"First Last","handle":"<handle>","team":"<team>"}],"channels":[{"id":"c_<short>","name":"#<channel-name>","topic":"<few words>"}]}

Requirements:
- 60 people. About 70% Indian names from different regions (north, south, east, west; Hindu, Muslim, Christian, Sikh names), the rest a mix of Western, East Asian and other names. Include deliberate collisions for testing: two people named Rahul (different surnames), two named Priya, and one Neha. Include Utkarsh Sharma, Ankit Jain, Sneha Rao, Arjun Mehta, Meera Pillai.
- Handles are lowercase like "utkarsh.s", "priya.iyer", "sneha".
- Teams from: payments, infra, design, growth, data, mobile, support, finance, people-ops, security.
- 24 channels, lowercase kebab-case, e.g. #infra, #payments-ops, #design-crit, #eng-alerts, #random, #launch-v2, #hiring.
- Everything fictional; no real public figures.`,
  { maxTokens: 32000 },
)
const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1))
writeFileSync(
  new URL("../src/demo-directory.json", import.meta.url),
  `${JSON.stringify(json, null, 2)}\n`,
)
console.log(`${json.people.length} people, ${json.channels.length} channels`)
