// THE SHARED HALF: the rules that every producer of session rows must obey, in ONE place.
//
// WHY THIS IS A PACKAGE AND NOT A DOCUMENT. Two repositories produce the same rows -- `dsh-system1-observer` from a
// session LOG, and `dsh-session-index` from the same log into a SQLite index -- and until now each of them said the
// rules in its own words. That is how they came to disagree about who spoke (**F173**), about the digest (**F174**)
// and about the TEXT of a message (**F177**, a trailing space), about the meaning of a block's `thinking` field
// (**F179**), and about a NUL byte (**F180**, which SQLite keeps only the bytes before). Every one of those was
// silent, and every one of them was found by MEASURING the two channels against each other rather than by reading
// either of them.
//
// So the rules live here, and a FIXTURE says what they produce. A repository that changes a rule changes the fixture
// with it, and the other repository's conformance test goes red.
//
// WHAT IS IN HERE, and what is not: the PRODUCER side. The vocabulary (what a row may be), the text rules, the source
// rule, and the fixture. The CONSUMER side -- what an instrument does with the rows -- stays with the instrument,
// because a producer has no business in it.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Every row kind, so a producer cannot invent one. */
export const ROW_KINDS = Object.freeze(['receipt', 'message', 'tool_call', 'fact'])

/** The roles a message may carry. Anything else is a producer that has drifted from this contract. */
export const MESSAGE_ROLES = Object.freeze(['user', 'assistant', 'system', 'developer', 'tool'])

/** The message body kinds. `text` and `reasoning` are separate, so a count of one is not a count of the other. */
export const MESSAGE_TYPES = Object.freeze(['text', 'reasoning'])

/**
 * THE REPLACEMENT CHARACTER, and the one byte a row may not carry.
 *
 * `node:sqlite` binds a JavaScript string with NUL-terminated semantics: what lands in the column is the bytes
 * BEFORE the first NUL, and everything after it is gone. Measured on the live corpus: 67 messages in 1 of 946
 * sessions held a NUL in their text, and the index stored 11 characters where the log held 100 -- the other 89 were
 * not shortened, they were DROPPED, and the row read as though the model had said less. Two tool-call names became
 * empty strings the same way, so a call read as a call that named no tool.
 *
 * WHY U+FFFD AND NOT A DELETION. A NUL is not a character anybody reads, and every consumer downstream -- a JSONL
 * file, an HTTP body, a model's context window -- either truncates at one or mangles it. U+FFFD is the standard
 * marker for a byte that could not be represented, so the text KEEPS ITS LENGTH, the reader can see that something
 * was there, and both producers produce the same characters. A silent deletion would make the two producers agree
 * too, and would do it by throwing away evidence.
 */
export const REPLACEMENT_CHARACTER = '\uFFFD'

/**
 * The same string, with every NUL replaced by U+FFFD. A non-string is returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
export function withoutNuls(value) {
    if (typeof value !== 'string') return value
    if (!value.includes('\u0000')) return value
    return value.split('\u0000').join(REPLACEMENT_CHARACTER)
}

/**
 * THE VISIBLE TEXT of a message, and the whole text rule in one function.
 *
 * FOUR RULES, each bought by a measurement:
 *   1. ONLY A `text` BLOCK IS TEXT. The harness's `ContentBlockMap` declares `'text': TextBlock` as
 *      `{type:'text'; text:string}` and `ReasoningBlock` carries a `text` field too, so a reader that takes `.text`
 *      from ANY block hands the model its own reasoning as though the operator had typed it. A `thinking` block is
 *      not a reasoning block either: pi's `thinking` is renamed to `reasoning` on the way in, and accepting both
 *      would be a second way to read one vocabulary (**F179**).
 *   2. A BLOCK'S TEXT MUST BE A STRING, or there is no text to read. A number became its digits in one producer and
 *      nothing in the other (**F179**).
 *   3. THE TEXT IS TRIMMED. The observer trimmed it and the store did not, so one message had two texts -- 58
 *      characters in one channel, 59 in the other, the difference being a trailing space -- and 53 of the 946 sessions
 *      in the live corpus differ that way. The `stateHash` of a measurement is made of the text, so those were two
 *      readings of one conversation (**F177**).
 *   4. AND NO NUL BYTE, for the reason `withoutNuls` gives (**F180**).
 *
 * A string body is text: an untyped string is not a block, and it is not reasoning.
 *
 * @param {unknown} content  a message's `content`: a string, or an array of blocks
 * @returns {string}
 */
export function visibleText(content) {
    if (typeof content === 'string') return withoutNuls(content.trim())
    if (!Array.isArray(content)) return ''
    return withoutNuls(content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
        .trim())
}

/**
 * THE REASONING of a message, joined with a newline, trimmed, and NUL-free.
 *
 * A NEWLINE AND NOT NOTHING, because the two producers used to join the same blocks differently and the composed
 * state -- what a measurement's `stateHash` is made of -- differed. The reasoning is NOT included in the visible text:
 * the judge has never been given it, and folding it in now would change what every reading means. Whoever gives
 * reasoning to the judge decides that, in one place.
 *
 * @param {unknown} content
 * @returns {string}  the empty string when there is no reasoning
 */
export function reasoningText(content) {
    if (typeof content === 'string') return ''
    if (!Array.isArray(content)) return ''
    return withoutNuls(content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'reasoning' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim())
}

/** The `source.kind` a DIRECT HUMAN prompt carries. The other kinds are the harness speaking on the same channel. */
export const HUMAN_SOURCE_KIND = 'user'

/**
 * The `source.kind` of one event, or `''` when the event declares none.
 *
 * THE RULE: a `user/message` is the HUMAN only when its `data.source.kind` says so. The harness speaks on the user
 * channel -- a goal, a skill catalogue, a runtime context, an agent instruction -- and the event TYPE cannot tell them
 * apart. Measured on one real session: 753 `user/message` records, **403 of them the human and 350 the harness** -- so
 * counting the type inflated the ask count by **86.8%**, every injection opened an ask-group of its own, and the judge
 * was handed skill catalogues as though the operator had typed them (**F173**).
 *
 * Across the whole live corpus: 10,698 `user/message` records and **ZERO** without a source -- the harness refuses a
 * log that does not declare one.
 *
 * @param {object} event
 * @returns {string}
 */
export function sourceKindOf(event) {
    return String(event?.data?.source?.kind ?? '')
}

/**
 * Whether an event is a `user/message` whatever its source. Says NOTHING about who sent it -- that is
 * `isHumanMessage`'s question, and the difference between the two is the whole point.
 *
 * @param {object} event
 * @returns {boolean}
 */
export function isUserMessage(event) {
    return event?.type === 'user/message'
}

/**
 * Whether an event is the HUMAN speaking.
 *
 * @param {object} event
 * @returns {boolean}
 */
export function isHumanMessage(event) {
    return isUserMessage(event) && sourceKindOf(event) === HUMAN_SOURCE_KIND
}

/** The directory this package was loaded from, so the fixture is found without a path from the caller. */
const HERE = dirname(fileURLToPath(import.meta.url))

/** The fixture's two files, and the digest each one must have. */
export const FIXTURE_FILES = Object.freeze(['fixture/session.v4.jsonl', 'fixture/rows.jsonl'])

/**
 * THE FIXTURE, and its digest.
 *
 * A conformance fixture is only worth anything if BOTH sides are checked against the SAME bytes, so the digest is
 * part of the package and every repository that vendors the fixture pins it. When the rules change, the fixture
 * changes, the digest changes, and the vendored copies have to be updated -- deliberately, by a person who read why.
 *
 * @returns {{ session: string, rows: object[], digest: string }}
 */
export function readFixture() {
    const session = readFileSync(join(HERE, 'fixture/session.v4.jsonl'), 'utf8')
    const rows = readFileSync(join(HERE, 'fixture/rows.jsonl'), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line))
    return { session, rows, digest: fixtureDigest() }
}

/**
 * THE DIGEST of the fixture, over both files.
 *
 * @returns {string}  64 hex characters
 */
export function fixtureDigest() {
    const hash = createHash('sha256')
    for (const file of FIXTURE_FILES) {
        hash.update(file)
        hash.update(readFileSync(join(HERE, file)))
    }
    return hash.digest('hex')
}

/**
 * The digest of a fixture held ELSEWHERE, so a repository that vendors the fixture can prove it is the same bytes.
 *
 * @param {string} root  the directory holding `session.v4.jsonl` and `rows.jsonl`
 * @returns {string}  64 hex characters
 */
export function digestOf(root) {
    const hash = createHash('sha256')
    for (const file of FIXTURE_FILES) {
        hash.update(file)
        hash.update(readFileSync(join(root, file.split('/').pop())))
    }
    return hash.digest('hex')
}
