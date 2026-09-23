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
sections Status, Context, Decision and Consequences. Once an ADR is accepted it is not edited;
to change a decision, write a new ADR that supersedes it.

## Consequences

Anyone can read `docs/adr/` to learn why coxswain is built the way it is.
