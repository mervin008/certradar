---
title: Your certificate inventory is exact. Your tickets are not.
published: false
description: Splitting certificate triage between code that knows the facts and a decision model that reads the ticket, and what happened when I measured it against an ordinary LLM.
tags: security, ai, devops, webdev
cover_image: https://mervinjones.dev/assets/blog/certradar-ask-the-reporter.png
canonical_url: https://mervinjones.dev/blog/certificate-triage-decision-model.html
---

Every certificate team has read this ticket:

> We renewed the certificate yesterday and I can see the new one in the portal, but about half of our customers still get a warning.

Two things are true at once here. Your inventory knows exactly what is deployed, down to the serial and the second of expiry. And the person who filed the ticket has told you almost nothing you can query on.

The gap between those two sentences is where certificate triage actually happens, and it is the part nobody automates. I spent a week building a triage tool to see how much of that gap a model can close, and — more usefully — where it should not be allowed anywhere near.

## The split

The rule I started with, and never had cause to break: **if the answer is computable, compute it.**

Expiry maths, chain building for a given client's trust store, SAN coverage including wildcards, whether a CAA record permits the CA your ACME client is using, which endpoints serve which serial — none of that belongs in a model. It is arithmetic and string matching, and a model can only make it less reliable.

What code cannot do is read "about half of our customers" and know that means some nodes behind a load balancer still serve the old certificate. Or read "trust anchor for certification path not found, but the website works in Chrome on the same phone" and understand that the phrase *on the same phone* is the whole diagnosis, because it rules out the trust store and points at a missing intermediate.

So: code owns the facts, the model reads the prose, and a fixed policy in ordinary code decides what happens. The model never acts.

## Don't hand it the inventory

The tempting design is to give the model the estate and ask which certificate the ticket is about. It does not survive contact with a real inventory.

A synthetic estate of 500 certificates costs about 20,000 tokens to describe, which is most of a request before you have asked anything. At 10,000 certificates it does not fit at all. Accuracy also drops as you pad the input with irrelevant detail, which is the documented failure mode for this class of model and the intuitive one for any other.

What works is the boring thing. Code extracts the CN or hostname — from the intake form if the reporter gave one, otherwise from the ticket text — and matches it against the inventory exactly: common name, SANs, wildcards, and every endpoint serving that host. Only the matches go to the model, capped at twelve. The other 488 certificates never leave the server.

That cap is what makes the cost independent of the estate. Triaging a ticket against 500 certificates and against ten million costs the same, because the model sees the same handful either way.

## When it cannot tell, it asks

Plenty of tickets name no host at all. "Old iPhones stopped loading product images this morning." For those, one question to the model — which service in the catalogue is this about — is enough for code to do the lookup.

But sometimes the honest answer is that nobody knows yet. A ticket about mTLS failures between two internal services mapped to a service with 81 certificates, one per pod. Twelve is the cap, 81 is well past it, and picking one would be theatre.

So the tool asked the reporter for the exact CN, along with the error, where it fails and since when.

![Triage outcome: 81 certificates match, too many to guess from. Ask for the certificate's CN or hostname, the exact error, where it fails, and since when.](https://mervinjones.dev/assets/blog/certradar-ask-the-reporter.png)

The answer came back as `orders-17`. Code then found, in one exact lookup, a pod still serving a certificate that had expired three hours earlier — while the renewed one sat in the inventory, issued and never deployed. cert-manager had done its job. The pod never reloaded.

> Asking "which CN?" costs one message. Guessing across 81 certificates costs an incident review.

## What the model is actually for

The model I used is Jev, TypeSafe's System One model, which does not generate text at all. You send it state and typed questions, and it returns typed answers with probabilities: one option from a set you defined, a position on a scale you defined, or the probability that a yes/no statement is true. There is nothing to parse and no prose to second-guess.

Triage became two requests. The first gets the ticket and nothing else, and answers what the reporter is describing, how urgent it sounds, and which service it concerns. The second gets the matched certificates and the findings the automated checks produced, and asks one yes/no question per finding: would this problem cause the failure this person is describing?

Keeping the inventory out of the first request is deliberate. It means the reading of the symptoms and the reading of the evidence are independent, so when they agree, the agreement is worth something. That cross-check is the part I would keep in any design, whatever model sits behind it.

## Then I measured it against an ordinary LLM

The obvious question: why not just call a normal model? So I built the same pipeline again on gemini-3.5-flash-lite — same lookup code, same questions, same policy, structured JSON output — and ran both over the same tickets.

```text
Same 9 tickets, same code, same policy

Jev (jev-1.13.0)          8 of 9 causes   596 ms    $0.09 / 1,000 tickets
gemini-3.5-flash-lite     8 of 9 causes 1,420 ms    $0.94 / 1,000 tickets
```

Accuracy tied, and they failed on different tickets, which is about what nine samples can tell you. Ten times the cost and a bit over twice the latency is a real difference at volume, but it is not the interesting part.

The interesting part was the probabilities. Asked "would this finding cause what the reporter describes?", the LLM answered **1.00**. Every finding, every ticket, including a stale-certificate finding paired with a ticket about payment timeouts that had nothing to do with TLS. Jev gave that pair **0.29**.

The LLM did not act wrongly on it, but only because its self-reported cause confidence happened to land on 0.50 that time — and its confidences across the run were 0.50, 0.80, 0.85, 0.90, 0.95. Round numbers it wrote about itself.

> A threshold is only as good as the number you put it on.

If you are gating an automatic action on a probability, that is the whole ballgame. A model that says 1.00 to everything has not given you a probability. It has given you a shape that looks like one.

## What I would require before letting this act

- **No probability moves a key.** Issuance, revocation and export stay behind RBAC and human approval. A model can rank, link and explain. It does not get to sign.
- **Narrow in code first.** A handful of candidates, never the estate. It is cheaper, more accurate, and the cost stops scaling with your inventory.
- **Ask a person a specific question** when the narrowing is ambiguous. "Which CN?" beats a confident guess.
- **Write the probability, the thresholds and the model version into the audit log** next to the decision. A decision you cannot replay six months later is not auditable, and "the model said so" is not a root cause.
- **Pin the model version.** Thresholds are tuned against specific behaviour, and an alias like `jev-latest` moves underneath you.
- **Measure wrong automatic actions, not accuracy.** Accuracy is a number for a slide. The operational question is how often the system did something it should not have.

## Where this goes

Ticket triage was the demo, because a ticket is the clearest case of prose meeting exact data. The same shape fits three more jobs I care about rather more, and they are next for [CertPilot](https://certpilot.mervinjones.dev/):

- **Discovery.** CT logs surface a certificate for one of your domains that the inventory cannot match by name. Is it a team you do not know about, a SaaS vendor operating legitimately, or a lookalike worth an alert?
- **Renewal failures.** A durable queue with retries is correct design and wrong behaviour for a CAA misconfiguration — it will retry twenty times and burn the CA's rate limit. Code reads the structured ACME error; something else has to read the prose the CA sends back and decide retry, back off, or hand over.
- **Rollout safety.** During a deployment wave, the signal that you broke an old client usually arrives as a support ticket, not a failed probe. Link fresh tickets to the hosts just deployed, and hold the wave.

The demo runs on a synthetic estate with invented tickets, so treat the numbers as a demonstration rather than a benchmark: fourteen labelled tickets, nine of them in the LLM comparison because of a free-tier quota. What is real is the model traffic, the latency and the cost, and every request and response is on screen.

[CertRadar is here](https://certradar-jev.mervinjones.dev/) if you want to click through it. Every step shows the exact JSON that went to the model, the exact JSON that came back, and what the decision cost.
