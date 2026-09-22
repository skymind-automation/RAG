---
title: "Cascadia Service Manual - Section 12: Aftertreatment and DPF Regeneration"
doc_type: manual
oem: Freightliner
model: Freightliner Cascadia
model_year: 2020-2024
system: emissions
access_level: advisor
synthetic: true
---

# Cascadia Service Manual - Section 12: Aftertreatment and DPF Regeneration

## Aftertreatment System Overview

The aftertreatment system comprises a diesel oxidation catalyst, a diesel
particulate filter, a decomposition tube with a DEF dosing injector, and a
selective catalytic reduction catalyst. Soot accumulates in the DPF during
normal operation and is burned off during regeneration.

Three regeneration modes exist:

- **Passive regeneration** — occurs continuously at highway exhaust
  temperatures with no driver involvement and no dash indication.
- **Active regeneration** — the ECM injects additional fuel to raise exhaust
  temperature. The DPF lamp may illuminate steadily. The vehicle can be driven
  normally.
- **Parked (stationary) regeneration** — requested by the operator or required
  by the ECM when soot load is too high for an active regen. Takes 20 to 60
  minutes with the vehicle stationary.

## Reading the Dash Indications

| Indication | Meaning | What the driver should do |
| --- | --- | --- |
| DPF lamp flashing | Soot load high; parked regen required | Park safely and initiate a parked regen |
| DPF lamp steady | Active regen in progress or soot load elevated | Continue driving at highway speed for 20-30 min |
| DPF lamp + check engine | Regen was not completed | Schedule service |
| DPF lamp + check engine + derate | Soot load critical, engine power reduced | Service now; parked regen may no longer clear it |
| DEF lamp steady | DEF level low | Refill DEF |
| DEF lamp flashing + derate | DEF empty or quality fault | Service now |

The most common fleet pattern is a vehicle on short urban routes that never
reaches passive regen temperature, escalating through active to parked regen to
derate over a few weeks. That is a duty-cycle problem, not a component failure,
and replacing the DPF will not fix it.

## Parked Regeneration Procedure

1. Park on a hard, level surface away from combustible material. Exhaust gas
   during a parked regen exceeds 600°C at the tailpipe.
2. Confirm fuel level above one quarter and DEF level above one quarter.
3. Apply the parking brake, place the transmission in neutral, and let the
   engine reach normal operating temperature.
4. Initiate the regen from the dash switch or scan tool.
5. Do not leave the vehicle unattended. Engine speed will rise to around
   1,200 rpm and exhaust temperature will climb sharply.
6. The cycle completes on its own. Aborting it repeatedly increases soot load
   and moves the vehicle toward derate.

### Conditions That Will Abort a Parked Regen

| Condition | Reason |
| --- | --- |
| Parking brake released | Safety interlock |
| Accelerator pedal pressed | Operator abort |
| Coolant temperature below threshold | Cannot reach regen temperature |
| DEF level below minimum | SCR cannot dose |
| Active exhaust system fault code present | Fault must be cleared first |

## DEF Quality and Contamination

DEF is 32.5% urea in deionized water. Concentration outside 31.8%-33.2% will
set a quality fault.

The three contamination events actually seen in fleets:

1. **Diesel in the DEF tank.** Requires complete tank, line, pump and injector
   replacement. The SCR catalyst is usually also destroyed. This is a very
   expensive mistake and worth warning drivers about explicitly.
2. **Water or washer fluid topped into the DEF tank.** Dilutes concentration
   below threshold; sets a quality fault and derates.
3. **Aged DEF.** Shelf life is roughly 12 months, shorter above 30°C. Urea
   decomposes and concentration drifts.

DEF freezes at -11°C. This is normal and expected; the tank has a heater and
the system is designed for it. A frozen DEF tank on a cold morning is not a
fault and should not be quoted as one.

## Service Intervals - Aftertreatment

| Interval | Service |
| --- | --- |
| Every 320,000 km / 200,000 mi | DPF ash cleaning (removal and bake/air clean) |
| Every 160,000 km / 100,000 mi | DEF pump filter |
| As required | DEF injector cleaning if dosing faults present |

Ash, unlike soot, does not burn off during regeneration. It accumulates
permanently and eventually requires physical cleaning of the filter. A vehicle
requiring parked regens far more frequently than its route explains is usually
telling you the DPF is ash-loaded and due for service.
