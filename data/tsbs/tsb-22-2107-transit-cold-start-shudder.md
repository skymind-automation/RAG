---
title: "Driveline Shudder on Cold Start - Torque Converter Clutch Strategy"
doc_type: tsb
tsb_number: 22-2107
revision: "2"
issued_on: 2022-09-14
oem: Ford
model: Ford Transit
model_year: 2021-2023
system: transmission
symptoms:
  - shudder
  - vibration
  - cold start
  - hesitation
access_level: advisor
synthetic: true
---

# TSB 22-2107 - Driveline Shudder on Cold Start

**Revision 2** supersedes Revision 1 of 2022-03-02. Revision 2 extends
applicability to 2023 model year and corrects the fluid fill specification.

## Applicability

2021-2023 Transit 350 equipped with the 10R60 automatic transmission, built
before 2023-04-11.

## Symptom

The customer reports a shudder, vibration or "rumble strip" feeling at light
throttle between 40 and 70 km/h (25 and 45 mph), occurring only during the
first 10 to 15 minutes of operation after a cold soak of 6 hours or more. The
condition disappears once the transmission reaches operating temperature and
cannot be reproduced on a warm vehicle.

Customers frequently describe this as "driving over rumble strips", "a
vibration that goes away after a while", or "shaking when it's cold in the
morning". No diagnostic trouble code is set.

## Cause

The torque converter clutch control strategy applies partial lockup earlier
than intended when transmission fluid temperature is below 40°C. At low fluid
temperature the friction material's coefficient of friction is high enough that
partial slip becomes stick-slip, which transmits into the driveline as shudder.

This is a calibration condition, not a mechanical failure. Do not replace the
torque converter on this symptom alone.

## Correction

1. Verify the symptom occurs only below 40°C transmission fluid temperature.
   Record the fluid temperature at the time the shudder is felt.
2. Confirm no DTCs are present. If P0740, P0741 or P2769 is stored, this
   bulletin does not apply — diagnose the code instead.
3. Check the transmission fluid level and condition. Fluid must be Mercon ULV.
   If a non-specification fluid has been used, the fluid must be exchanged
   before the calibration will correct the condition.
4. Reprogram the transmission control module to calibration level 22C-10R60-07
   or later.
5. Road test from a cold soak to confirm.

### Fluid Specification

| Item | Specification |
| --- | --- |
| Fluid | Mercon ULV only |
| Total fill | 11.8 L |
| Drain and refill | 5.7 L |
| Check temperature | 85-95°C |

Universal or "compatible" ATF is the most common cause of a vehicle returning
with the shudder unchanged after reprogramming. Verify what was last put in it.

## Warranty

| Operation | Code | Time |
| --- | --- | --- |
| TCM reprogram | 22210A | 0.6 h |
| Fluid exchange (if non-spec fluid found) | 22210B | 1.4 h |

Covered under powertrain warranty for the applicability range above.

## Advisor Notes

If the customer's description includes cold-start-only shudder that goes away
when warm, and the vehicle is in the applicability range, this bulletin is
almost certainly the answer. Book it as a reprogram, not as a driveline
diagnosis, and set the expectation that the vehicle needs to be left overnight
so the shudder can be verified from a genuine cold soak.
