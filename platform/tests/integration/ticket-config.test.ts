import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import type { OrgContext } from "@/server/context";
import {
  addWorkflowStatus,
  archiveCategory,
  archiveCustomField,
  createCategory,
  createCustomField,
  getTicketConfiguration,
  getTicketFormOptions,
  setDefaultPriority,
  setWorkflowTransition,
} from "@/server/tickets/ticket-config-service";
import {
  availableTransitions,
  createTicket,
  getTicket,
  transitionTicket,
  updateTicket,
} from "@/server/tickets/ticket-service";
import { joinAs, makeOrg, resetDb, statusByKey } from "./helpers";

describe("ticket configuration", () => {
  let owner: OrgContext;
  let agent: OrgContext;
  let other: OrgContext;

  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
    agent = await joinAs(owner, "AGENT");
    other = await makeOrg("Beta Corp", "beta");
  });

  it("only configurators can change configuration", async () => {
    await expect(createCategory(agent, { name: "Telephony" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(addWorkflowStatus(agent, { name: "Awaiting vendor", category: "PENDING" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(getTicketConfiguration(agent)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("archived categories leave forms but stay on existing tickets; the name can be reused", async () => {
    const cat = await createCategory(owner, { name: "Telephony" });
    const t = await createTicket(owner, { type: "INCIDENT", title: "Desk phone dead", categoryId: cat.id });
    await archiveCategory(owner, { categoryId: cat.id });
    expect((await getTicketFormOptions(owner)).categories.map((c) => c.name)).not.toContain("Telephony");
    expect((await getTicket(owner, t.id)).category?.id).toBe(cat.id);
    await expect(
      createTicket(owner, { type: "INCIDENT", title: "Another", categoryId: cat.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await createCategory(owner, { name: "Telephony" });
  });

  it("switches the default priority atomically", async () => {
    const { priorities } = await getTicketConfiguration(owner);
    const low = priorities.find((p) => p.key === "low")!;
    await setDefaultPriority(owner, { priorityId: low.id });
    expect((await createTicket(owner, { type: "TASK", title: "Default prio" })).priority.key).toBe("low");
    const after = (await getTicketConfiguration(owner)).priorities.filter((p) => p.isDefault);
    expect(after.map((p) => p.key)).toEqual(["low"]);
  });

  it("new statuses and transitions drive transitionTicket", async () => {
    const waiting = await addWorkflowStatus(owner, { name: "Awaiting vendor", category: "PENDING" });
    const open = await statusByKey(owner, "open");
    const t = await createTicket(owner, { type: "INCIDENT", title: "Vendor issue" });
    await transitionTicket(owner, { ticketId: t.id, toStatusId: open, expectedVersion: 1 });
    await expect(
      transitionTicket(owner, { ticketId: t.id, toStatusId: waiting.id, expectedVersion: 2 }),
    ).rejects.toThrow(/isn't allowed/);
    await setWorkflowTransition(owner, { fromStatusId: open, toStatusId: waiting.id, enabled: true });
    expect((await availableTransitions(owner, t.id)).map((x) => x.toStatus.name)).toContain("Awaiting vendor");
    await transitionTicket(owner, { ticketId: t.id, toStatusId: waiting.id, expectedVersion: 2 });
    // Disabling a transition takes effect immediately.
    await setWorkflowTransition(owner, { fromStatusId: waiting.id, toStatusId: open, enabled: true });
    await setWorkflowTransition(owner, { fromStatusId: waiting.id, toStatusId: open, enabled: false });
    await expect(transitionTicket(owner, { ticketId: t.id, toStatusId: open, expectedVersion: 3 })).rejects.toThrow(
      /isn't allowed/,
    );
  });

  it("can't wire statuses from another tenant's workflow", async () => {
    const theirs = await statusByKey(other, "open");
    const mine = await statusByKey(owner, "new");
    await expect(
      setWorkflowTransition(owner, { fromStatusId: mine, toStatusId: theirs, enabled: true }),
    ).rejects.toThrow(/not found/i);
  });

  describe("custom fields", () => {
    it("validates values by type and requiredness on create and update", async () => {
      await createCustomField(owner, { label: "Asset tag", type: "TEXT", required: true, ticketTypes: ["INCIDENT"] });
      await createCustomField(owner, { label: "Site", type: "SELECT", options: ["Memphis", "Dallas"] });
      await createCustomField(owner, { label: "Users affected", type: "NUMBER" });

      await expect(createTicket(owner, { type: "INCIDENT", title: "No tag" })).rejects.toMatchObject({
        fieldErrors: { "customFields.asset_tag": ["Asset tag is required."] },
      });
      // Required only for incidents.
      await createTicket(owner, { type: "TASK", title: "Task without tag" });
      await expect(
        createTicket(owner, { type: "INCIDENT", title: "Bad", customFields: { asset_tag: "A1", site: "Paris" } }),
      ).rejects.toMatchObject({ fieldErrors: { "customFields.site": ["Choose one of the options."] } });
      await expect(
        createTicket(owner, { type: "INCIDENT", title: "Bad", customFields: { asset_tag: "A1", unknown_key: 1 } }),
      ).rejects.toMatchObject({ fieldErrors: { "customFields.unknown_key": ["Unknown field."] } });

      const t = await createTicket(owner, {
        type: "INCIDENT",
        title: "Good",
        customFields: { asset_tag: "LAP-0042", site: "Dallas", users_affected: "12" },
      });
      expect((await getTicket(owner, t.id)).customFields).toEqual({
        asset_tag: "LAP-0042",
        site: "Dallas",
        users_affected: 12,
      });
      // Clearing a required field fails; clearing an optional one works.
      await expect(
        updateTicket(owner, { ticketId: t.id, expectedVersion: 1, customFields: { asset_tag: "" } }),
      ).rejects.toBeInstanceOf(ValidationError);
      await updateTicket(owner, { ticketId: t.id, expectedVersion: 1, customFields: { site: null } });
      expect((await getTicket(owner, t.id)).customFields).toEqual({ asset_tag: "LAP-0042", users_affected: 12 });
    });

    it("archived fields stop validating and their key can be reused", async () => {
      const f = await createCustomField(owner, { label: "Legacy code", type: "TEXT", required: true });
      await archiveCustomField(owner, { fieldId: f.id });
      await createTicket(owner, { type: "TASK", title: "No longer required" });
      const again = await createCustomField(owner, { label: "Legacy code", type: "NUMBER" });
      expect(again.key).toBe("legacy_code");
    });

    it("select fields need distinct options", async () => {
      await expect(
        createCustomField(owner, { label: "Site", type: "SELECT", options: ["Only"] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createCustomField(owner, { label: "Site", type: "SELECT", options: ["A", "A"] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it("form options hide the member directory from requesters", async () => {
    const requester = await joinAs(owner, "REQUESTER", "req");
    const opts = await getTicketFormOptions(requester);
    expect(opts.members).toEqual([]);
    expect(opts.teams).toEqual([]);
    expect(opts.priorities.length).toBeGreaterThan(0);
    const staff = await getTicketFormOptions(agent);
    expect(staff.members.find((m) => m.id === requester.user.id)).toMatchObject({ assignable: false });
  });
});
