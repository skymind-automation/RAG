---
title: "Repeat No-Start After Weekend Standing - Telematics Module Sleep Fault"
doc_type: tsb
tsb_number: 22-1533
revision: "1"
issued_on: 2022-07-19
oem: RAM
model: RAM ProMaster
model_year: 2019-2022
system: electrical
symptoms:
  - no start
  - no crank
  - dead battery
  - parasitic draw
dtc_codes:
  - U0140
access_level: advisor
synthetic: true
---

# TSB 22-1533 - Repeat No-Start After Weekend Standing

## Applicability

2019-2022 ProMaster 2500 and 3500 with factory-installed telematics.

## Symptom

The vehicle starts normally during the working week but fails to crank after
standing two or more days. A jump start recovers it, and the battery tests good
once charged. The customer reports it as "the battery keeps dying" and the
battery is frequently replaced without fixing anything.

**U0140** (lost communication with body control module) may be stored.

## Cause

The telematics control unit fails to enter low-power mode when the last CAN
message before shutdown arrives inside a narrow timing window. The module stays
awake indefinitely, drawing approximately 220 mA. Over a 60-hour weekend that
is roughly 13 Ah — enough to take a healthy battery below cranking threshold.

The draw is not present after a normal shutdown, which is why it does not
reproduce on the shop floor on a Tuesday afternoon.

## Correction

1. Perform a parasitic draw test **after a minimum 45-minute sleep interval**.
   Measuring earlier will read normal module activity as a fault.
2. If draw exceeds 85 mA, pull the telematics fuse and re-measure.
3. If the draw drops to below 50 mA with the fuse pulled, this bulletin
   applies.
4. Reprogram the telematics control unit to software level 22.4.1 or later.
5. Re-test the draw after a further 45-minute sleep interval.
6. Load-test the battery. A battery that has been discharged below 10.5 V
   repeatedly will have permanently reduced capacity and should be replaced —
   but replace it *after* correcting the draw, not instead of.

### Acceptable Parasitic Draw

| Condition | Acceptable |
| --- | --- |
| 45 min sleep, no upfit | Under 50 mA |
| 45 min sleep, with telematics | Under 85 mA |
| Telematics module failing to sleep | ~220 mA (this fault) |

## Warranty

| Operation | Code | Time |
| --- | --- | --- |
| Parasitic draw test | 22153A | 1.0 h |
| TCU reprogram | 22153B | 0.5 h |

## Advisor Notes

The tell is "it only happens after the weekend". If a customer has already had
one or two batteries replaced under this complaint, this bulletin is the first
thing to check. Book it with enough time for the 45-minute sleep interval —
the test cannot be rushed and a hurried measurement is what produced the
previous misdiagnosis.
