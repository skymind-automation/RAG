---
title: "Transit 350 Service Manual - Section 06: Brake System"
doc_type: manual
oem: Ford
model: Ford Transit
model_year: 2021-2024
system: brakes
access_level: advisor
synthetic: true
---

# Transit 350 Service Manual - Section 06: Brake System

## Brake System Overview

The Transit 350 uses a dual-circuit hydraulic brake system with vacuum assist
on gasoline variants and hydro-boost assist on diesel variants. Front brakes
are ventilated discs; rear brakes are solid discs on single-rear-wheel
configurations and ventilated discs on dual-rear-wheel configurations.

Anti-lock braking, electronic stability control and trailer sway control share
the same hydraulic control unit. A fault in any one of them will illuminate the
ABS warning lamp, so an illuminated ABS lamp does not by itself indicate a
wheel speed sensor fault.

## Front Brake Pad Replacement

### Removal

1. Raise and support the vehicle. Remove the front wheels.
2. Remove the caliper guide pin bolts. Support the caliper on a wire hook;
   do not let it hang from the brake hose.
3. Lift the caliper away from the anchor bracket and remove the pads and
   anti-rattle clips.
4. Inspect the rotor for scoring, heat checking and lateral runout.

### Installation

1. Retract the caliper piston with a piston compressor. On vehicles with an
   electric parking brake, put the caliper into service mode with the scan
   tool first — retracting the piston against an engaged EPB motor will
   damage the actuator.
2. Fit new anti-rattle clips. Apply a thin film of high-temperature caliper
   grease to the pad backing plate contact points only.
3. Install pads, seat the caliper, and torque the guide pin bolts.
4. Pump the brake pedal until firm before moving the vehicle.

### Torque Specifications - Front Brake

| Fastener | Torque (N·m) | Torque (lb-ft) | Notes |
| --- | --- | --- | --- |
| Caliper guide pin bolt | 36 | 27 | Replace bolts if stretched |
| Caliper anchor bracket bolt | 175 | 129 | Single use — replace |
| Wheel lug nut | 200 | 148 | Torque in a star pattern |
| Brake hose banjo bolt | 40 | 30 | New copper washers both sides |

### Service Limits - Front Brake

| Measurement | New | Service limit |
| --- | --- | --- |
| Pad friction material thickness | 12.0 mm | 3.0 mm |
| Rotor thickness | 30.0 mm | 28.0 mm |
| Rotor lateral runout | — | 0.05 mm |
| Rotor thickness variation | — | 0.015 mm |

## Rear Brake Pad Replacement

Rear pad replacement follows the front procedure with two differences: the
caliper anchor bracket bolts are torqued to 115 N·m (85 lb-ft), and the
electric parking brake actuator must be placed in service mode before the
piston is retracted. After installation, run the EPB calibration routine with
the scan tool, then verify parking brake hold on a 15% grade.

### Torque Specifications - Rear Brake

| Fastener | Torque (N·m) | Torque (lb-ft) |
| --- | --- | --- |
| Caliper guide pin bolt | 36 | 27 |
| Caliper anchor bracket bolt | 115 | 85 |
| EPB actuator bolt | 12 | 9 |

## Brake Fluid Service

Brake fluid is hygroscopic. Moisture content above 3% lowers the boiling point
enough to cause pedal fade on sustained descents, which is the failure mode
fleet vehicles on mountain routes actually experience.

Replace brake fluid every 36 months regardless of mileage, or whenever measured
moisture content exceeds 3%. Use DOT 4 LV only. DOT 5 silicone fluid is not
compatible with this system and will destroy the seals.

Bleed sequence: right rear, left rear, right front, left front. With the ABS
module, run the scan tool's automated bleed routine after conventional bleeding
or air will remain trapped in the HCU.

## Diagnosing Brake Noise

| Customer complaint | Likely cause | First check |
| --- | --- | --- |
| Squeal when cold, stops when warm | Pad glazing or missing anti-rattle clips | Pad surface and clip presence |
| Continuous squeal at all temperatures | Wear indicator contact | Pad thickness |
| Grinding | Pad worn through to backing plate | Pad and rotor condition |
| Pulsation felt through the pedal | Rotor thickness variation | Thickness variation measurement |
| Pull to one side under braking | Seized caliper slide pin | Slide pin free movement |
| Pedal sinks slowly at a stop | Internal master cylinder bypass | Master cylinder |

A pulsation complaint is almost never warped rotors in the literal sense.
Measure thickness variation before condemning a rotor; a rotor within the
0.015 mm limit that still pulsates points at a hub flange or wheel bearing
problem instead.
