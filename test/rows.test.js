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
    fixtureDigest,
    isHumanMessage,
    isUserMessage,
    readFixture,
    reasoningText,
    sourceKindOf,
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

test('THE FIXTURE IS THE FIXTURE, and its digest is what both sides pin', () => {
    const { session, rows, digest } = readFixture()
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
