---
title: "P0299 Turbocharger Underboost with No Mechanical Turbo Fault"
doc_type: tsb
tsb_number: 23-0412
revision: "1"
issued_on: 2023-04-12
oem: Freightliner
model: Freightliner Cascadia
model_year: 2020-2023
system: engine
symptoms:
  - loss of power
  - derate
  - limp mode
  - hesitation
dtc_codes:
  - P0299
  - P2263
access_level: advisor
synthetic: true
---

# TSB 23-0412 - P0299 Turbocharger Underboost with No Mechanical Turbo Fault

## Applicability

2020-2023 Cascadia with the DD13 engine, built before 2023-02-28.

## Symptom

DTC **P0299** (turbocharger/supercharger underboost) sets, often with
**P2263** (turbocharger boost system performance), accompanied by a noticeable
loss of power and, on repeat occurrences, an engine derate. The turbocharger
itself passes inspection: shaft play is within specification, the compressor
wheel is undamaged, and the variable geometry actuator sweeps correctly on the
scan tool.

The fault is frequently intermittent, sets under load on a grade, and clears on
the next key cycle.

## Cause

A charge air cooler outlet hose clamp relaxes after repeated heat cycling,
allowing a boost leak under high load that is not present at idle or during a
static pressure test at low pressure. The ECM reads actual boost below
commanded boost and sets P0299.

The clamp does not fail visibly. A visual inspection will pass it.

## Correction

Do not replace the turbocharger for P0299 until the charge air system has been
pressure-tested at full boost pressure.

1. Pressure-test the charge air system at 200 kPa (29 psi). A test at
   typical shop-air pressure of 100 kPa will not reproduce the leak.
2. With the system pressurized, apply a soap solution to the charge air cooler
   outlet hose connection and watch for bubbles.
3. Replace the outlet hose clamp with revised constant-tension clamp part
   number CAC-4471-CT (supersedes CAC-3980).
4. Inspect the hose for heat damage and replace if the inner liner is cracked.
5. Re-test at 200 kPa and confirm the system holds.
6. Clear codes and road test under load on a grade.

### Diagnostic Values

| Measurement | Specification |
| --- | --- |
| Charge air system test pressure | 200 kPa (29 psi) |
| Maximum acceptable pressure decay | 10 kPa over 2 minutes |
| Commanded vs actual boost deviation (loaded) | Within 15 kPa |
| VGT actuator sweep | Full travel, no hesitation |

## Warranty

| Operation | Code | Time |
| --- | --- | --- |
| Charge air pressure test | 23041A | 0.7 h |
| Outlet hose clamp replacement | 23041B | 0.5 h |

## Advisor Notes

P0299 on a Cascadia in this range is worth checking against this bulletin
before authorizing turbocharger diagnosis. The difference between a 1.2-hour
clamp job and a turbocharger replacement is large enough that it is worth
saying to the customer up front that the charge air test comes first.
