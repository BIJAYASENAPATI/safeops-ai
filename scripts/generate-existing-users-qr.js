const crypto = require("crypto");
const { Op } = require("sequelize");
const db = require("../db/db-connection");

async function generateExistingUsersQR() {
  try {
    console.log("Searching for active, accepted users without a QR identifier...");

    const batchSize = 50;
    let offset = 0;
    let totalUpdated = 0;

    while (true) {
      const users = await db.User.findAll({
        where: {
          account_status: "active",
          invite_status: "accepted",
          role: { [Op.ne]: "system" },
          qr_identifier: null,
        },
        limit: batchSize,
        offset: 0, // Always 0 because updating them removes them from the query
        order: [["id", "ASC"]],
      });

      if (!users || users.length === 0) {
        break;
      }

      console.log(`Processing batch of ${users.length} users...`);

      for (const user of users) {
        const qrIdentifier = crypto.randomBytes(32).toString("hex");
        await user.update({
          qr_identifier: qrIdentifier,
          qr_generated_at: new Date(),
        });
        totalUpdated++;
      }
    }

    console.log(`Successfully generated QR identifiers for ${totalUpdated} existing user(s).`);
    process.exit(0);
  } catch (error) {
    console.error("Batch QR generation error:", error);
    process.exit(1);
  }
}

generateExistingUsersQR();
