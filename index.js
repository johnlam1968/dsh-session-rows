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
 * THE REASONING of a message, joined with a newline, trimmed, and NUL-free -- OR `null` WHEN THERE IS NONE.
 *
 * A NEWLINE AND NOT NOTHING, because the two producers used to join the same blocks differently and the composed
 * state -- what a measurement's `stateHash` is made of -- differed. The reasoning is NOT included in the visible text:
 * the judge has never been given it, and folding it in now would change what every reading means. Whoever gives
 * reasoning to the judge decides that, in one place.
 *
 * **AND `null` FOR THE ABSENCE, WHICH IS THE ROW'S FORM.** A row says "there was no reasoning" with `null`, never
 * with `''` and never with an absent key: an empty string is indistinguishable from an answer that was genuinely
 * empty, and a missing key is indistinguishable from a reader that never looked. `reasoningText` below is the same
 * rule in the TEXT's form, and a producer that writes a ROW must use THIS one -- otherwise the rule lives nowhere but
 * in the two producers that patch the value after the fact.
 *
 * @param {unknown} content
 * @returns {string|null}  the reasoning, or null when there is none
 */
export function reasoningOf(content) {
    if (typeof content === 'string') return null
    if (!Array.isArray(content)) return null
    const text = withoutNuls(content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'reasoning' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim())
    return text === '' ? null : text
}

/**
 * THE REASONING of a message as TEXT, and the empty string when there is none.
 *
 * The TEXT's form of the rule above, for a caller that wants the string and not the row's value. A producer of a
 * row wants `reasoningOf`, because a row carries `null` for the absence.
 *
 * @param {unknown} content
 * @returns {string}  the empty string when there is no reasoning
 */
export function reasoningText(content) {
    return reasoningOf(content) ?? ''
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

/**
 * THE ASK-GROUP INDEX of a record stream: which ask-group each record belongs to, BY POSITION.
 *
 * RULE 1 OF THE ROWS CONTRACT, and the reason the contract refuses a native `turn`: **the boundary is an ask-group,
 * derived from where the human spoke, and never a harness's own turn.** pi has no turn at all -- every pi message
 * in the surveyed corpus carried a null turn -- so a producer that keys on `turn` produces a query that looks
 * cross-harness and silently answers for one harness only.
 *
 * THE RULE IN THREE LINES. Each HUMAN message opens a group; everything after it belongs to that group until the
 * next human message. The human is `isHumanMessage`, not "a `user/message`" -- the harness speaks on the same
 * channel (a goal, a skill catalogue, a runtime context), and counting the type rather than the speaker opened an
 * ask-group for every injection: 753 groups where there are 403, on one real session.
 *
 * THE LEADING RUN before the first human message belongs to the FIRST group rather than to a group of its own: a
 * session that opens with narration has not asked anything yet, and a group numbered -1 is a key no query knows how
 * to select.
 *
 * WHY IT LIVES HERE AND NOT IN EACH PRODUCER. It is a rule about what a row MEANS, and it is the one rule a third
 * producer would otherwise restate: a pi producer that re-derived the grouping would be a third copy of the rule
 * that decides where a conversation turns.
 *
 * @param {object[]} records  the record stream, in order
 * @returns {number[]} one group index per record, by position
 */
export function exchangeIndexOf(records) {
    const list = Array.isArray(records) ? records : []
    const index = []
    let ordinal = -1
    for (const record of list) {
        if (isHumanMessage(record)) ordinal += 1
        index.push(Math.max(ordinal, 0))
    }
    return index
}

/**
 * THE SURFACE: the records that remain visible, in order.
 *
 * RULE 2 OF THE ROWS CONTRACT, and the reason a row carries a `shadowed` flag: **the log holds what the session ever
 * wrote; the model saw only what survived.** A record inside a replaced span is one the model cannot see, and a
 * producer that defaulted `shadowed` to `false` would produce a session that looks complete and measures text nobody
 * could read -- measured at 3,417 such messages in a single dsh session.
 *
 * THE OP, READ FROM THE DECLARATION rather than inferred: `surfaceOp: 'append' | { op: 'replace'; startSeq; endSeq }`.
 * Only `replace` removes anything; every other record is appended and stays. The ranges are INCLUSIVE at both ends,
 * and a replacement's own record carries a seq OUTSIDE its own range -- which is what makes the summary that replaces
 * a history the surfaced message rather than a casualty of its own replacement.
 *
 * WHY IT LIVES HERE AND NOT IN EACH PRODUCER. It decides what a row MEANS, and it is the rule a third producer would
 * otherwise restate. A substrate that withdraws records -- a compaction, a context edit -- says so with a `surfaceOp`,
 * and every producer then agrees on which records the model could see.
 *
 * @param {object[]} records  the record stream, in order
 * @returns {object[]} the records that remain on the surface
 */
export function surfaceEvents(records) {
    const list = Array.isArray(records) ? records : []
    const replaced = []
    for (const record of list) {
        const op = record?.surfaceOp
        if (op === null || typeof op !== 'object') continue
        if (op.op !== 'replace') continue
        if (typeof op.startSeq !== 'number' || typeof op.endSeq !== 'number') continue
        replaced.push([op.startSeq, op.endSeq])
    }
    // The common case costs nothing: no replacement means the log IS the surface.
    if (replaced.length === 0) return list
    return list.filter((record) => {
        const seq = record?.seq
        if (typeof seq !== 'number') return true
        return !replaced.some(([start, end]) => seq >= start && seq <= end)
    })
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
