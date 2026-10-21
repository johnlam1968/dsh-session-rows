// THE RULES MOVED, AND THIS NAME IS NOW A DOOR TO THEM.
//
// `dsh-session-rows` was the published package that owned the row contract: the row kinds, the roles, the message
// types, the NUL rule, the source rule, the exchange grouping, the surface fold, and the conformance fixture that
// says what they produce. Those rules are now in `system1-measure/rules` -- the MEASUREMENT's package, absorbed
// VERBATIM, so the bytes and the digest are the same ones this package has published since 0.2.0.
//
// WHY THE MOVE, MEASURED. The rules were in two places at once: here, and restated byte-for-byte in the observer's
// `core/session-rows.js`. A rule stated twice is a rule that will be changed in one place and not the other -- and
// the copies were byte-identical, so every test that compared them passed, and the drift would have come later, in
// the copy nobody was watching. The observer's copy is gone, and the rules live in ONE file.
//
// WHY THIS PACKAGE STILL EXISTS, AND WHY IT IS A SHIM RATHER THAN A DELETION. `npm install` does not follow a
// rename: a consumer that asks for `dsh-session-rows@^0.2.0` keeps resolving THIS package, and if this package were
// deleted the install would fail with a 404 rather than with a deprecation notice. So the name keeps working, it
// keeps serving the same rules, and it says out loud that it is a door rather than a home.
//
// THE PATH A CONSUMER SHOULD MOVE TO is `system1-measure/rules` -- the same module, by its own name. The store and
// the pi extension have already moved.
//
// AND THE FIXTURE STAYS HERE, because it is the proof that this name still serves the same bytes: the digest is
// computed over the file NAMES as well as their contents, and the copy in this repository is compared with the
// package's on every test run. A shim that quietly served DIFFERENT bytes would be worse than no shim at all.

/** The deprecation, as a sentence a reader can act on. */
export const DEPRECATION = 'dsh-session-rows is a shim: the rules live in `system1-measure/rules`. Install that.'

export * from 'system1-measure/rules'
