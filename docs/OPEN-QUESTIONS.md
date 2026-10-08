# Open questions for the DA expert

Questions about the auto-analyzer that need a ruling. When one is
decided, change the code and the matching section of
[ANALYZER.md](ANALYZER.md), then delete the question from this list.

1. **Section size on short passages.** The student examples mark about
   three color sections per passage, sometimes inside a single Greek
   sentence (Phil 1:9–11). The analyzer's sections are runs of whole
   sentences, so it can't draw those. Should short passages get finer
   sections by another method, for example from the tree's top-level
   brackets?

2. **A sentence-initial subordinator with no main clause.** When a
   sentence opens with ὥστε, εἰ, ὅτι, … and never reaches its main clause,
   its relationship is dropped and the sentence joins its neighbor as a
   Series (about 8% of sentences; e.g. Rom 7:12's Ὥστε becomes Series
   instead of Inference). Should that relationship carry forward to the
   next sentence instead?

3. **Text flow: where a coordinated clause lines up.** When καί or δέ
   could continue either an inner or an outer clause, the auto flow puts it
   level with the nearest earlier clause whose verb has the **same mood**.
   This isn't in the handout, but it reproduces both handout examples
   exactly (10 of 10 coordinated lines, against 8 of 10 without it). Keep
   it, refine it, or replace it?

4. **Weak boundary signals fire too often.** "No shared vocabulary" fires
   at 63% of sentence boundaries, so pairs of weak signals create many
   small sections (e.g. Hebrews 4:11→12 splits despite v12 opening with
   γάρ). Suggested fix: ignore the weak signals when the new sentence opens
   with a binding connective (γάρ, ὅτι, ἵνα, ὥστε, καθώς).
