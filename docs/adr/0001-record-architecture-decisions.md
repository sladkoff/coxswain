# 1. Record architecture decisions

Date: 2026-09-23

## Status

Accepted

## Context

We need to record the architectural decisions made on coxswain, along with why we made them.

## Decision

We will use Architecture Decision Records, as described by Michael Nygard in
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Each ADR is a file in `docs/adr/` named `NNNN-short-title.md`, numbered in sequence, with the
sections Status, Context, Decision, Alternatives considered and Consequences.

The ADRs describe the decisions as they stand, not their history. When a decision changes, the ADR
is edited to say what holds now; when it no longer holds at all, the ADR is deleted. A new decision
gets the next number. Numbers are never reused, so a deleted ADR leaves a gap in the sequence.

## Consequences

Anyone can read `docs/adr/` to learn why coxswain is built the way it is.
