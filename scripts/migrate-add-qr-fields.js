const db = require("../db/db-connection");

async function migrate() {
  try {
    console.log("Checking columns in 'users' table...");
    const [columns] = await db.sequelize.query("SHOW COLUMNS FROM `users`");
    const columnNames = columns.map((c) => c.Field);

    if (!columnNames.includes("qr_identifier")) {
      console.log("Adding column 'qr_identifier' to 'users' table...");
      await db.sequelize.query(
        "ALTER TABLE `users` ADD COLUMN `qr_identifier` VARCHAR(64) NULL UNIQUE AFTER `last_login_at`"
      );
      console.log("Column 'qr_identifier' added successfully.");
    } else {
      console.log("Column 'qr_identifier' already exists.");
    }

    if (!columnNames.includes("qr_generated_at")) {
      console.log("Adding column 'qr_generated_at' to 'users' table...");
      await db.sequelize.query(
        "ALTER TABLE `users` ADD COLUMN `qr_generated_at` DATETIME NULL AFTER `qr_identifier`"
      );
      console.log("Column 'qr_generated_at' added successfully.");
    } else {
      console.log("Column 'qr_generated_at' already exists.");
    }

    console.log("Migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
