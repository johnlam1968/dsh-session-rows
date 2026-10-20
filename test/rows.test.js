// THE RULES, and the fixture that pins them.
//
// Every assertion here is a measurement that cost something, and the evidence is in the comment beside it. The point
// of the package is that these rules are said ONCE: two repositories produce the same rows, and when each said the
// rules in its own words they drifted -- about who spoke, about the digest, about the text of a message, about a
// block's `thinking` field, and about a NUL byte that SQLite keeps only the bytes before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MESSAGE_ROLES,
    MESSAGE_TYPES,
    REPLACEMENT_CHARACTER,
    ROW_KINDS,
    digestOf,
    exchangeIndexOf,
    fixtureDigest,
    isHumanMessage,
    isUserMessage,
    readFixture,
    reasoningOf,
    reasoningText,
    sourceKindOf,
    surfaceEvents,
    visibleText,
    withoutNuls,
} from '../index.js'

test('THE VOCABULARY IS DECLARED, so a producer cannot invent a row kind or a role', () => {
    assert.deepEqual(ROW_KINDS, ['receipt', 'message', 'tool_call', 'fact'])
    assert.deepEqual(MESSAGE_ROLES, ['user', 'assistant', 'system', 'developer', 'tool'])
    assert.deepEqual(MESSAGE_TYPES, ['text', 'reasoning'])
})

test('ONLY A `text` BLOCK IS TEXT, and the reasoning is never in it', () => {
    // THE HARNESS'S OWN TYPE SAYS WHY. `ContentBlockMap` declares `'text': TextBlock` as `{type:'text'; text:string}`
    // and `ReasoningBlock` carries a `text` field too -- so a reader that takes `.text` from ANY block hands the model
    // its own reasoning as though the operator had typed it (F79 in the observer's register).
    assert.equal(visibleText([{ type: 'text', text: 'said' }]), 'said')
    assert.equal(visibleText([{ type: 'reasoning', text: 'thought' }]), '', 'a reasoning block is not text')
    // AND A `thinking` BLOCK IS NOT A REASONING BLOCK: pi's `thinking` is renamed to `reasoning` on the way in, and
    // accepting both here would be a second way to read one vocabulary (F179).
    assert.equal(visibleText([{ type: 'thinking', thinking: 'hmm' }]), '')
    assert.equal(reasoningText([{ type: 'thinking', thinking: 'hmm' }]), '', 'and it is not reasoning either')
    // AND A BLOCK THAT CLAIMS TO BE TEXT AND CARRIES REASONING IS NOT TEXT: the observer's reader returned nothing for
    // it, and the store used to surface its reasoning as VISIBLE TEXT.
    assert.equal(visibleText([{ type: 'text', thinking: 'a secret' }]), '')
    // AND A NON-STRING TEXT IS NOT TEXT: a number became its digits in one producer and nothing in the other.
    assert.equal(visibleText([{ type: 'text', text: 42 }]), '')
})

test('THE TEXT IS TRIMMED, because a trailing space is load-bearing in a hash', () => {
    // MEASURED: the observer trimmed it and the store did not, so one message had two texts -- 58 characters in one
    // channel, 59 in the other -- and 53 of the 946 sessions in the live corpus differ that way (F177). The stateHash of
    // a measurement is made of the text, so those were two readings of one conversation.
    assert.equal(visibleText([{ type: 'text', text: 'push this repo ' }]), 'push this repo')
    assert.equal(visibleText('a string body '), 'a string body')
    // AND THE WHITESPACE INSIDE IS KEPT, because it is the model's and a judge can be asked about it.
    assert.equal(visibleText([{ type: 'text', text: 'a  b' }]), 'a  b')
})

test('A NUL BYTE IS REPLACED, because SQLite keeps only the bytes before it', () => {
    // MEASURED: `node:sqlite` binds a string with NUL-terminated semantics, so a message holding a NUL was stored as
    // the characters before it and nothing after -- 67 messages in 1 of 946 sessions were 11 characters in the index
    // and 100 in the log, and two tool-call names became empty strings (F180).
    assert.equal(withoutNuls('before\u0000after'), 'before\uFFFDafter')
    assert.equal(withoutNuls('a\u0000b').length, 3, 'and the text keeps its length')
    assert.equal(withoutNuls('plain'), 'plain', 'and a text with no NUL is untouched')
    assert.equal(withoutNuls(null), null, 'and a non-string is left alone')
    assert.equal(visibleText([{ type: 'text', text: 'a\u0000b' }]), 'a\uFFFDb')
    assert.equal(REPLACEMENT_CHARACTER, '\uFFFD')
})

test('THE REASONING IS JOINED BY A NEWLINE, and it is not the visible text', () => {
    assert.equal(reasoningText([{ type: 'reasoning', text: 'first' }, { type: 'reasoning', text: 'second' }]), 'first\nsecond')
    // AND IT IS NOT IN THE VISIBLE TEXT, because the judge has never been given it.
    assert.equal(visibleText([{ type: 'reasoning', text: 'first' }, { type: 'text', text: 'said' }]), 'said')
})

test('THE SOURCE KIND SAYS WHO SPOKE, and the event type does not', () => {
    // MEASURED: 753 `user/message` records on one real session, 403 the human and 350 the harness, and counting the
    // TYPE inflated the ask count by 86.8% -- the judge was handed skill catalogues as though the operator had typed
    // them (F173). Across the live corpus: 10,698 records and ZERO without a source.
    const human = { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'the ask' }] } }
    const injected = { type: 'user/message', data: { source: { kind: 'goal' }, content: [{ type: 'text', text: 'GOAL: finish' }] } }
    const silent = { type: 'user/message', data: { content: [{ type: 'text', text: 'no source at all' }] } }
    assert.equal(isUserMessage(human), true)
    assert.equal(isHumanMessage(human), true)
    assert.equal(isUserMessage(injected), true)
    assert.equal(isHumanMessage(injected), false, 'the harness speaks on the user channel, and it is not the human')
    // AND A MESSAGE WITH NO DECLARED SOURCE IS NOT THE HUMAN: the log refuses one, and a reader that called it the
    // human would count an injection as an ask.
    assert.equal(isHumanMessage(silent), false)
    assert.equal(sourceKindOf(silent), '', 'and the kind it does not declare is the empty string, not a guess')
})

test('THE FIXTURE IS THE FIXTURE, and its digest is what both sides pin', () => {    const { session, rows, digest } = readFixture()
    assert.equal(digest.length, 64, 'the digest is a whole sha256')
    assert.equal(digest, fixtureDigest(), 'and reading it twice gives the same answer')
    assert.equal(digestOf(new URL('../fixture/', import.meta.url).pathname), digest, 'and a vendored copy has to be the same bytes')
    // AND THE FIXTURE EXERCISES EVERY RULE, or it is decoration: a trimmed text, a shadowed message, a harness
    // injection, an interrupted message, a NUL byte, and a tool call.
    assert.match(session, /push this repo /, 'a text with a trailing space')
    assert.match(session, /\\u0000/, 'a NUL byte, written as the JSON escape so the file stays valid JSONL')
    const texts = rows.filter((r) => r.kind === 'message').map((r) => r.text)
    assert.ok(texts.includes('push this repo'), 'and the trimmed text in the expected rows')
    assert.ok(texts.some((t) => t.includes(REPLACEMENT_CHARACTER)), 'and the NUL replaced in the expected rows')
    assert.ok(rows.some((r) => r.shadowed === true), 'and a message the compaction withdrew')
    assert.ok(rows.some((r) => r.interrupted === true), 'and a message the model was cut off in')
    assert.ok(rows.some((r) => r.role === 'system'), 'and the harness speaking')
    assert.ok(rows.some((r) => r.kind === 'tool_call'), 'and a tool call')
    // AND NO EXPECTED ROW CARRIES A NUL OR UNTRIMMED TEXT, because the fixture IS the contract.
    for (const row of rows) {
        if (typeof row.text === 'string') assert.equal(row.text, row.text.trim(), 'the expected text is trimmed')
        assert.ok(!JSON.stringify(row).includes('\u0000'), 'and no expected row carries a NUL byte')
    }
})

test('THE ASK-GROUP IS DERIVED FROM WHERE THE HUMAN SPOKE, and never from a native turn', () => {
    const human = (text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
    const injected = () => ({ type: 'user/message', data: { content: [{ type: 'text', text: 'goal' }], source: { kind: 'goal' } } })
    const answer = () => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'ok' }] } } })
    const call = () => ({ type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: '{}' } })

    // TWO ASKS, AND EVERYTHING BETWEEN THEM BELONGS TO THE GROUP THE HUMAN OPENED.
    assert.deepEqual(
        exchangeIndexOf([human('one'), answer(), call(), human('two'), answer()]),
        [0, 0, 0, 1, 1],
    )

    // AN INJECTION IS NOT AN ASK, and it does not open a group. This is the rule that was worth 86.8%: on one real
    // session, counting the RECORD TYPE rather than the SPEAKER opened 753 groups where there were 403.
    assert.deepEqual(
        exchangeIndexOf([human('one'), injected(), answer()]),
        [0, 0, 0],
        'the harness speaking joins the group the human opened',
    )

    // THE LEADING RUN before the first ask belongs to the FIRST group: a session that opens with narration has not
    // asked anything yet, and a group numbered -1 is a key no query knows how to select.
    assert.deepEqual(
        exchangeIndexOf([answer(), injected(), human('one'), answer()]),
        [0, 0, 0, 0],
        'the leading run is the first group, not a group of its own',
    )

    // AN EMPTY STREAM IS AN EMPTY ANSWER, not a crash and not a group.
    assert.deepEqual(exchangeIndexOf([]), [])
    assert.deepEqual(exchangeIndexOf(undefined), [])

    // AND THE FIXTURE'S OWN ROWS AGREE WITH THE DERIVATION, because the fixture IS the contract: a group index is
    // the index of the ask the row belongs to, and the expected rows carry it.
    const { session, rows } = readFixture()
    const records = session.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
    const derived = exchangeIndexOf(records)
    const expected = rows.filter((row) => row.kind === 'message' || row.kind === 'tool_call')
    const groups = new Set(derived)
    for (const row of expected) assert.ok(groups.has(row.exchange), 'every expected group is one the derivation produced')
})

test('ONLY A `reasoning` BLOCK IS REASONING, and the absence is `null`', () => {
    // A `text` block is not reasoning, however much text it carries.
    assert.equal(reasoningText([{ type: 'text', text: 'said' }]), '')
    assert.equal(reasoningOf([{ type: 'text', text: 'said' }]), null)
    // AND A BLOCK WITH NO `text` IS NOT REASONING: the field is what makes it one.
    assert.equal(reasoningOf([{ type: 'reasoning' }]), null)
    // AND THE ABSENCE IS `null`, WHICH IS THE ROW'S FORM. An empty string is indistinguishable from an answer that
    // was genuinely empty, and a missing key is indistinguishable from a reader that never looked.
    assert.equal(reasoningOf([{ type: 'text', text: 'said' }]), null, 'absence is null and never an empty string')
    assert.notEqual(reasoningOf([{ type: 'text', text: 'said' }]), '', 'and never the empty string')
    // AND THE REASONING IS TRIMMED, like the text, because the two channels read the same message as the same
    // reasoning and the `stateHash` of a measurement is made of it.
    assert.equal(reasoningOf([{ type: 'reasoning', text: '  thought  ' }]), 'thought')
    // AND A STRING BODY IS NOT REASONING.
    assert.equal(reasoningOf('just a string'), null)
})

test('THE FIXTURE\'S ROWS FOLLOW FROM ITS SESSION BY THE PACKAGE\'S OWN RULES', () => {
    // WHY THIS TEST, AND WHY IT IS NOT A RESTATEMENT. A conformance fixture can DRIFT from the log it describes:
    // someone edits `session.v4.jsonl` and forgets `rows.jsonl`, and the fixture still agrees with ITSELF and says
    // nothing about the rules. So the package derives the rows from the session with its own functions and asserts
    // that the expected rows are what comes out. The package's own suite was blind to that drift; this is not.
    const { session, rows } = readFixture()
    const records = session.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
    const onSurface = new Set(surfaceEvents(records))
    const exchange = exchangeIndexOf(records)

    let ordinal = 0
    for (const record of records) {
        if (record.type !== 'user/message' && record.type !== 'assistant/message') continue
        ordinal += 1
        const row = rows.find((candidate) => candidate.kind === 'message' && candidate.seq === record.seq)
        assert.ok(row !== undefined, `the fixture has no row for seq ${record.seq}`)
        const content = record.type === 'user/message' ? record.data?.content : record.data?.message?.content
        const role = record.type === 'assistant/message'
            ? 'assistant'
            : (isHumanMessage(record) ? 'user' : 'system')
        assert.equal(row.text, visibleText(content), `the text of seq ${record.seq}`)
        assert.equal(row.role, role, `the role of seq ${record.seq}: the human is \`user\` and the harness is \`system\``)
        // THE REASONING BELONGS TO THE ASSISTANT, and a user's reasoning block is not one.
        assert.equal(row.reasoning, role === 'assistant' ? reasoningOf(content) : null, `the reasoning of seq ${record.seq}`)
        assert.equal(row.shadowed, !onSurface.has(record), `the shadowed flag of seq ${record.seq}`)
        assert.equal(row.exchange, exchange[records.indexOf(record)], `the ask-group of seq ${record.seq}`)
        assert.equal(row.ordinal, ordinal, `the ordinal of seq ${record.seq}`)
        assert.equal(row.interrupted, typeof record.data?.interrupted === 'boolean' ? record.data.interrupted : null,
            `the interrupted flag of seq ${record.seq}: a fact or an absence`)
    }

    // AND THE TOOL CALLS, whose name and arguments carry no NUL.
    for (const record of records) {
        if (record.type !== 'tool/call') continue
        const row = rows.find((candidate) => candidate.kind === 'tool_call' && candidate.seq === record.seq)
        assert.ok(row !== undefined, `the fixture has no row for the tool call at seq ${record.seq}`)
        assert.equal(row.name, withoutNuls(record.data?.name ?? null), `the name of the call at seq ${record.seq}`)
        assert.equal(row.args, withoutNuls(record.data?.arguments ?? null), `the arguments of the call at seq ${record.seq}`)
        assert.equal(row.callId, record.data?.callId ?? null)
    }
})
