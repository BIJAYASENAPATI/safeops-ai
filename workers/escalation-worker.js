const { Op } = require("sequelize");
const db = require("../db/db-connection");

let isRunning = false;
let workerInterval = null;

// Cache or lookup system user
let systemUserCache = null;
async function getSystemUser() {
  if (systemUserCache) return systemUserCache;
  let user = await db.User.findOne({ where: { email: "system@safeops.internal" } });
  if (!user) {
    user = await db.User.create({
      name: "SafeOps System",
      email: "system@safeops.internal",
      role: "system",
      password_hash: null,
      account_status: "disabled",
      invite_status: "accepted",
      plant_id: null,
    });
  }
  systemUserCache = user;
  return user;
}

// Process a single overdue open incident atomically
async function processIncidentEscalation(incidentId, testOptions = {}) {
  const systemUser = await getSystemUser();

  return await db.sequelize.transaction(async (t) => {
    // 1. Lock and reload incident row
    const incident = await db.Incident.findByPk(incidentId, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!incident) return false;

    // 2. Recheck eligibility: must still be open and past deadline
    const now = new Date();
    if (
      incident.status !== "open" ||
      !incident.escalation_due_at ||
      new Date(incident.escalation_due_at) > now
    ) {
      // Skipped because state changed (e.g. acknowledged or deadline extended)
      return false;
    }

    const plantId = incident.zone?.plant_id;

    // 3. Verify selected contact is still eligible
    let contact = null;
    let contactEligible = false;
    if (incident.escalation_contact_id) {
      contact = await db.User.findByPk(incident.escalation_contact_id, { transaction: t });
      if (
        contact &&
        contact.account_status === "active" &&
        contact.invite_status === "accepted" &&
        ["manager", "admin"].includes(contact.role) &&
        Number(contact.plant_id) === Number(plantId)
      ) {
        contactEligible = true;
      }
    }

    if (!contactEligible) {
      // Configuration error: contact disabled or lost plant access
      console.warn(
        `[EscalationWorker] Escalation configuration error for incident ${incident.id}: contact ${incident.escalation_contact_id} is ineligible.`
      );

      // Record configuration error in audit log
      await db.AuditLogEntry.create(
        {
          incident_id: incident.id,
          actor_id: systemUser.id,
          action: "escalation_error",
          metadata: {
            source: "automatic",
            error: "Escalation contact ineligible or unassigned",
            contact_id: incident.escalation_contact_id,
            plant_id: plantId,
          },
        },
        { transaction: t }
      );

      // Surface notification to plant admin(s)
      const plantAdmins = await db.User.findAll({
        where: {
          plant_id: plantId,
          role: "admin",
          account_status: "active",
        },
        transaction: t,
      });

      for (const admin of plantAdmins) {
        await db.Notification.findOrCreate({
          where: {
            recipient_id: admin.id,
            incident_id: incident.id,
            type: "incident_escalated",
          },
          defaults: {
            title: `Escalation Configuration Error: Incident #${incident.id}`,
            message: `Incident #${incident.id} could not notify contact ${incident.escalation_contact_id}. Please review escalation rules for Zone ${incident.zone_id}.`,
          },
          transaction: t,
        });
      }

      // Mark status escalated so worker does not loop indefinitely on it
      await incident.update(
        {
          status: "escalated",
          escalated_at: now,
        },
        { transaction: t }
      );

      return true;
    }

    // 4. Update incident status
    await incident.update(
      {
        status: "escalated",
        escalated_at: now,
      },
      { transaction: t }
    );

    // Optional test hook for transaction rollback verification
    if (testOptions._fail_rollback) {
      throw new Error("Simulated failure during escalation transaction");
    }

    // 5. Insert automatic audit entry
    await db.AuditLogEntry.create(
      {
        incident_id: incident.id,
        actor_id: systemUser.id,
        action: "escalated",
        metadata: {
          source: "automatic",
          old_status: "open",
          new_status: "escalated",
          rule_id: incident.escalation_rule_id,
          contact_id: incident.escalation_contact_id,
        },
      },
      { transaction: t }
    );

    // 6. Insert in-app notification for the contact
    await db.Notification.create(
      {
        recipient_id: incident.escalation_contact_id,
        incident_id: incident.id,
        type: "incident_escalated",
        title: `Incident Escalated: Incident #${incident.id}`,
        message: `Incident #${incident.id} was not acknowledged before its deadline and has been automatically escalated to you.`,
      },
      { transaction: t }
    );

    console.log(
      `[EscalationWorker] Successfully escalated incident ${incident.id} to contact ${incident.escalation_contact_id}`
    );
    return true;
  });
}

// Background tick: scan overdue open incidents
async function runEscalationCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();
    // Query batch of open overdue incidents
    const overdueIncidents = await db.Incident.findAll({
      where: {
        status: "open",
        escalation_due_at: {
          [Op.ne]: null,
          [Op.lte]: now,
        },
      },
      attributes: ["id"],
      limit: 20,
      order: [["escalation_due_at", "ASC"]],
    });

    for (const item of overdueIncidents) {
      try {
        await processIncidentEscalation(item.id);
      } catch (err) {
        console.error(`[EscalationWorker] Error processing incident ${item.id}:`, err);
      }
    }
  } catch (error) {
    console.error("[EscalationWorker] Cycle error:", error);
  } finally {
    isRunning = false;
  }
}

// Start worker: immediately checks on startup, then runs every 10 seconds
function startEscalationWorker(intervalMs = 10000) {
  if (workerInterval) return;
  console.log("🚀 Escalation background worker initialized");
  // Immediate check on startup for restart recovery
  runEscalationCycle().catch((err) =>
    console.error("[EscalationWorker] Startup check error:", err)
  );

  workerInterval = setInterval(runEscalationCycle, intervalMs);
}

function stopEscalationWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("🛑 Escalation background worker stopped");
  }
}

module.exports = {
  startEscalationWorker,
  stopEscalationWorker,
  runEscalationCycle,
  processIncidentEscalation,
};
