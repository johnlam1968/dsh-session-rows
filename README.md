# dsh-session-rows

**The rules every producer of session rows must obey, and the fixture that pins them.**

Two repositories produce the same rows — `dsh-system1-observer` from a session **log**, and `dsh-session-index` from
the same log into a SQLite **index** — and until this package existed, each of them said the rules in its own words.
That is how they came to disagree:

| finding | what the two channels disagreed about |
|---|---|
| **F173** | **who spoke** — one counted a `user/message` record as a person, the other read the `source.kind`; the ask count was inflated by **86.8%** |
| **F174** | **the digest** — the index stored 16 hex characters of a sha256, so every session in it was unmeasurable |
| **F177** | **the text of a message** — one trimmed it and one did not, so 53 of 946 sessions had two texts, and the `stateHash` of a measurement is made of the text |
| **F179** | **a block's `thinking` field** — one read it as visible text, and reasoning blocks were joined differently |
| **F180** | **a NUL byte** — `node:sqlite` keeps only the bytes before one, so 67 messages in one session were 11 characters in the index and 100 in the log |

Every one of those was **silent**, and every one was found by *measuring the two channels against each other* rather
than by reading either of them. So the rules live here, in one place, and a **fixture** says what they produce.

## What is in here

| | |
|---|---|
| `ROW_KINDS`, `MESSAGE_ROLES`, `MESSAGE_TYPES` | the vocabulary a producer may not invent |
| `withoutNuls(text)` | the NUL rule, and why it is U+FFFD and not a deletion |
| `visibleText(content)` | the whole text rule: only a `text` block is text, a string body is text, the text is trimmed, and no NUL byte |
| `reasoningText(content)` | the reasoning rule: only a `reasoning` block, joined by a newline, and never in the visible text |
| `sourceKindOf`, `isUserMessage`, `isHumanMessage` | the source rule: the event type does not say who spoke |
| `readFixture()`, `fixtureDigest()`, `digestOf(root)` | the conformance fixture and its digest |

**What is NOT in here:** the consumer side. What an instrument does with the rows — the segmentation, the summary, the
ask-groups — is the instrument's business, because a producer has no business in it.

## The fixture

`fixture/session.v4.jsonl` is a session log in the format this repository owns
([`docs/session-log-format.md`](https://github.com/johnlam1968/dsh-system1-observer/blob/composing-tools/docs/session-log-format.md)),
and `fixture/rows.jsonl` is the rows every producer must produce from it. Between them they exercise every rule:

- a text with a **trailing space**, which must come out trimmed;
- a message inside a compaction's replaced span, which must come out **shadowed**;
- a **harness injection**, which must come out as `system` and not as the human;
- a message the model was **cut off in**, which must carry `interrupted: true`;
- a text with a **NUL byte**, written as the JSON escape so the file stays valid JSONL, which must come out as U+FFFD;
- a **tool call**, with its name and its arguments.

**A repository that vendors the fixture pins the digest**, so a fixture that changes in one place cannot be quietly
different in another:

```js
import { digestOf } from 'dsh-session-rows'
assert.equal(digestOf('test/fixtures/session-rows'), PINNED_DIGEST)
```

## Why the fixture exists at all, when the rules are here

Because **the rules were said twice before, and the second copy drifted.** The fixture is what makes a change on one
side a change on the other by construction rather than by discipline: change a rule, change the fixture with it, and
the other repository's conformance test goes red.

**The end state is that neither repository IMPORTS this package yet** — the rules are still said in both, and the
fixture is what holds them together. The import is the next step, and it waits on this package being **published**:
the observer and the store are separate published packages, and a published package cannot depend on a `file:` path.

## Licence

MIT. It imports no dsh code, no harness code, and nothing but `node:` builtins.
