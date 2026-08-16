# Audience

## Who they are

**Implementation and Customer Success leads at mid-size B2B SaaS companies
that run a high-touch or hybrid onboarding motion** -- specifically the
person who owns the recurring paperwork of onboarding a new customer:
onboarding guides, implementation runbooks, configuration documents,
rollout playbooks, proposal/SOW documents, and QBR decks.

Typical titles: Director of Implementation, Head of Customer Success, VP
Customer Success, Head of Professional Services, Customer Operations Lead.
Typical company shape: 50-500 employees, B2B SaaS, a implementation or
professional-services function that exists specifically because
onboarding isn't self-serve.

This is deliberately narrower than "all SaaS companies." A company with a
pure self-serve, no-CS-team motion is explicitly out of scope -- see
`is_deliberately_off_icp` targets in the synthetic generator, which exist
so the machine has to actually discriminate, not just approve everything.

## What they do today instead of using SuperDocs

They write the first version of each document once (often in a Google Doc
or Notion template), then for every new customer: copy the template,
manually find-and-replace the customer-specific sections, paste in
AI-drafted or previously-written boilerplate, reformat, and send. When they
use an AI assistant at all, it's a chat window: they ask it to draft a
paragraph, then copy that paragraph back into the actual document by hand.
The editing labor -- not the drafting labor -- is what repeats on every
new account.

## What would genuinely make them switch

Not "AI that writes text" -- they already have that, from ChatGPT/Claude in
a browser tab. What's missing is AI that edits *inside* the document they
already have, so the copy-paste step disappears. The switch trigger is
usually a volume inflection point: new-customer count growing faster than
headcount on the implementation/CS team, so the manual editing step starts
visibly costing time that used to be absorbed. A second trigger: a new
hire on the team spending their first weeks just learning "how we format
the onboarding doc," which signals the process is undocumented tribal
knowledge sitting only in old files.

## How I would find the first ten

Real approach (not executed -- see the bright-line rule that this task
never contacts anyone):

1. Search job boards (LinkedIn, AngelList/Wellfound) for open "Director of
   Implementation," "Customer Success Ops," or "Professional Services"
   roles at Series A-C B2B SaaS companies -- a growing team here is itself
   a signal that the workload is real.
2. Read each company's public careers page and CS/Implementation job
   descriptions for phrases like "own the onboarding playbook," "maintain
   implementation documentation," "manage the SOW process" -- these are
   the companies whose CS/Impl teams are description-length-visible about
   doing exactly this work.
3. Cross-check against G2/Capterra categories with heavy "implementation"
   or "customer success" review language (companies whose own customers
   describe a multi-week onboarding process).
4. Compile: company name, size, implementation motion evidence, and the
   likely-buyer role -- exactly the schema `growth_machine` produces per
   target, just sourced from real public pages instead of a synthetic
   generator.

This machine implements steps 2-4 in its **optional public mode**
(`--input data/public_targets.json`), which consumes a human-curated list
of real company names/URLs and public facts. It defaults to fully
synthetic mode so it can be demonstrated, run twice, and shared without
depending on live web access or naming any real company inside generated
draft copy.
