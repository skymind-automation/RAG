"""Controlled vocabularies shared by ingestion, retrieval and evaluation.

These are deliberately small, explicit lists rather than free text. Every one of
them is used as a hard pre-filter at retrieval time, so a typo in ingestion is a
silently missing document later. Validate on the way in, not on the way out.
"""


class DocType:
    MANUAL = "manual"
    TSB = "tsb"
    DTC_TABLE = "dtc_table"
    TECH_NOTE = "tech_note"

    CHOICES = [
        (MANUAL, "Service manual"),
        (TSB, "Technical service bulletin"),
        (DTC_TABLE, "DTC code table"),
        (TECH_NOTE, "Technician note"),
    ]
    ALL = [c[0] for c in CHOICES]


class VehicleSystem:
    """Top-level system taxonomy. Kept coarse on purpose: advisors think in
    these terms, and a coarse filter that is always right beats a fine one that
    is often wrong."""

    ENGINE = "engine"
    DRIVETRAIN = "drivetrain"
    BRAKES = "brakes"
    ELECTRICAL = "electrical"
    HVAC = "hvac"
    EMISSIONS = "emissions"
    FUEL = "fuel"
    SUSPENSION = "suspension"
    BODY = "body"
    CHASSIS = "chassis"
    TRANSMISSION = "transmission"
    GENERAL = "general"

    CHOICES = [
        (ENGINE, "Engine"),
        (DRIVETRAIN, "Drivetrain"),
        (BRAKES, "Brakes"),
        (ELECTRICAL, "Electrical"),
        (HVAC, "HVAC"),
        (EMISSIONS, "Emissions / aftertreatment"),
        (FUEL, "Fuel"),
        (SUSPENSION, "Suspension"),
        (BODY, "Body"),
        (CHASSIS, "Chassis"),
        (TRANSMISSION, "Transmission"),
        (GENERAL, "General / multi-system"),
    ]
    ALL = [c[0] for c in CHOICES]

    # Words an advisor actually says, mapped onto the taxonomy. Used by the
    # entity extractor to derive a `system` pre-filter from a free-text query.
    KEYWORDS = {
        ENGINE: ["engine", "misfire", "cylinder", "oil", "coolant", "overheat",
                 "timing", "crankshaft", "camshaft", "turbo", "turbocharger",
                 "idle", "stall", "shudder", "knock", "cold start"],
        DRIVETRAIN: ["driveshaft", "differential", "axle", "u-joint", "4wd", "awd"],
        BRAKES: ["brake", "brakes", "rotor", "rotors", "caliper", "pad", "pads",
                 "abs", "pedal", "squeal", "grinding"],
        ELECTRICAL: ["battery", "alternator", "starter", "fuse", "wiring",
                     "harness", "no crank", "dead battery", "parasitic draw",
                     "dash light", "headlight", "charging"],
        HVAC: ["ac", "a/c", "air conditioning", "heater", "hvac", "blower",
               "defrost", "refrigerant", "compressor"],
        EMISSIONS: ["dpf", "def", "scr", "egr", "regen", "regeneration", "nox",
                    "aftertreatment", "catalyst", "catalytic", "emissions",
                    "particulate"],
        FUEL: ["fuel", "injector", "injectors", "fuel pump", "fuel filter",
               "water in fuel", "rail pressure"],
        SUSPENSION: ["suspension", "shock", "strut", "spring", "bushing",
                     "alignment", "steering"],
        TRANSMISSION: ["transmission", "trans", "shift", "shifting", "clutch",
                       "torque converter", "gear", "slipping"],
        BODY: ["door", "mirror", "seal", "window", "latch", "paint", "wiper"],
        CHASSIS: ["frame", "chassis", "tire", "tires", "wheel", "wheels"],
    }


class Severity:
    INFO = "info"
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"

    CHOICES = [
        (INFO, "Informational"),
        (LOW, "Low"),
        (MODERATE, "Moderate"),
        (HIGH, "High"),
        (CRITICAL, "Critical - do not dispatch"),
    ]
    ALL = [c[0] for c in CHOICES]


class AccessLevel:
    """Retrieval-time access control. Technician notes and incident reports can
    carry customer-identifying or liability-sensitive detail, so every chunk
    carries the minimum role required to see it."""

    PUBLIC = "public"          # anything an advisor may read to a customer
    ADVISOR = "advisor"        # service reception / service advisor
    TECHNICIAN = "technician"  # technician-level procedure detail
    INTERNAL = "internal"      # internal-only: liability, warranty, notes

    CHOICES = [
        (PUBLIC, "Public"),
        (ADVISOR, "Advisor"),
        (TECHNICIAN, "Technician"),
        (INTERNAL, "Internal"),
    ]
    ALL = [c[0] for c in CHOICES]

    # Roles are ordered: a role can read its own level and everything below it.
    ORDER = {PUBLIC: 0, ADVISOR: 1, TECHNICIAN: 2, INTERNAL: 3}

    @classmethod
    def visible_to(cls, role: str) -> list[str]:
        ceiling = cls.ORDER.get(role, cls.ORDER[cls.PUBLIC])
        return [lvl for lvl, rank in cls.ORDER.items() if rank <= ceiling]
