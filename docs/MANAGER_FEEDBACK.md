# Feedback from maintenance managers and QA

PlantMemory has no live plant users yet, so the next best evidence is people who do this
job reviewing it. This form is built so the answers become **numbers we can quote**
(with permission) on the deck: how long a breakdown decision takes today, how often
problems repeat, and whether the guide would be used.

How to run it (15 minutes per person):

1. Show the 3-minute video, or let them try the live link on their phone.
2. Give them a printed guide (TP-02 E-104 in English, Telugu and Hindi).
3. Ask the questions below. A Google Form works on a phone; a call works too.
   Write their words down as they say them, Telugu or English.

Ask permission first: "Can we quote your answers on a hackathon submission, with your
role and type of plant, but without your name or company?" Record yes/no.

## A. About them (no names)

1. Role: maintenance manager / engineer / supervisor / QA / production / other.
2. Years in pharma or similar regulated manufacturing.
3. Type of plant: oral solid dose / injectables / API / packaging / other.
4. Roughly how many machines they look after.

## B. How breakdowns are handled today (the baseline)

5. In a normal week, how many breakdowns stop a machine? (number)
6. When a machine stops, how long from the stop until the workers get a clear instruction
   on what to do? (minutes; typical, and the worst case they remember)
7. Out of 10 breakdowns, how many have happened before on the same machine? (0 to 10)
8. When it has happened before, how do they find what was done last time?
   (memory / ask a senior / breakdown logbook / SAP or CMMS / don't look)
9. How long does that search take? (minutes)
10. Has a fix ever not held, and the same breakdown come back within weeks? What did that
    cost? (open)
11. Where are the equipment manuals kept, and how often are they opened during a
    breakdown? (open)
12. Can workers carry phones on the floor? Who can? (open)

## C. Reaction to PlantMemory (1 = strongly disagree, 5 = strongly agree)

13. The repair guide is what I would tell my technicians myself.
14. Seeing "3rd time in 12 months, last fix didn't hold" would change what I do.
15. I trust a step more because it shows the manual page or the past record.
16. The printed sheet in Telugu/Hindi is usable by the technicians on the floor.
17. Approving on my phone, with QA only when something is flagged, fits how we work.
18. Talking to it in my own language is faster than typing.
19. I would use this on the next breakdown.

## D. Numbers we can use

20. With this, how long would it take you to give workers an instruction? (minutes)
21. Which part would save the most time? (finding past fixes / manual steps / parts and
    stock / translation and printing / voice)
22. What would stop your plant using it? (data access, IT approval, validation / CSV,
    SAP connection, language, cost, other)
23. Would QA accept an AI-drafted guide that a person approves? What would QA need to see?
24. What is one thing it got wrong or is missing?

## E. Three real breakdowns, in their words

25. Describe three breakdowns you remember, the way you would tell a colleague or write
    in the logbook: the machine type (not the plant or company), what happened, what the
    screen showed, what fixed it, and whether it came back. Any language, any shorthand.

These become a held-out test set nobody on the team wrote. Run each through PlantMemory
and record whether it found the right manual section, raised a repeat only when the
plant's records support one, and flagged anything it could not source. That answers the
main limit in [EVAL_RESULTS.md](EVAL_RESULTS.md): the same team wrote the records, the
tests and the prompts.

## F. Open

26. Anything else? A breakdown story where this would or would not have helped.

## Turning answers into deck numbers

- **Time to instruction today** (Q6) vs **with PlantMemory** (Q20, and our measured
  ~20 s draft + their review). Report the median across people, with n.
- **Repeat share** (Q7): "managers estimate X of 10 breakdowns are repeats". This is the
  problem PlantMemory's repeat warning targets.
- **Search time** (Q9): minutes spent finding past fixes today.
- **Would use** (Q19): count of 4s and 5s out of n.
- Quote one or two sentences verbatim, with role and plant type only.

Keep the raw answers out of the public repository unless every respondent agreed.
