---
title: "DEF Quality Fault and Derate After Refill - Contaminated Bulk DEF"
doc_type: tsb
tsb_number: 23-0877
revision: "1"
issued_on: 2023-08-22
oem: Freightliner
model: Freightliner Cascadia
model_year: 2020-2024
system: emissions
symptoms:
  - derate
  - warning light
  - loss of power
dtc_codes:
  - P203F
  - P207F
access_level: advisor
synthetic: true
---

# TSB 23-0877 - DEF Quality Fault and Derate After Refill

## Applicability

2020-2024 Cascadia with SCR aftertreatment.

## Symptom

**P207F** (reductant quality performance) or **P203F** (reductant level
performance) sets within one to three operating hours of a DEF refill, followed
by a staged derate. DEF level reads correct. The DEF pump and injector test
within specification.

The pattern is strongly correlated across a fleet: multiple vehicles setting
the same code within days of each other, all having refilled from the same bulk
tank.

## Cause

Contaminated or out-of-concentration bulk DEF. The three causes seen in
practice:

1. Water or washer fluid introduced into the bulk tank, diluting concentration
   below 31.8%.
2. DEF aged beyond its shelf life — roughly 12 months, and considerably less if
   the bulk tank is stored above 30°C.
3. Cross-contamination from a transfer pump or hose previously used for diesel.

The vehicle is reporting a real fault. The vehicle is not the problem.

## Correction

1. Test the DEF **in the vehicle tank** with a refractometer. Specification is
   32.5% urea, acceptable range 31.8%-33.2%.
2. Test the **bulk supply** as well. Testing only the vehicle finds the symptom
   and not the source, and the next vehicle refilled will return with the same
   code.
3. If out of specification, drain and flush the vehicle DEF tank, replace the
   DEF pump filter, and refill with fresh DEF from a verified supply.
4. Inspect the DEF injector for crystalline deposits and clean if present.
5. Clear codes and run the SCR system self-test.
6. If diesel contamination is confirmed, the DEF tank, lines, pump and injector
   all require replacement and the SCR catalyst must be evaluated.

### DEF Specification

| Property | Specification |
| --- | --- |
| Urea concentration | 32.5% (acceptable 31.8%-33.2%) |
| Freezing point | -11°C (normal, tank is heated) |
| Shelf life at 20°C | ~12 months |
| Shelf life above 30°C | ~6 months |

## Warranty

Not a warrantable repair when contaminated DEF is confirmed. Customer-pay.

## Advisor Notes

When more than one vehicle from the same customer presents with a DEF quality
code in a short period, test the customer's bulk tank before doing anything to
the vehicles. Telling a fleet customer their bulk DEF is the problem is an
awkward conversation, but replacing four DEF pumps and having all four vehicles
come back is a worse one.
